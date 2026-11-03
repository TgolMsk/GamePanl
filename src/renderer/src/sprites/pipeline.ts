// 单个动作（一段视频）的处理管线，缓存中间结果：参数改了只重算受影响的步骤。
//   分析：分析分辨率（长边 160）解码全部帧 → 背景色 → 抠图 → 水印 → 循环检测 → 片段与抽帧
//   取帧：工作分辨率只解码选中的帧（和第 0 帧）→ 抠图、开运算、去溢出 → 几何量（并集框、首帧身高、参考点）
//   出图：按布局裁切缩小 → 共享调色板 → 描边、留白 → RGBA
// 视频从哪里来由 FrameSource 决定（应用里是 WebCodecs，测试里可以是 ffmpeg）。

import {
  actionKindOfName,
  FALLBACK_WATERMARK,
  isDeathAction,
  type SpriteActionParams,
  type SpriteFrameEdit,
  type SpriteResample
} from '@shared/sprites'
import { yuvToRgb, type ColorSpec, type YuvFrame } from './core/color'
import {
  composeCell,
  downsampleBox,
  downsampleMode,
  indexBox,
  toRgba,
  TRANSPARENT,
  type Indexed
} from './core/downsample'
import { despill, dropSpecks, erode, estimateBackground, Keyer, openMask } from './core/keying'
import type { ActionGeometry, ActionLayout } from './core/layout'
import { FrameDiff, findLoop, pickLoop, pickOnce, type LoopInfo } from './core/loop'
import { buildPalette, darkestIndex, type Palette } from './core/palette'
import { analysisQc, paletteQc, type QcItem } from './core/qc'
import {
  fitSize,
  maskBounds,
  maskCentroidX,
  maskCount,
  normToPixels,
  sampleIndices,
  sampleIndicesSparse,
  unionRect,
  type Mask,
  type NormRect,
  type Rect,
  type RgbFrame
} from './core/util'
import { detectWatermark } from './core/watermark'

export interface FrameSource {
  width: number
  height: number
  fps: number
  frameCount: number
  color: ColorSpec
  codec: string
  /** 按展示顺序解码这些帧（'all' 为全部），每帧回调一次；回调返回后 YUV 数据失效 */
  decode(indices: number[] | 'all', onFrame: (index: number, f: YuvFrame) => void): Promise<void>
}

export interface AnalyzeOptions {
  name: string
  params: SpriteActionParams
  edits: SpriteFrameEdit[]
  /** 角色设置的像素身高（决定工作分辨率） */
  height: number
  work: number | null
}

export type WatermarkSource = 'auto' | 'fallback' | 'manual' | 'none'

export interface PickedFrame {
  /** 抽帧算出来的源帧 */
  base: number
  /** 实际用的源帧（换帧后不同） */
  frame: number
}

export interface AnalyzeResult {
  info: { width: number; height: number; fps: number; frameCount: number; matrix: string; fullRange: boolean; codec: string }
  bg: [number, number, number]
  keyMode: 'hue' | 'dist'
  watermark: { source: WatermarkSource; regions: NormRect[]; conflicts: NormRect[] }
  kind: 'loop' | 'once'
  kindFrom: 'name' | 'diff' | 'manual'
  segment: [number, number]
  segmentAuto: boolean
  loop: LoopInfo | null
  seamDiff: number | null
  picks: PickedFrame[]
  /** 删掉的源帧（抽帧算出来、被手动删掉的） */
  dropped: number[]
  fps: number
  geometry: ActionGeometry
  fgCount: number
  qc: QcItem[]
}

export interface RenderOptions {
  layout: ActionLayout
  palette: Palette
  resample: SpriteResample
  outline: boolean
  pad: number
  alphaThreshold: number
}

export interface RenderResult {
  frames: Uint8Array[]
  frameWidth: number
  frameHeight: number
  qc: QcItem
}

