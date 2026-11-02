// 把处理结果整理成导出内容（送给主进程写文件）。
import type { CharacterOutput } from '@renderer/sprites/engine'
import type { SpriteExportPayload } from '@shared/api'
import { safeFileName, type SpriteCharacter } from '@shared/sprites'
import { hex } from './draw'

export function sheetCols(cols: number | null, frames: number): number {
  return cols === null ? frames : Math.max(1, Math.min(cols, frames))
}

export function buildPayload(ch: SpriteCharacter, output: CharacterOutput): SpriteExportPayload {
  const s = ch.settings
  const palette = output.palette.map(hex)
  const actions = output.actions.map((o) => {
    const a = ch.actions.find((x) => x.id === o.actionId)
    const an = o.analysis
    const name = a?.name ?? '动作'
    return {
      name,
      loop: an.kind === 'loop',
      fps: an.fps,
      frameWidth: o.frameWidth,
      frameHeight: o.frameHeight,
      pivot: o.layout.pivot,
      cols: sheetCols(s.cols, o.frames.length),
      frames: o.frames,
      sourceFrames: an.picks.map((p) => p.frame),
      meta: {
        source: a?.sourceName ?? '',
        video: { width: an.info.width, height: an.info.height, fps: an.info.fps, frames: an.info.frameCount, codec: an.info.codec },
        segment: an.segment,
        segmentAuto: an.segmentAuto,
        kindFrom: an.kindFrom,
        loop: an.loop,
        seamDiff: an.seamDiff,
        background: hex(an.bg),
        keyMode: an.keyMode,
        watermark: an.watermark.source,
        pixelScale: o.layout.pixelScale,
        edits: a?.edits ?? []
      }
    }
  })
  const report = {
    character: ch.name,
    settings: s,
    palette,
    pixelScale: output.layout.pixelScale,
    canvas: output.layout.canvas,
    h0Spread: output.layout.h0Spread,
    qc: output.qc.map(stripQc),
    actions: output.actions.map((o, k) => ({
      name: actions[k].name,
      file: safeFileName(actions[k].name),
      kind: o.analysis.kind,
      frames: o.frames.length,
      fps: o.analysis.fps,
      frameSize: [o.frameWidth, o.frameHeight],
      pivot: o.layout.pivot,
      sourceFrames: actions[k].sourceFrames,
      warnings: o.warnings,
      qc: o.qc.map(stripQc)
    }))
  }
  return { palette, pixelScale: output.layout.pixelScale, canvas: output.layout.canvas, actions, report }
}

function stripQc(q: { id: string; label: string; value: string; status: string; message?: string; frame?: number; raw?: number | null }): Record<string, unknown> {
  return { id: q.id, label: q.label, value: q.value, status: q.status, message: q.message ?? null, frame: q.frame ?? null, raw: q.raw ?? null }
}
