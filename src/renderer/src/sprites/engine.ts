// 序列帧协调器（界面线程）：Worker 池、按角色处理全部动作。
// 同一角色的所有动作共用一个缩放比、一个落脚点和一套调色板：
//   各动作分析（并行）→ 统一布局 → 调色板取样 → 共享调色板 → 各动作出图（并行）
// 动作单独设了像素身高时按比例换算缩放比；单独设了颜色数时用自己的一套调色板。
// 调色板可以改成从人物主图取色（各动作颜色和设定图一致）。还没有视频的「待生成」动作不参加处理。
// 有定妆照时，每个动作出图后和定妆照比颜色，给出「像不像」的分数；其他视频版本按需单独算分（择优用）。

import { create } from 'zustand'
import { spriteRefUrl, spriteVideoUrl } from '@shared/api'
import type { ID } from '@shared/types'
import { actionFacing, anchorRef, SPRITE_FACING_LABELS, type SpriteAction, type SpriteCharacter, type SpriteOwner, type SpriteRef, type SpriteTake } from '@shared/sprites'
import { anchorMatch, anchorPixels, type AnchorMatch, type ColorPrint } from './core/anchor'
import { layoutCharacter, type ActionLayout, type CharacterLayout } from './core/layout'
import type { Palette } from './core/palette'
import { h0Qc, type QcItem } from './core/qc'
import { sampleQuotas, type AnalyzeResult, type RenderResult } from './pipeline'
import type { WorkerRequest, WorkerResponse } from './protocol'

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

class WorkerClient {
  private readonly worker: Worker
  private seq = 0
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  load = 0

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error))
    }
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || '处理进程出错'))
      this.pending.clear()
    }
  }

  call<T>(req: Req, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage({ ...req, id }, transfer)
    })
  }
}

let pool: WorkerClient[] | null = null
const assigned = new Map<string, WorkerClient>()
const loaded = new Map<string, Promise<void>>()

function workers(): WorkerClient[] {
  if (!pool) {
    const n = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)))
    pool = Array.from({ length: n }, () => new WorkerClient())
  }
  return pool
}

/** 每个动作固定交给一个 Worker（缓存在那里）；新动作给最空闲的 */
function workerFor(key: string): WorkerClient {
  let w = assigned.get(key)
  if (!w) {
    w = workers().reduce((a, b) => (b.load < a.load ? b : a))
    w.load++
    assigned.set(key, w)
  }
  return w
}

export function actionKey(owner: SpriteOwner, ch: SpriteCharacter, a: SpriteAction): string {
  return `${owner ?? 'library'}/${ch.id}/${a.id}/${a.video}`
}

/** 动作的某个视频版本的 key（和它成为当前版本时的 actionKey 一样，切过去时直接用上已载入的） */
function takeKey(owner: SpriteOwner, ch: SpriteCharacter, a: SpriteAction, take: SpriteTake): string {
  return `${owner ?? 'library'}/${ch.id}/${a.id}/${take.video}`
}

/** take 为空时载入当前版本 */
function ensureLoaded(owner: SpriteOwner, ch: SpriteCharacter, a: SpriteAction, take?: SpriteTake): Promise<void> {
  const key = take ? takeKey(owner, ch, a, take) : actionKey(owner, ch, a)
  let p = loaded.get(key)
  if (!p) {
    p = (async () => {
      const res = await fetch(spriteVideoUrl(owner, ch.id, a.id, take?.id))
      if (!res.ok) throw new Error(res.status === 404 ? '源视频不见了' : `读不到源视频（${res.status}）`)
      const bytes = await res.arrayBuffer()
      await workerFor(key).call({ type: 'load', key, bytes }, [bytes])
    })()
    loaded.set(key, p)
    p.catch(() => loaded.delete(key))
  }
  return p
}