interface KeyState {
  key: string
  bg: [number, number, number]
  keyer: Keyer
  /** 屏蔽水印后的前景（分析分辨率，全部帧，不做开运算） */
  masks: Mask[]
  wmSource: WatermarkSource
  wmNorm: NormRect[]
  wmConflicts: NormRect[]
  wmAnalysis: Rect[]
  diff: FrameDiff
}

interface Matte {
  mask: Mask
  rgb: RgbFrame
}

/** 裁到前景外接框的抠图：前景外面的颜色没人读，丢掉省内存 */
interface SpareMatte {
  width: number
  height: number
  box: Rect | null
  mask: Uint8Array
  rgb: Uint8Array
  bytes: number
}

function packMatte(m: Matte): SpareMatte {
  const { width: w, height: h } = m.mask
  const box = maskBounds(m.mask)
  const bw = box ? box.x1 - box.x0 : 0
  const bh = box ? box.y1 - box.y0 : 0
  const mask = new Uint8Array(bw * bh)
  const rgb = new Uint8Array(bw * bh * 3)
  if (box) {
    for (let y = 0; y < bh; y++) {
      const src = (box.y0 + y) * w + box.x0
      mask.set(m.mask.data.subarray(src, src + bw), y * bw)
      rgb.set(m.rgb.data.subarray(src * 3, (src + bw) * 3), y * bw * 3)
    }
  }
  return { width: w, height: h, box, mask, rgb, bytes: mask.length + rgb.length + 64 }
}

function unpackMatte(s: SpareMatte): Matte {
  const { width: w, height: h, box } = s
  const mask = new Uint8Array(w * h)
  const rgb = new Uint8Array(w * h * 3)
  if (box) {
    const bw = box.x1 - box.x0
    for (let y = 0; y < box.y1 - box.y0; y++) {
      const dst = (box.y0 + y) * w + box.x0
      mask.set(s.mask.subarray(y * bw, (y + 1) * bw), dst)
      rgb.set(s.rgb.subarray(y * bw * 3, (y + 1) * bw * 3), dst * 3)
    }
  }
  return { mask: { width: w, height: h, data: mask }, rgb: { width: w, height: h, data: rgb } }
}

const ANALYSIS_SIDE = 160
const WORK_CACHE_LIMIT = 40
/** 每个动作的备用抠图最多占这么多内存（人物外接框大小，一般 0.5–1 MB 一帧） */
const SPARE_BYTES = 160 * 1024 * 1024

export class ActionPipeline {
  private analysis: RgbFrame[] | null = null
  private keyState: KeyState | null = null
  private loopCache = new Map<string, ReturnType<typeof findLoop>>()
  private work = new Map<string, RgbFrame>()
  private mattes = new Map<string, Matte>()
  /** 当前片段用不到的抠图结果（裁到前景外接框）：拖回原来的片段、恢复删掉的帧时直接用 */
  private spare = new Map<string, SpareMatte>()
  private spareBytes = 0
  private boxCache = new Map<string, { rgb: Uint8Array; opaque: Uint8Array }>()
  /** 最近一次 analyze 的结果，samples / render 用 */
  private current: { picks: number[]; mattes: Matte[]; res: AnalyzeResult } | null = null
  /** 最近一次 analyze 的工作分辨率（trim 之后看原片也按它） */
  private workSize: [number, number] | null = null
  /** 最近一次 analyze 的参数（JSON）：参数没变时直接返回上次的结果（改别的动作时这个动作不用重算） */
  private lastOptions: string | null = null

  constructor(readonly src: FrameSource) {}

  /** 分析分辨率的全部帧 */
  async analysisFrames(): Promise<RgbFrame[]> {
    if (this.analysis) return this.analysis
    const [aw, ah] = fitSize(this.src.width, this.src.height, ANALYSIS_SIDE)
    const frames: RgbFrame[] = new Array(this.src.frameCount)
    await this.src.decode('all', (i, f) => {
      if (i >= 0 && i < frames.length) frames[i] = yuvToRgb(f, aw, ah, this.src.color)
    })
    // 个别帧解不出来时用前一帧补上，不让后面的步骤出错
    for (let i = 0; i < frames.length; i++) {
      if (!frames[i]) frames[i] = frames[i - 1] ?? frames.find(Boolean) ?? { width: aw, height: ah, data: new Uint8Array(aw * ah * 3) }
    }
    if (frames.length < 2) throw new Error('视频帧数太少')
    this.analysis = frames
    return frames
  }

