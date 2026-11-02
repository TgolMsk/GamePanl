// 序列帧协调器（界面线程）：Worker 池、按角色处理全部动作。
// 同一角色的所有动作共用一个缩放比、一个落脚点和一套调色板：
//   各动作分析（并行）→ 统一布局 → 调色板取样 → 共享调色板 → 各动作出图（并行）

import { create } from 'zustand'
import { spriteVideoUrl } from '@shared/api'
import type { ID } from '@shared/types'
import type { SpriteAction, SpriteCharacter } from '@shared/sprites'
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

export function actionKey(projectId: ID, ch: SpriteCharacter, a: SpriteAction): string {
  return `${projectId}/${ch.id}/${a.id}/${a.video}`
}

function ensureLoaded(projectId: ID, ch: SpriteCharacter, a: SpriteAction): Promise<void> {
  const key = actionKey(projectId, ch, a)
  let p = loaded.get(key)
  if (!p) {
    p = (async () => {
      const res = await fetch(spriteVideoUrl(projectId, ch.id, a.id))
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
  w.load = Math.max(0, w.load - 1)
}

/** 只留下这些动作在 Worker 里（换角色、删动作、换视频后释放其他的，省内存） */
export function retainActions(keys: Iterable<string>): void {
  const keep = new Set(keys)
  for (const key of [...assigned.keys()]) if (!keep.has(key)) releaseAction(key)
}

/** 这个角色的处理结果是否就是按当前数据算出来的 */
export function characterSignature(ch: SpriteCharacter): string {
  return JSON.stringify([ch.settings, ch.actions.map((a) => [a.id, a.video, a.name, a.params, a.edits])])
}

// ---------- 结果 ----------

export type ActionPhase = 'loading' | 'analyzing' | 'rendering' | 'done' | 'error'

export interface ActionOutput {
  actionId: ID
  key: string
  analysis: AnalyzeResult
  layout: ActionLayout
  frames: Uint8Array[]
  frameWidth: number
  frameHeight: number
  qc: QcItem[]
  warnings: number
}

export interface CharacterOutput {
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
export async function processCharacter(projectId: ID, ch: SpriteCharacter): Promise<CharacterOutput | null> {
  const version = (versions.get(ch.id) ?? 0) + 1
  versions.set(ch.id, version)
  const stale = (): boolean => versions.get(ch.id) !== version
  const t0 = performance.now()
  const s = ch.settings
  patchRun(ch.id, { running: true })
  if (ch.actions.length === 0) {
    patchRun(ch.id, { running: false, phases: {}, errors: {}, output: null })
    return null
  }

  // 1) 各动作分析（并行）
  const analyzed = await Promise.all(
    ch.actions.map(async (a) => {
      const key = actionKey(projectId, ch, a)
      try {
        if (!loaded.has(key)) setPhase(ch.id, a.id, 'loading')
        await ensureLoaded(projectId, ch, a)
        if (stale()) return null
        setPhase(ch.id, a.id, 'analyzing')
        const analysis = await workerFor(key).call<AnalyzeResult>({
          type: 'analyze',
          key,
          options: { name: a.name, params: a.params, edits: a.edits, height: s.height, work: s.work }
        })
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
    { height: s.height, pad: s.pad, outline: s.outline, unifiedCanvas: s.unifiedCanvas }
  )

  // 3) 调色板取样 → 共享调色板
  const quotas = sampleQuotas(ok.map((x) => x.analysis.fgCount))
  let palette: Palette
  try {
    const parts = await Promise.all(
      ok.map((x, i) =>
        workerFor(x.key).call<Uint8Array>({
          type: 'samples',
          key: x.key,
          layout: layout.actions[i],
          resample: s.resample,
          quota: quotas[i],
          alphaThreshold: x.a.params.alphaThreshold
        })
      )
    )
    if (stale()) return null
    palette = await workerFor(ok[0].key).call<Palette>(
      { type: 'palette', parts, colors: s.colors },
      parts.map((p) => p.buffer)
    )
  } catch (err) {
    if (!stale()) {
      for (const x of ok) setPhase(ch.id, x.a.id, 'error', err instanceof Error ? err.message : String(err))
      patchRun(ch.id, { running: false })
    }
    return null
  }
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
            palette,
            resample: s.resample,
            outline: s.outline,
            pad: s.pad,
            alphaThreshold: x.a.params.alphaThreshold
          }
        })
        const qc = [...x.analysis.qc, r.qc]
        const out: ActionOutput = {
          actionId: x.a.id,
          key: x.key,
          analysis: x.analysis,
          layout: layout.actions[i],
          frames: r.frames,
          frameWidth: r.frameWidth,
          frameHeight: r.frameHeight,
          qc,
          warnings: qc.filter((q) => q.status === 'warn').length
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
    palette,
    layout,
    actions,
    qc: [h0Qc(layout.h0Spread, layout.h0Inconsistent)],
    character: ch,
    ms: Math.round(performance.now() - t0)
  }
  patchRun(ch.id, { running: false, output })
  return output
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