/** 不再用的动作（删掉了、换了视频）从 Worker 里释放 */
export function releaseAction(key: string): void {
  const w = assigned.get(key)
  if (!w) return
  void w.call({ type: 'release', key }).catch(() => undefined)
  assigned.delete(key)
  loaded.delete(key)
  analyzedAs.delete(key)
  dormant = dormant.filter((k) => k !== key)
  w.load = Math.max(0, w.load - 1)
}

/** 每个动作最近一次分析用的参数（没变的动作不显示「分析中」） */
const analyzedAs = new Map<string, string>()
/** 暂时不用的动作（换了角色、切到别的页面）：在 Worker 里裁小了留着，回来改参数不用重新解码。最早不用的在前 */
let dormant: string[] = []
const DORMANT_LIMIT = 4

/** 正在给其他版本打分的（打完自己释放，不跟着 retainActions 释放） */
const scoring = new Set<string>()
/** 最近一次 retainActions 要留下的（打完分的版本这时成了当前版本，就不释放） */
let kept = new Set<string>()

/**
 * 当前角色只留这些动作（删掉的、换了视频的释放）；其他角色的动作裁小了暂留，
 * 最多留 DORMANT_LIMIT 个，切回来改参数时不用重新解码、抠图
 */
export function retainActions(keys: Iterable<string>, prefix: string): void {
  kept = new Set(keys)
  dormant = dormant.filter((k) => !kept.has(k))
  for (const key of [...assigned.keys()]) {
    if (kept.has(key) || scoring.has(key) || dormant.includes(key)) continue
    if (key.startsWith(prefix)) {
      releaseAction(key)
      continue
    }
    void assigned.get(key)?.call({ type: 'trim', key }).catch(() => undefined)
    analyzedAs.delete(key)
    dormant.push(key)
  }
  while (dormant.length > DORMANT_LIMIT) releaseAction(dormant[0])
}

/** retainActions 的 prefix：这个角色的动作 key 都以它开头 */
export function characterPrefix(owner: SpriteOwner, ch: SpriteCharacter): string {
  return `${owner ?? 'library'}/${ch.id}/`
}

/** 这个角色的处理结果是否就是按当前数据算出来的（待生成的动作、分组和说明不影响结果） */
export function characterSignature(ch: SpriteCharacter): string {
  const ref = ch.settings.paletteFrom === 'reference' ? ch.mainRef : null
  const anchors = ch.refs.filter((r) => r.facing).map((r) => [r.facing, r.id])
  return JSON.stringify([ch.settings, ref, anchors, ch.view, ch.actions.filter((a) => a.video).map((a) => [a.id, a.video, a.name, a.params, a.edits])])
}

// ---------- 定妆照比对 ----------

const printCache = new Map<string, Promise<ColorPrint>>()

/** 定妆照的颜色指纹 */
function anchorPrintOf(owner: SpriteOwner, chId: ID, ref: SpriteRef): Promise<ColorPrint> {
  const key = `${owner ?? 'library'}/${chId}/${ref.id}`
  let p = printCache.get(key)
  if (!p) {
    p = (async () => {
      const big = Math.max(ref.width, ref.height) > 1600
      const res = await fetch(spriteRefUrl(owner, chId, ref.id, big ? 1600 : undefined))
      if (!res.ok) throw new Error('读不到定妆照')
      const bmp = await createImageBitmap(await res.blob())
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('读不到定妆照')
      ctx.drawImage(bmp, 0, 0)
      const { width: w, height: h } = bmp
      bmp.close()
      return anchorPixels(ctx.getImageData(0, 0, w, h).data, w, h)
    })()
    printCache.set(key, p)
    p.catch(() => printCache.delete(key))
  }
  return p
}

/** 分数到这个以上算「像」；低于时质检里提醒 */
export const ANCHOR_OK = 0.8