  /** 工作分辨率上的若干帧（有缓存）；超出缓存上限时 keep 里的不丢 */
  async workFrames(indices: number[], ww: number, wh: number, keep: number[] = indices): Promise<Map<number, RgbFrame>> {
    const key = (i: number): string => `${ww}x${wh}:${i}`
    const missing = [...new Set(indices)].filter((i) => !this.work.has(key(i))).sort((a, b) => a - b)
    if (missing.length) {
      await this.src.decode(missing, (i, f) => {
        this.work.set(key(i), yuvToRgb(f, ww, wh, this.src.color))
      })
    }
    const out = new Map<number, RgbFrame>()
    for (const i of indices) {
      const f = this.work.get(key(i))
      if (!f) throw new Error(`解码不到第 ${i} 帧`)
      out.set(i, f)
    }
    // 控制内存：只留最近用到的
    if (this.work.size > WORK_CACHE_LIMIT) {
      const kept = new Set(keep.map(key))
      for (const k of this.work.keys()) {
        if (this.work.size <= WORK_CACHE_LIMIT) break
        if (!kept.has(k)) this.work.delete(k)
      }
    }
    return out
  }

  private async keying(p: SpriteActionParams): Promise<KeyState> {
    const key = JSON.stringify([p.key, p.hueTol, p.satMin, p.valMin, p.distTol, p.watermark])
    if (this.keyState?.key === key) return this.keyState
    const frames = await this.analysisFrames()
    const { width: aw, height: ah } = frames[0]
    const opts = { mode: p.key, hueTol: p.hueTol, satMin: p.satMin, valMin: p.valMin, distTol: p.distTol }
    let wmSource: WatermarkSource
    let wmNorm: NormRect[]
    let wmConflicts: NormRect[] = []
    let bg: [number, number, number]
    let keyer: Keyer
    if (p.watermark === 'none' || Array.isArray(p.watermark)) {
      wmSource = p.watermark === 'none' ? 'none' : 'manual'
      wmNorm = Array.isArray(p.watermark) ? [p.watermark] : []
      bg = estimateBackground(frames, wmNorm.map((r) => normToPixels(r, aw, ah)))
      keyer = new Keyer(bg, opts)
    } else {
      // 自动：背景色先排除固定区域估计，再找水印；找不到用固定区域
      bg = estimateBackground(frames, [normToPixels(FALLBACK_WATERMARK, aw, ah)])
      keyer = new Keyer(bg, opts)
      const raw = frames.map((f) => keyer.foreground(f))
      const det = detectWatermark(frames, raw)
      wmConflicts = det.conflicts
      if (det.regions.length) {
        wmSource = 'auto'
        wmNorm = det.regions
      } else if (det.conflicts.length) {
        // 找到了但和角色重叠：以角色为准，不屏蔽
        wmSource = 'none'
        wmNorm = []
      } else {
        wmSource = 'fallback'
        wmNorm = [FALLBACK_WATERMARK]
      }
    }
    const wmAnalysis = wmNorm.map((r) => normToPixels(r, aw, ah))
    const masks = frames.map((f) => keyer.foreground(f, wmAnalysis))
    let crop: Rect | null = null
    for (const m of masks) crop = unionRect(crop, maskBounds(m))
    this.keyState = {
      key,
      bg,
      keyer,
      masks,
      wmSource,
      wmNorm,
      wmConflicts,
      wmAnalysis,
      diff: new FrameDiff(masks, frames, crop)
    }
    this.loopCache.clear()
    return this.keyState
  }

