// 序列帧 Worker：每个动作一条管线（缓存都留在这里），界面线程只发指令、收结果。
/// <reference lib="webworker" />

import type { ActionLayout } from './core/layout'
import { WebCodecsSource } from './decode/video'
import { ActionPipeline, sharedPalette, type AnalyzeOptions, type RenderOptions } from './pipeline'
import type { WorkerRequest, WorkerResponse } from './protocol'

const pipelines = new Map<string, ActionPipeline>()

function pipelineOf(key: string): ActionPipeline {
  const p = pipelines.get(key)
  if (!p) throw new Error('视频还没有载入')
  return p
}

async function handle(req: WorkerRequest): Promise<{ result: unknown; transfer: Transferable[] }> {
  switch (req.type) {
    case 'load': {
      if (!pipelines.has(req.key)) pipelines.set(req.key, new ActionPipeline(new WebCodecsSource(new Uint8Array(req.bytes))))
      return { result: null, transfer: [] }
    }
    case 'release':
      pipelines.delete(req.key)
      return { result: null, transfer: [] }
    case 'trim':
      pipelines.get(req.key)?.trim()
      return { result: null, transfer: [] }
    case 'analyze':
      return { result: await pipelineOf(req.key).analyze(req.options as AnalyzeOptions), transfer: [] }
    case 'samples': {
      const s = pipelineOf(req.key).samples(req.layout as ActionLayout, req.resample, req.quota, req.alphaThreshold)
      return { result: s, transfer: [s.buffer] }
    }
    case 'palette':
      return { result: sharedPalette(req.parts, req.colors), transfer: [] }
    case 'render': {
      const r = pipelineOf(req.key).render(req.options as RenderOptions)
      return { result: r, transfer: r.frames.map((f) => f.buffer) }
    }
    case 'source': {
      const r = await pipelineOf(req.key).sourceImage(req.frame, req.crop, req.maxSide)
      return { result: r, transfer: [r.rgba.buffer] }
    }
    case 'colorSample': {
      const s = pipelineOf(req.key).colorSample().slice()
      return { result: s, transfer: [s.buffer] }
    }
    case 'timeline': {
      const r = await pipelineOf(req.key).timeline(req.height)
      return { result: r, transfer: [r.rgba.buffer] }
    }
  }
}

// 一个 Worker 里的请求依次执行（管线有内部缓存，不能并发改）
let queue: Promise<void> = Promise.resolve()

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  queue = queue.then(async () => {
    try {
      const { result, transfer } = await handle(req)
      const res: WorkerResponse = { id: req.id, ok: true, result }
      ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer)
    } catch (err) {
      const res: WorkerResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(res)
    }
  })
}