function anchorQc(m: AnchorMatch, label: string): QcItem {
  const value = `${Math.round(m.score * 100)}%`
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  return m.score >= ANCHOR_OK
    ? { id: 'anchor', label: `和定妆照（${label}）相似`, value, status: 'ok', raw: m.score }
    : {
        id: 'anchor',
        label: `和定妆照（${label}）相似`,
        value,
        status: 'warn',
        raw: m.score,
        message: `颜色和定妆照差别较大：多出 ${pct(m.added)} 定妆照里没有的颜色，少了 ${pct(m.missing)} 定妆照里有的颜色，衣服、配件、肤色可能变了。可以换一个版本，或用定妆照当首帧重新生成。`
      }
}

/** 其他视频版本和定妆照的相似度（key → 0–1；算不出时 null） */
export const useTakeScores = create<Record<string, number | null>>(() => ({}))

export function takeScoreKey(owner: SpriteOwner, ch: SpriteCharacter, a: SpriteAction, take: SpriteTake, refId: ID): string {
  return `${takeKey(owner, ch, a, take)}|${JSON.stringify([take.start, take.end, take.edits, a.params, ch.settings.height, ch.settings.work])}|${refId}`
}

let scoreQueue: Promise<void> = Promise.resolve()

/**
 * 给不是当前版本的视频打分（一次只算一个，算完释放）。分析参数和切换到这个版本后一样，
 * 所以分数和切过去后质检里显示的一致。
 */
export function scoreTake(owner: SpriteOwner, ch: SpriteCharacter, a: SpriteAction, take: SpriteTake): void {
  const ref = anchorRef(ch, actionFacing(ch.view, a.name))
  if (!ref || take.video === a.video) return
  const sk = takeScoreKey(owner, ch, a, take, ref.id)
  if (sk in useTakeScores.getState()) return
  useTakeScores.setState({ [sk]: Number.NaN })
  scoreQueue = scoreQueue.then(async () => {
    const key = takeKey(owner, ch, a, take)
    scoring.add(key)
    let score: number | null = null
    try {
      const print = await anchorPrintOf(owner, ch.id, ref)
      await ensureLoaded(owner, ch, a, take)
      const w = workerFor(key)
      await w.call({
        type: 'analyze',
        key,
        options: { name: a.name, params: { ...a.params, start: take.start, end: take.end }, edits: take.edits, height: a.params.height ?? ch.settings.height, work: ch.settings.work }
      })
      score = anchorMatch(print, await w.call<Uint8Array>({ type: 'colorSample', key })).score
    } catch {
      score = null
    } finally {
      scoring.delete(key)
      if (!kept.has(key)) releaseAction(key)
    }
    useTakeScores.setState({ [sk]: score })
  })
}

// ---------- 人物图取色 ----------

const refCache = new Map<string, Promise<Uint8Array>>()

/**
 * 人物图里角色部分的像素（RGB 连续排列）：缩到长边 256 再取（颜色接近像素化后的样子）；
 * 有透明像素按透明度去背景，否则取四条边最常见的颜色当背景去掉。
 */
function refPixels(owner: SpriteOwner, chId: ID, refId: ID): Promise<Uint8Array> {
  const key = `${owner ?? 'library'}/${chId}/${refId}`
  let p = refCache.get(key)
  if (!p) {
    p = (async () => {
      const res = await fetch(spriteRefUrl(owner, chId, refId, 512))
      if (!res.ok) throw new Error('读不到人物图')
      const bmp = await createImageBitmap(await res.blob())
      const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * k))
      const h = Math.max(1, Math.round(bmp.height * k))
      const ctx = new OffscreenCanvas(w, h).getContext('2d')
      if (!ctx) throw new Error('读不到人物图')
      ctx.drawImage(bmp, 0, 0, w, h)
      bmp.close()
      const d = ctx.getImageData(0, 0, w, h).data
      let transparent = false
      for (let i = 3; i < d.length; i += 4) if (d[i] < 128) { transparent = true; break }
      let bg: [number, number, number] | null = null
      if (!transparent) {
        const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
        const add = (x: number, y: number): void => {
          const i = (y * w + x) * 4
          const kk = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)
          const bin = bins.get(kk) ?? { n: 0, r: 0, g: 0, b: 0 }
          bin.n++
          bin.r += d[i]
          bin.g += d[i + 1]
          bin.b += d[i + 2]
          bins.set(kk, bin)
        }
        for (let x = 0; x < w; x++) add(x, 0), add(x, h - 1)
        for (let y = 0; y < h; y++) add(0, y), add(w - 1, y)
        const top = [...bins.values()].reduce((a, b) => (b.n > a.n ? b : a))
        bg = [top.r / top.n, top.g / top.n, top.b / top.n]
      }
      const out: number[] = []
      const all: number[] = []
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue
        all.push(d[i], d[i + 1], d[i + 2])
        if (bg && Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) < 48) continue
        out.push(d[i], d[i + 1], d[i + 2])
      }
      // 去完背景几乎不剩时（比如整张都是角色），就用整张图
      return Uint8Array.from(out.length >= 150 ? out : all)
    })()
    refCache.set(key, p)
    p.catch(() => refCache.delete(key))
  }
  return p
}