  private loopOf(ks: KeyState, p: SpriteActionParams): ReturnType<typeof findLoop> {
    const key = `${p.minPeriod}|${p.maxPeriod}`
    let r = this.loopCache.get(key)
    if (!r) {
      r = findLoop(ks.diff, this.src.fps, p.minPeriod, p.maxPeriod)
      this.loopCache.set(key, r)
    }
    return r
  }

  async analyze(o: AnalyzeOptions): Promise<AnalyzeResult> {
    const sig = JSON.stringify(o)
    if (this.current && this.lastOptions === sig) return this.current.res
    this.lastOptions = null
    const p = o.params
    const frames = await this.analysisFrames()
    const n = frames.length
    const ks = await this.keying(p)

    // 循环还是单次
    let kind: 'loop' | 'once'
    let kindFrom: AnalyzeResult['kindFrom']
    let loop: LoopInfo | null = null
    if (p.kind !== 'auto') {
      kind = p.kind
      kindFrom = 'manual'
    } else {
      const byName = actionKindOfName(o.name)
      if (byName) {
        kind = byName
        kindFrom = 'name'
      } else {
        const r = this.loopOf(ks, p)
        kind = r.info && r.info.startEndDiff <= 0.08 ? 'loop' : 'once'
        kindFrom = 'diff'
      }
    }

    // 片段
    let s: number
    let e: number
    let segmentAuto = false
    if (p.start !== null || p.end !== null) {
      s = p.start ?? 0
      e = p.end ?? n
    } else if (kind === 'once') {
      s = 0
      e = n
      segmentAuto = true
    } else {
      const r = this.loopOf(ks, p)
      s = r.start
      e = r.end
      loop = r.info
      segmentAuto = true
    }
    s = Math.max(0, Math.min(n - 1, Math.round(s)))
    e = Math.max(0, Math.min(n, Math.round(e)))
    if (e - s < 2) throw new Error(`片段太短：第 ${s}–${e - 1} 帧`)
    if (kind === 'loop' && !loop && p.kind === 'auto' && kindFrom === 'diff') loop = this.loopOf(ks, p).info
    const seamDiff = kind === 'loop' ? (e < n ? ks.diff.diff(s, e) : ks.diff.diff(s, e - 1)) : null

    // 抽帧 + 手动换帧
    const pick = kind === 'loop' ? pickLoop(s, e, this.src.fps, p.fps, p.frames) : pickOnce(s, e, this.src.fps, p.fps, p.frames)
    const edits = new Map(o.edits.map((x) => [x.from, x.to] as const))
    const picks: PickedFrame[] = []
    const dropped: number[] = []
    for (const b of pick.picks) {
      if (!edits.has(b)) {
        picks.push({ base: b, frame: b })
        continue
      }
      const to = edits.get(b)
      if (to === null || to === undefined) dropped.push(b)
      else picks.push({ base: b, frame: Math.max(0, Math.min(n - 1, to)) })
    }
    if (picks.length === 0) throw new Error('所有帧都被删掉了')

    // 工作分辨率取帧、抠图
    const work = o.work ?? Math.min(Math.max(this.src.width, this.src.height), Math.max(720, o.height * 12))
    const [ww, wh] = fitSize(this.src.width, this.src.height, work)
    const need = [0, ...picks.map((x) => x.frame)]
    const matteKey = (i: number): string => `${ks.key}|${ww}x${wh}|${p.open}|${p.despill}|${i}`
    // 抠过的帧（包括备用的）不用再解码
    const wf = await this.workFrames(need.filter((i) => !this.mattes.has(matteKey(i)) && !this.spare.has(matteKey(i))), ww, wh, need)
    const wmWork = ks.wmNorm.map((r) => normToPixels(r, ww, wh))
    const matteOf = (i: number): Matte => {
      const key = matteKey(i)
      let m = this.mattes.get(key)
      if (!m) {
        const s = this.spare.get(key)
        if (s) {
          m = unpackMatte(s)
          this.spare.delete(key)
          this.spareBytes -= s.bytes
        } else {
          const f = wf.get(i) as RgbFrame
          const mask = dropSpecks(openMask(ks.keyer.foreground(f, wmWork), p.open), Math.round(ww * wh * 0.0002))
          m = { mask, rgb: p.despill ? despill(f, ks.bg) : f }
        }
        // 不在这里按数量淘汰：一个动作选中的帧可能超过上限（整段单次动作 60 多帧），
        // 边算边淘汰会把这次要用的挤掉，下次全部重算；算完由 retain() 只留这次用到的
        this.mattes.set(key, m)
      }
      return m
    }
    const pm = picks.map((x) => matteOf(x.frame))
    matteOf(0)
    this.retain(need.map((i) => `${ww}x${wh}:${i}`), need.map(matteKey))
    let union: Rect | null = null
    let fgCount = 0
    for (const m of pm) {
      union = unionRect(union, maskBounds(m.mask))
      fgCount += maskCount(m.mask)
    }
    if (!union) throw new Error('没有抠出角色：检查背景色，或调大色相容差 / 距离容差')
    const f0 = matteOf(0).mask
    const b0 = maskBounds(f0)
    const geometry: ActionGeometry = {
      workWidth: ww,
      workHeight: wh,
      workScale: ww / this.src.width,
      union,
      h0: b0 ? b0.y1 - b0.y0 : 0,
      refX: maskCentroidX(f0) ?? (union.x0 + union.x1) / 2,
      ground: union.y1,
      tweak: p.scaleTweak
    }

    const qc = analysisQc({
      frames,
      masks: ks.masks,
      keyer: ks.keyer,
      watermark: ks.wmAnalysis,
      segment: [s, e],
      loop: kind === 'loop',
      death: isDeathAction(o.name),
      period: kind === 'loop' ? (loop?.periodFrames ?? e - s) : null,
      seamDiff,
      diff: ks.diff
    })
    qc.push(watermarkQc(ks.wmSource, ks.wmConflicts))

    const res: AnalyzeResult = {
      info: {
        width: this.src.width,
        height: this.src.height,
        fps: this.src.fps,
        frameCount: n,
        matrix: this.src.color.matrix,
        fullRange: this.src.color.fullRange,
        codec: this.src.codec
      },
      bg: ks.bg,
      keyMode: ks.keyer.mode,
      watermark: { source: ks.wmSource, regions: ks.wmNorm, conflicts: ks.wmConflicts },
      kind,
      kindFrom,
      segment: [s, e],
      segmentAuto,
      loop,
      seamDiff,
      picks,
      dropped,
      fps: pick.fps,
      geometry,
      fgCount,
      qc
    }
    this.current = { picks: picks.map((x) => x.frame), mattes: pm, res }
    this.workSize = [ww, wh]
    this.lastOptions = sig
    return res
  }

