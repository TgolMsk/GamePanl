// 自动质检：在分析分辨率上算（代价很小），给出数值和结论。阈值都是初始值，后续用真实视频校准。

import { rgbToHsv } from './color'
import type { Keyer } from './keying'
import type { FrameDiff } from './loop'
import { maskBounds, maskCentroidX, type Mask, type Rect, type RgbFrame } from './util'

export type QcStatus = 'ok' | 'warn' | 'info' | 'na'

export interface QcItem {
  id: string
  label: string
  /** 显示的数值，如「1.7%」 */
  value: string
  status: QcStatus
  /** 原因和建议 */
  message?: string
  /** 点击跳到的源视频帧号 */
  frame?: number
  /** 原始数值（写进 report.json） */
  raw?: number | null
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

export interface AnalysisQcInput {
  frames: RgbFrame[]
  /** 屏蔽水印后的前景掩码（分析分辨率，全部帧） */
  masks: Mask[]
  keyer: Keyer
  watermark: Rect[]
  segment: [number, number]
  loop: boolean
  death: boolean
  /** 循环周期（帧）；单次或未检测时为 null */
  period: number | null
  /** 首尾差异（循环）；没有时 null */
  seamDiff: number | null
  diff: FrameDiff
}

export function analysisQc(q: AnalysisQcInput): QcItem[] {
  const items: QcItem[] = []
  const { frames, masks } = q
  const n = frames.length
  const { width: w, height: h } = frames[0]
  const inWm = (x: number, y: number): boolean => q.watermark.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)