// ---------- 结果 ----------

export type ActionPhase = 'loading' | 'analyzing' | 'rendering' | 'done' | 'error'

export interface ActionOutput {
  actionId: ID
  key: string
  analysis: AnalyzeResult
  layout: ActionLayout
  /** 这个动作用的调色板 */
  palette: Palette
  /** 单独设了颜色数、用自己的调色板 */
  ownPalette: boolean
  frames: Uint8Array[]
  frameWidth: number
  frameHeight: number
  qc: QcItem[]
  warnings: number
  /** 和定妆照的相似度 0–1；没有定妆照时 null */
  anchorScore: number | null
}

export interface CharacterOutput {
  /** 共用调色板（全部动作都单独设了颜色数时是第一个动作的） */
  palette: Palette
  layout: CharacterLayout
  actions: ActionOutput[]
  /** 角色级质检（首帧身高） */
  qc: QcItem[]
  /** 这次处理用的角色数据（导出时据此核对） */
  character: SpriteCharacter
  ms: number
}

export interface CharacterRun {
  running: boolean
  phases: Record<ID, ActionPhase>
  errors: Record<ID, string>
  output: CharacterOutput | null
}

export const useSpriteRuns = create<Record<ID, CharacterRun>>(() => ({}))

const versions = new Map<ID, number>()

function patchRun(id: ID, p: Partial<CharacterRun> | ((r: CharacterRun) => Partial<CharacterRun>)): void {
  useSpriteRuns.setState((s) => {
    const cur: CharacterRun = s[id] ?? { running: false, phases: {}, errors: {}, output: null }
    const next = typeof p === 'function' ? p(cur) : p
    return { [id]: { ...cur, ...next } }
  })
}

function setPhase(id: ID, actionId: ID, phase: ActionPhase, error?: string): void {
  patchRun(id, (r) => ({
    phases: { ...r.phases, [actionId]: phase },
    errors: error === undefined ? omit(r.errors, actionId) : { ...r.errors, [actionId]: error }
  }))
}

function omit<T>(o: Record<string, T>, k: string): Record<string, T> {
  if (!(k in o)) return o
  const c = { ...o }
  delete c[k]
  return c
}

/**
 * 处理一个角色的全部动作。同一角色再次调用时，前一次的结果作废（只显示最新的）。
 * 返回最新结果；被更新的调用取代时返回 null。
 */
