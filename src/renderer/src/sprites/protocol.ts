// 界面线程和序列帧 Worker 之间的消息。

import type { SpriteResample } from '@shared/sprites'
import type { ActionLayout } from './core/layout'
import type { Palette } from './core/palette'
import type { AnalyzeOptions, RenderOptions } from './pipeline'

export type WorkerRequest =
  | { id: number; type: 'load'; key: string; bytes: ArrayBuffer }
  | { id: number; type: 'release'; key: string }
  | { id: number; type: 'trim'; key: string }
  | { id: number; type: 'analyze'; key: string; options: AnalyzeOptions }
  | {
      id: number
      type: 'samples'
      key: string
      layout: ActionLayout
      resample: SpriteResample
      quota: number
      alphaThreshold: number
    }
  | { id: number; type: 'palette'; parts: Uint8Array[]; colors: number }
  | { id: number; type: 'render'; key: string; options: RenderOptions }
  | {
      id: number
      type: 'source'
      key: string
      frame: number
      crop: { x0: number; y0: number; x1: number; y1: number } | null
      maxSide: number
    }
  | { id: number; type: 'timeline'; key: string; height: number }
  | { id: number; type: 'colorSample'; key: string }

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

export type { Palette }