  // 背景纯色：四周边框（水印区除外）各通道的标准差；边框中位色的帧间变化。
  // 只看边框：被当成背景抠掉的还有脚下同色调的投影，算进去标准差会虚高
  {
    const step = Math.max(1, Math.floor(n / 30))
    const b = Math.max(2, Math.floor(Math.min(h, w) / 40))
    const sum = [0, 0, 0]
    const sq = [0, 0, 0]
    let cnt = 0
    const meds: number[][] = []
    for (let t = 0; t < n; t += step) {
      const vals: number[][] = [[], [], []]
      const f = frames[t].data
      const m = masks[t].data
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (y >= b && y < h - b && x >= b && x < w - b) continue
          if (inWm(x, y)) continue
          const i = (y * w + x) * 3
          vals[0].push(f[i])
          vals[1].push(f[i + 1])
          vals[2].push(f[i + 2])
          // 角色碰到边框的那几个像素不算背景
          if (m[y * w + x]) continue
          for (let c = 0; c < 3; c++) {
            sum[c] += f[i + c]
            sq[c] += f[i + c] * f[i + c]
          }
          cnt++
        }
      }
      meds.push(vals.map((v) => v.sort((a, c) => a - c)[v.length >> 1] ?? 0))
    }
    const std = cnt ? Math.max(...[0, 1, 2].map((c) => Math.sqrt(Math.max(0, sq[c] / cnt - (sum[c] / cnt) ** 2)))) : 0
    const drift = Math.max(...[0, 1, 2].map((c) => Math.max(...meds.map((m) => m[c])) - Math.min(...meds.map((m) => m[c]))))
    const warn = std > 8 || drift > 6
    items.push({
      id: 'background',
      label: '背景纯色',
      value: `标准差 ${std.toFixed(1)} · 帧间 ${drift}`,
      status: warn ? 'warn' : 'ok',
      raw: std,
      message: warn
        ? `背景不够纯（标准差 ${std.toFixed(1)}，帧间变化 ${drift}）。边缘可能残留背景色杂点，建议重新生成视频，或在参数里调大色相容差。`
        : undefined
    })
  }

  // 水平漂移：每帧前景质心 x 的极差
  {
    const xs: Array<number | null> = masks.map(maskCentroidX)
    const valid = xs.filter((v): v is number => v !== null)
    if (valid.length) {
      const lo = Math.min(...valid)
      const hi = Math.max(...valid)
      const v = (hi - lo) / w
      const mid = (lo + hi) / 2
      let worst = 0
      xs.forEach((x, i) => {
        if (x !== null && Math.abs(x - mid) > Math.abs((xs[worst] ?? mid) - mid)) worst = i
      })
      items.push({
        id: 'drift',
        label: '水平漂移',
        value: pct(v),
        status: v > 0.04 ? 'warn' : 'ok',
        raw: v,
        frame: v > 0.04 ? worst : undefined,
        message: v > 0.04 ? `角色在横向移动（漂移 ${pct(v)}）。建议重新生成视频，或手动缩短片段。` : undefined
      })
    }
  }

  // 地面线、大小稳定：按循环周期分段比较
  {
    const P = q.loop ? q.period : null
    const cycles: Array<{ ground: number; height: number; at: number }> = []
    if (P && P >= 2) {
      for (let k = 0; (k + 1) * P <= n; k++) {
        let ground = -1
        const heights: number[] = []
        for (let t = k * P; t < (k + 1) * P; t++) {
          const r = maskBounds(masks[t])
          if (!r) continue
          ground = Math.max(ground, r.y1)
          heights.push(r.y1 - r.y0)
        }
        if (ground < 0) continue
        heights.sort((a, b) => a - b)
        cycles.push({ ground, height: heights[heights.length >> 1], at: k * P })
      }
    }
    if (cycles.length >= 2) {
      const gs = cycles.map((c) => c.ground)
      const gv = (Math.max(...gs) - Math.min(...gs)) / h
      const gw = gv > 0.015
      items.push({
        id: 'ground',
        label: '地面线稳定',
        value: pct(gv),
        status: gw ? 'warn' : 'ok',
        raw: gv,
        frame: gw ? cycles[gs.indexOf(Math.min(...gs))].at : undefined,
        message: gw
          ? `脚的高度在各周期之间变化 ${pct(gv)}，播放时会上下跳。建议重新生成视频，或把片段缩短在一个平稳的周期里。`
          : undefined
      })
      const hs = cycles.map((c) => c.height)
      const hm = hs.slice().sort((a, b) => a - b)[hs.length >> 1] || 1
      const hv = (Math.max(...hs) - Math.min(...hs)) / hm
      const hw = hv > 0.04
      items.push({
        id: 'size',
        label: '大小稳定',
        value: pct(hv),
        status: hw ? 'warn' : 'ok',
        raw: hv,
        frame: hw ? cycles[hs.indexOf(Math.max(...hs))].at : undefined,
        message: hw ? `角色在各周期之间忽大忽小（${pct(hv)}），可能有推拉镜头。建议重新生成视频。` : undefined
      })
    } else {
      items.push({ id: 'ground', label: '地面线稳定', value: q.loop ? '周期不足 2 个' : '单次动作', status: 'na' })
      items.push({ id: 'size', label: '大小稳定', value: q.loop ? '周期不足 2 个' : '单次动作', status: 'na' })
    }
  }

  // 出画：片段里的前景碰到画面边缘（水印区除外）
  {
    let first = -1
    for (let t = q.segment[0]; t < q.segment[1] && first < 0; t++) {
      const m = masks[t].data
      const touch = (x: number, y: number): boolean => m[y * w + x] === 1 && !inWm(x, y)
      for (let x = 0; x < w && first < 0; x++) if (touch(x, 0) || touch(x, h - 1)) first = t
      for (let y = 0; y < h && first < 0; y++) if (touch(0, y) || touch(w - 1, y)) first = t
    }
    items.push({
      id: 'edge',
      label: '出画',
      value: first < 0 ? '无' : `第 ${first} 帧`,
      status: first < 0 ? 'ok' : 'warn',
      frame: first < 0 ? undefined : first,
      message:
        first < 0
          ? undefined
          : `角色在第 ${first} 帧碰到画面边缘，可能被截掉一部分。建议重新生成视频（让角色小一些），或换掉这几帧。`
    })
  }

  // 循环衔接 / 单次回位
  if (q.loop) {
    const d = q.seamDiff
    items.push(
      d === null
        ? { id: 'seam', label: '循环衔接', value: '—', status: 'na' }
        : {
            id: 'seam',
            label: '循环衔接',
            value: d.toFixed(3),
            status: d > 0.08 ? 'warn' : 'ok',
            raw: d,
            frame: d > 0.08 ? q.segment[0] : undefined,
            message:
              d > 0.08
                ? `首尾差异 ${d.toFixed(3)}，循环播放到接缝处会跳一下。建议调整片段起止，或重新生成视频。`
                : undefined
          }
    )
    items.push({ id: 'return', label: '单次回位', value: '循环动作', status: 'na' })
  } else {
    items.push({ id: 'seam', label: '循环衔接', value: '单次动作', status: 'na' })
    if (q.death) {
      items.push({ id: 'return', label: '单次回位', value: '死亡动作不检查', status: 'na' })
    } else {
      const last = Math.max(q.segment[0], q.segment[1] - 1)
      const d = q.diff.maskDiff(q.segment[0], last)
      items.push({
        id: 'return',
        label: '单次回位',
        value: d.toFixed(3),
        status: d > 0.15 ? 'warn' : 'ok',
        raw: d,
        frame: d > 0.15 ? last : undefined,
        message:
          d > 0.15
            ? `最后一帧没有回到起始的备战姿势（差异 ${d.toFixed(3)}），切回待机时会跳。建议把片段结束点往后拖，或重新生成视频。`
            : undefined
      })
    }
  }

  // 投影：被去掉的背景色系暗区占角色面积的比例（只提示）
  {
    let shadow = 0
    let fg = 0
    const v0 = q.keyer.v0
    for (let t = q.segment[0]; t < q.segment[1]; t++) {
      const m = masks[t]
      const r = maskBounds(m)
      if (!r) continue
      const mx = Math.round(w * 0.05)
      const my = Math.round(h * 0.05)
      const f = frames[t].data
      for (let y = Math.max(0, r.y0 - my); y < Math.min(h, r.y1 + my); y++) {
        for (let x = Math.max(0, r.x0 - mx); x < Math.min(w, r.x1 + mx); x++) {
          const p = y * w + x
          if (m.data[p]) {
            fg++
            continue
          }
          if (inWm(x, y)) continue
          const i = p * 3
          if (q.keyer.mode !== 'hue') continue
          const [, , v] = rgbToHsv(f[i] / 255, f[i + 1] / 255, f[i + 2] / 255)
          if (v < v0 * 0.7) shadow++
        }
      }
    }
    const ratio = fg ? shadow / fg : 0
    items.push({
      id: 'shadow',
      label: '投影',
      value: ratio > 0.01 ? `有投影，已去除（${pct(ratio)}）` : '无',
      status: 'info',
      raw: ratio,
      message: ratio > 0.01 ? '脚下的同色系投影已随背景一起去掉。' : undefined
    })
  }
  return items
}