  /** 只留当前用到的工作帧和抠图结果（多个动作同时打开时控制内存） */
  private retain(workKeys: string[], matteKeys: string[]): void {
    const w = new Set(workKeys)
    for (const k of [...this.work.keys()]) if (!w.has(k)) this.work.delete(k)
    const m = new Set(matteKeys)
    for (const k of [...this.mattes.keys()]) if (!m.has(k)) this.toSpare(k)
    this.trimSpare()
    this.boxCache.clear()
  }

  /** 这次不用的抠图裁小了留作备用 */
  private toSpare(key: string): void {
    const m = this.mattes.get(key)
    if (!m) return
    this.mattes.delete(key)
    const s = packMatte(m)
    this.spare.set(key, s)
    this.spareBytes += s.bytes
  }

  /** 备用的超出上限时，最近不用的先丢 */
  private trimSpare(): void {
    for (const [k, s] of this.spare) {
      if (this.spareBytes <= SPARE_BYTES) break
      this.spare.delete(k)
      this.spareBytes -= s.bytes
    }
  }

  /**
   * 暂时不用（换了角色、切到别的页面）：抠图全部裁小了留作备用，工作帧丢掉。
   * 回来改参数时从备用里拿，不用重新解码、抠图；之后要先 analyze 才能取样、出图。
   */
  trim(): void {
    for (const k of [...this.mattes.keys()]) this.toSpare(k)
    this.trimSpare()
    this.work.clear()
    this.boxCache.clear()
    this.current = null
    this.lastOptions = null
  }