export async function processCharacter(owner: SpriteOwner, ch: SpriteCharacter): Promise<CharacterOutput | null> {
  const version = (versions.get(ch.id) ?? 0) + 1
  versions.set(ch.id, version)
  const stale = (): boolean => versions.get(ch.id) !== version
  const t0 = performance.now()
  const s = ch.settings
  patchRun(ch.id, { running: true })
  const acts = ch.actions.filter((a) => a.video)
  if (acts.length === 0) {
    patchRun(ch.id, { running: false, phases: {}, errors: {}, output: null })
    return null
  }

  // 1) 各动作分析（并行）
  const analyzed = await Promise.all(
    acts.map(async (a) => {
      const key = actionKey(owner, ch, a)
      try {
        if (!loaded.has(key)) setPhase(ch.id, a.id, 'loading')
        await ensureLoaded(owner, ch, a)
        if (stale()) return null
        const options = { name: a.name, params: a.params, edits: a.edits, height: a.params.height ?? s.height, work: s.work }
        const sig = JSON.stringify(options)
        if (analyzedAs.get(key) !== sig) setPhase(ch.id, a.id, 'analyzing')
        const analysis = await workerFor(key).call<AnalyzeResult>({ type: 'analyze', key, options })
        analyzedAs.set(key, sig)
        return { a, key, analysis }
      } catch (err) {
        if (!stale()) setPhase(ch.id, a.id, 'error', err instanceof Error ? err.message : String(err))
        return null
      }
    })
  )
  if (stale()) return null
  const ok = analyzed.filter((x): x is NonNullable<typeof x> => x !== null)
  if (ok.length === 0) {
    patchRun(ch.id, { running: false, output: null })
    return null
  }

  // 2) 统一布局
  const layout = layoutCharacter(
    ok.map((x) => x.analysis.geometry),
    { height: s.height, pad: s.pad, outline: s.outline, unifiedCanvas: s.unifiedCanvas, heights: ok.map((x) => x.a.params.height) }
  )

  // 3) 调色板取样 → 共享调色板（单独设了颜色数的动作各用一套）；从人物图取色时样本换成人物图的像素
  let fromRef: Uint8Array | null = null
  let refFailed = false
  if (s.paletteFrom === 'reference' && ch.mainRef) {
    try {
      fromRef = await refPixels(owner, ch.id, ch.mainRef)
    } catch {
      refFailed = true
    }
    if (stale()) return null
  }
  const shared = ok.map((_, i) => i).filter((i) => ok[i].a.params.colors === null)
  const own = ok.map((_, i) => i).filter((i) => ok[i].a.params.colors !== null)
  const sharedQuotas = sampleQuotas(shared.map((i) => ok[i].analysis.fgCount))
  const samplesOf = (i: number, quota: number): Promise<Uint8Array> =>
    workerFor(ok[i].key).call<Uint8Array>({
      type: 'samples',
      key: ok[i].key,
      layout: layout.actions[i],
      resample: s.resample,
      quota,
      alphaThreshold: ok[i].a.params.alphaThreshold
    })
  const paletteOf = (key: string, parts: Uint8Array[], colors: number): Promise<Palette> =>
    workerFor(key).call<Palette>({ type: 'palette', parts, colors }, parts.map((p) => p.buffer))
  const palettes: Palette[] = []
  let sharedPalette: Palette | null = null
  try {
    const [sharedParts, ownParts] = fromRef
      ? [[fromRef.slice()], own.map(() => (fromRef as Uint8Array).slice())]
      : await Promise.all([
          Promise.all(shared.map((i, k) => samplesOf(i, sharedQuotas[k]))),
          Promise.all(own.map((i) => samplesOf(i, sampleQuotas([ok[i].analysis.fgCount])[0])))
        ])
    if (stale()) return null
    const [sp, ...op] = await Promise.all([
      shared.length ? paletteOf(ok[shared[0]].key, sharedParts, s.colors) : Promise.resolve(null),
      ...own.map((i, k) => paletteOf(ok[i].key, [ownParts[k]], ok[i].a.params.colors ?? s.colors))
    ])
    sharedPalette = sp
    for (const i of shared) palettes[i] = sp as Palette
    own.forEach((i, k) => (palettes[i] = op[k] as Palette))
  } catch (err) {
    if (!stale()) {
      for (const x of ok) setPhase(ch.id, x.a.id, 'error', err instanceof Error ? err.message : String(err))
      patchRun(ch.id, { running: false })
    }
    return null
  }
  if (stale()) return null

  // 有定妆照的动作：出图后和定妆照比颜色
  const prints = await Promise.all(
    ok.map(async (x) => {
      const facing = actionFacing(ch.view, x.a.name)
      const ref = anchorRef(ch, facing)
      if (!ref) return null
      try {
        return { print: await anchorPrintOf(owner, ch.id, ref), label: SPRITE_FACING_LABELS[facing] }
      } catch {
        return null
      }
    })
  )
  if (stale()) return null

  // 4) 各动作出图（并行）
  const rendered = await Promise.all(
    ok.map(async (x, i) => {
      setPhase(ch.id, x.a.id, 'rendering')
      try {
        const r = await workerFor(x.key).call<RenderResult>({
          type: 'render',
          key: x.key,
          options: {
            layout: layout.actions[i],
            palette: palettes[i],
            resample: s.resample,
            outline: s.outline,
            pad: s.pad,
            alphaThreshold: x.a.params.alphaThreshold
          }
        })
        const qc = [...x.analysis.qc, r.qc]
        let anchorScore: number | null = null
        const pr = prints[i]
        if (pr) {
          try {
            const m = anchorMatch(pr.print, await workerFor(x.key).call<Uint8Array>({ type: 'colorSample', key: x.key }))
            anchorScore = m.score
            qc.push(anchorQc(m, pr.label))
          } catch {
            anchorScore = null
          }
        }
        const out: ActionOutput = {
          actionId: x.a.id,
          key: x.key,
          analysis: x.analysis,
          layout: layout.actions[i],
          palette: palettes[i],
          ownPalette: x.a.params.colors !== null,
          frames: r.frames,
          frameWidth: r.frameWidth,
          frameHeight: r.frameHeight,
          qc,
          warnings: qc.filter((q) => q.status === 'warn').length,
          anchorScore
        }
        if (!stale()) setPhase(ch.id, x.a.id, 'done')
        return out
      } catch (err) {
        if (!stale()) setPhase(ch.id, x.a.id, 'error', err instanceof Error ? err.message : String(err))
        return null
      }
    })
  )
  if (stale()) return null
  const actions = rendered.filter((x): x is ActionOutput => x !== null)
  const output: CharacterOutput = {
    palette: sharedPalette ?? palettes[0],
    layout,
    actions,
    qc: [h0Qc(layout.h0Spread, layout.h0Inconsistent), ...paletteQc(s.paletteFrom === 'reference', !!ch.mainRef, refFailed)],
    character: ch,
    ms: Math.round(performance.now() - t0)
  }
  patchRun(ch.id, { running: false, output })
  return output
}