/** 配色稳定：每帧各调色板颜色的占比与第 0 帧的 L1 距离 */
export function paletteQc(histograms: Float64Array[], sourceFrames: number[]): QcItem {
  if (histograms.length < 2) return { id: 'palette', label: '配色稳定', value: '—', status: 'na' }
  const norm = histograms.map((hgm) => {
    const s = hgm.reduce((a, b) => a + b, 0) || 1
    return Array.from(hgm, (v) => v / s)
  })
  let worst = 0
  let wi = 0
  for (let k = 1; k < norm.length; k++) {
    let d = 0
    for (let j = 0; j < norm[0].length; j++) d += Math.abs(norm[k][j] - norm[0][j])
    if (d > worst) {
      worst = d
      wi = k
    }
  }
  const warn = worst > 0.35
  return {
    id: 'palette',
    label: '配色稳定',
    value: worst.toFixed(3),
    status: warn ? 'warn' : 'ok',
    raw: worst,
    frame: warn ? sourceFrames[wi] : undefined,
    message: warn
      ? `第 ${sourceFrames[wi]} 帧的配色和第一帧差别较大（${worst.toFixed(3)}），可能有闪烁或外观变化。可以在帧条里把它换成相邻的源帧。`
      : undefined
  }
}

/** 角色模式：各动作首帧身高 */
export function h0Qc(spread: number | null, inconsistent: boolean): QcItem {
  if (spread === null) return { id: 'h0', label: '首帧身高', value: '单个动作', status: 'na' }
  return {
    id: 'h0',
    label: '首帧身高',
    value: `相差 ${pct(spread)}`,
    status: inconsistent ? 'warn' : 'ok',
    raw: spread,
    message: inconsistent
      ? `各动作首帧身高不一致（相差 ${pct(spread)}），已按各自的首帧身高归一化。如果某个视频第 0 帧不是站姿，用这个动作的「比例微调」修正。`
      : undefined
  }
}