  /**
   * 角色像素取样（和定妆照比颜色用）：选中各帧抠出来的部分，去掉边缘一圈（混着背景色），
   * 均匀取最多 limit 个像素，RGB 连续排列。
   */
  colorSample(limit = 40000): Uint8Array {
    const { mattes } = this.need()
    const inner = mattes.map((m) => erode(m.mask))
    const total = inner.reduce((t, m) => t + maskCount(m), 0)
    const step = Math.max(1, Math.ceil(total / limit))
    const out = new Uint8Array(Math.ceil(total / step) * 3)
    let k = 0
    let seen = 0
    const u = this.need().res.geometry.union
    inner.forEach((m, j) => {
      const rgb = mattes[j].rgb.data
      for (let y = u.y0; y < u.y1; y++) {
        for (let i = y * m.width + u.x0, end = y * m.width + u.x1; i < end; i++) {
          if (!m.data[i]) continue
          if (seen++ % step === 0 && k + 3 <= out.length) {
            out[k++] = rgb[i * 3]
            out[k++] = rgb[i * 3 + 1]
            out[k++] = rgb[i * 3 + 2]
          }
        }
      }
    })
    return out.subarray(0, k)
  }

  private need(): NonNullable<ActionPipeline['current']> {
    if (!this.current) throw new Error('还没有分析')
    return this.current
  }

  private boxOf(i: number, m: Matte, l: ActionLayout, thr: number): { rgb: Uint8Array; opaque: Uint8Array } {
    const key = `${i}|${l.box.x0},${l.box.y0},${l.box.x1},${l.box.y1}|${l.cw}x${l.ch}|${thr}`
    let r = this.boxCache.get(key)
    if (!r) {
      r = downsampleBox(m.mask, m.rgb, l.box, l.cw, l.ch, thr)
      this.boxCache.set(key, r)
      if (this.boxCache.size > 64) this.boxCache.delete(this.boxCache.keys().next().value as string)
    }
    return r
  }

  /**
   * 调色板取样：mode 取选中帧的前景像素（超过 quota 时固定种子抽样）；box 取缩小后的不透明像素。
   * 返回 RGB 三元组连续排列。
   */
  samples(layout: ActionLayout, resample: SpriteResample, quota: number, alphaThreshold: number): Uint8Array {
    const cur = this.need()
    if (resample === 'box') {
      const parts: number[] = []
      cur.mattes.forEach((m, k) => {
        const r = this.boxOf(k, m, layout, alphaThreshold)
        for (let c = 0; c < r.opaque.length; c++) {
          if (r.opaque[c]) parts.push(r.rgb[c * 3], r.rgb[c * 3 + 1], r.rgb[c * 3 + 2])
        }
      })
      return Uint8Array.from(parts)
    }
    // 前景按顺序编号（前景都在各帧前景的外接框里，只扫这一块），超过 quota 时固定种子抽样；
    // 先定下抽哪几号再按编号顺序扫一遍取色，不用把全部前景像素先拷出来
    const total = cur.res.fgCount
    const u = cur.res.geometry.union
    const n = Math.min(total, quota)
    const out = new Uint8Array(n * 3)
    let slot: Uint32Array
    let wanted: Uint32Array
    if (total <= quota) {
      wanted = slot = Uint32Array.from({ length: n }, (_, k) => k)
    } else {
      const idx = sampleIndicesSparse(total, quota, 0)
      slot = Uint32Array.from({ length: n }, (_, k) => k).sort((a, b) => idx[a] - idx[b])
      wanted = Uint32Array.from(slot, (k) => idx[k])
    }
    let seen = 0
    let p = 0
    for (const m of cur.mattes) {
      const md = m.mask.data
      const px = m.rgb.data
      const w = m.mask.width
      for (let y = u.y0; y < u.y1 && p < n; y++) {
        for (let i = y * w + u.x0, end = y * w + u.x1; i < end; i++) {
          if (!md[i]) continue
          if (seen++ !== wanted[p]) continue
          const o = slot[p++] * 3
          out[o] = px[i * 3]
          out[o + 1] = px[i * 3 + 1]
          out[o + 2] = px[i * 3 + 2]
          if (p >= n) break
        }
      }
    }
    return out
  }