/** 调色板取色来源（只在选了「人物图」时显示） */
function paletteQc(wanted: boolean, hasRef: boolean, failed: boolean): QcItem[] {
  if (!wanted) return []
  if (!hasRef) return [{ id: 'palette-ref', label: '调色板取色', value: '没有人物图', status: 'warn', message: '还没有人物主图，先用视频取色。到「人物素材」里添加人物图。' }]
  if (failed) return [{ id: 'palette-ref', label: '调色板取色', value: '人物图读不出', status: 'warn', message: '人物主图读不出来，先用视频取色。换一张 PNG / JPG 试试。' }]
  return [{ id: 'palette-ref', label: '调色板取色', value: '人物图', status: 'ok' }]
}

/** 源视频的一帧（对比视图、框选水印用） */
export function sourceFrame(
  key: string,
  frame: number,
  crop: { x0: number; y0: number; x1: number; y1: number } | null,
  maxSide: number
): Promise<{ width: number; height: number; rgba: Uint8Array; crop: { x0: number; y0: number; x1: number; y1: number } }> {
  return workerFor(key).call({ type: 'source', key, frame, crop, maxSide })
}

/** 时间轴缩略图 */
export function timelineThumbs(key: string, height: number): Promise<{ width: number; height: number; count: number; rgba: Uint8Array }> {
  return workerFor(key).call({ type: 'timeline', key, height })
}