  render(o: RenderOptions): RenderResult {
    const cur = this.need()
    const l = o.layout
    const outline = o.outline ? darkestIndex(o.palette) : null
    const pad = Math.max(o.pad, o.outline ? 1 : 0)
    const frames: Uint8Array[] = []
    const hist: Float64Array[] = []
    cur.mattes.forEach((m, k) => {
      const small: Indexed =
        o.resample === 'box'
          ? indexBox(this.boxOf(k, m, l, o.alphaThreshold), l.cw, l.ch, o.palette)
          : downsampleMode(m.mask, m.rgb, l.box, l.cw, l.ch, o.palette, o.alphaThreshold)
      const h = new Float64Array(o.palette.length)
      for (const j of small.index) if (j !== TRANSPARENT) h[j]++
      hist.push(h)
      frames.push(toRgba(composeCell(small, pad, outline), o.palette))
    })
    return {
      frames,
      frameWidth: l.cw + 2 * pad,
      frameHeight: l.ch + 2 * pad,
      qc: paletteQc(hist, cur.picks)
    }
  }

  /** 源视频的一帧（工作分辨率），裁到 crop（工作分辨率坐标，可小数）并缩放到长边不超过 maxSide；返回 RGBA */
  async sourceImage(
    index: number,
    crop: { x0: number; y0: number; x1: number; y1: number } | null,
    maxSide: number
  ): Promise<{ width: number; height: number; rgba: Uint8Array; crop: Rect }> {
    const [ww, wh] = this.workSize ?? fitSize(this.src.width, this.src.height, 720)
    const f = (await this.workFrames([index], ww, wh)).get(index) as RgbFrame
    const r: Rect = crop
      ? {
          x0: Math.max(0, Math.floor(crop.x0)),
          y0: Math.max(0, Math.floor(crop.y0)),
          x1: Math.min(ww, Math.ceil(crop.x1)),
          y1: Math.min(wh, Math.ceil(crop.y1))
        }
      : { x0: 0, y0: 0, x1: ww, y1: wh }
    const cw = Math.max(1, r.x1 - r.x0)
    const ch = Math.max(1, r.y1 - r.y0)
    const s = Math.min(1, maxSide / Math.max(cw, ch))
    const ow = Math.max(1, Math.round(cw * s))
    const oh = Math.max(1, Math.round(ch * s))
    const rgba = new Uint8Array(ow * oh * 4)
    for (let y = 0; y < oh; y++) {
      const sy = r.y0 + Math.min(ch - 1, Math.floor((y + 0.5) / s))
      for (let x = 0; x < ow; x++) {
        const sx = r.x0 + Math.min(cw - 1, Math.floor((x + 0.5) / s))
        const i = (sy * ww + sx) * 3
        const o = (y * ow + x) * 4
        rgba[o] = f.data[i]
        rgba[o + 1] = f.data[i + 1]
        rgba[o + 2] = f.data[i + 2]
        rgba[o + 3] = 255
      }
    }
    return { width: ow, height: oh, rgba, crop: r }
  }

  /** 时间轴缩略图：所有帧裁到全片前景范围、缩到 height 高，RGBA 依次连续排列 */
  async timeline(height: number): Promise<{ width: number; height: number; count: number; rgba: Uint8Array }> {
    const frames = await this.analysisFrames()
    const { width: aw, height: ah } = frames[0]
    let r: Rect | null = null
    for (const m of this.keyState?.masks ?? []) r = unionRect(r, maskBounds(m))
    const box = r ?? { x0: 0, y0: 0, x1: aw, y1: ah }
    const mx = Math.round((box.x1 - box.x0) * 0.15)
    const my = Math.round((box.y1 - box.y0) * 0.1)
    const c = { x0: Math.max(0, box.x0 - mx), y0: Math.max(0, box.y0 - my), x1: Math.min(aw, box.x1 + mx), y1: Math.min(ah, box.y1 + my) }
    const cw = c.x1 - c.x0
    const ch = c.y1 - c.y0
    const oh = height
    const ow = Math.max(1, Math.round((cw * oh) / ch))
    const rgba = new Uint8Array(ow * oh * 4 * frames.length)
    frames.forEach((f, t) => {
      const base = t * ow * oh * 4
      for (let y = 0; y < oh; y++) {
        const sy = c.y0 + Math.min(ch - 1, Math.floor(((y + 0.5) * ch) / oh))
        for (let x = 0; x < ow; x++) {
          const sx = c.x0 + Math.min(cw - 1, Math.floor(((x + 0.5) * cw) / ow))
          const i = (sy * aw + sx) * 3
          const o = base + (y * ow + x) * 4
          rgba[o] = f.data[i]
          rgba[o + 1] = f.data[i + 1]
          rgba[o + 2] = f.data[i + 2]
          rgba[o + 3] = 255
        }
      }
    })
    return { width: ow, height: oh, count: frames.length, rgba }
  }
}

function watermarkQc(source: WatermarkSource, conflicts: NormRect[]): QcItem {
  if (conflicts.length && source !== 'auto') {
    return {
      id: 'watermark',
      label: '水印',
      value: '与角色重叠，未屏蔽',
      status: 'warn',
      message: '检测到的水印区域和角色重叠，已按角色为准不屏蔽。可以在参数里手动框选水印区域，或选「不屏蔽」。'
    }
  }
  const text: Record<WatermarkSource, string> = {
    auto: '已自动检出并屏蔽',
    fallback: '未检出，屏蔽右下角固定区域',
    manual: '手动框选',
    none: '不屏蔽'
  }
  return { id: 'watermark', label: '水印', value: text[source], status: 'info' }
}

/** 多个动作的调色板取样合在一起后生成共享调色板（总数超过 limit 时固定种子抽样） */
export function sharedPalette(parts: Uint8Array[], colors: number, limit = 300000): Palette {
  const total = parts.reduce((s, p) => s + p.length / 3, 0)
  const all = new Uint8Array(total * 3)
  let o = 0
  for (const p of parts) {
    all.set(p, o)
    o += p.length
  }
  if (total <= limit) return buildPalette(all, colors)
  const idx = sampleIndices(total, limit, 0)
  const pick = new Uint8Array(limit * 3)
  for (let k = 0; k < limit; k++) pick.set(all.subarray(idx[k] * 3, idx[k] * 3 + 3), k * 3)
  return buildPalette(pick, colors)
}

/** 各动作的 mode 取样配额：总数不超过 limit，按前景像素数分配 */
export function sampleQuotas(fgCounts: number[], limit = 300000): number[] {
  const total = fgCounts.reduce((a, b) => a + b, 0)
  if (total <= limit) return fgCounts.slice()
  const q = fgCounts.map((n) => Math.floor((limit * n) / total))
  let rest = limit - q.reduce((a, b) => a + b, 0)
  for (let i = 0; rest > 0 && i < q.length; i++, rest--) q[i]++
  return q
}

/** 透明像素 RGB 为 0 的 RGBA 帧拼成横条（cols 列） */
export function stripRgba(frames: Uint8Array[], fw: number, fh: number, cols: number): { rgba: Uint8Array; width: number; height: number } {
  const c = Math.max(1, Math.min(cols, frames.length))
  const rows = Math.ceil(frames.length / c)
  const W = c * fw
  const H = rows * fh
  const out = new Uint8Array(W * H * 4)
  frames.forEach((f, k) => {
    const ox = (k % c) * fw
    const oy = Math.floor(k / c) * fh
    for (let y = 0; y < fh; y++) out.set(f.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * W + ox) * 4)
  })
  return { rgba: out, width: W, height: H }
}
