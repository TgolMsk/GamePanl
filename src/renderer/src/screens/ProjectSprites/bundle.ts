// 把处理结果整理成导出内容（送给主进程写文件）。导出放大倍数在这里乘进帧、尺寸和落脚点。
import type { CharacterOutput } from '@renderer/sprites/engine'
import type { SpriteExportPayload } from '@shared/api'
import { safeFileName, type SpriteCharacter } from '@shared/sprites'
import { hex } from './draw'

export function sheetCols(cols: number | null, frames: number): number {
  return cols === null ? frames : Math.max(1, Math.min(cols, frames))
}

/** 导出可选的放大倍数 */
export const EXPORT_SCALES = [1, 2, 3, 4, 6, 8] as const

/** 每个像素放大成 k×k（最近邻） */
export function upscaleRgba(rgba: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k === 1) return rgba
  const W = w * k
  const out = new Uint8Array(W * h * k * 4)
  const src = new Uint32Array(rgba.buffer, rgba.byteOffset, w * h)
  const dst = new Uint32Array(out.buffer)
  for (let y = 0; y < h; y++) {
    const row = new Uint32Array(W)
    for (let x = 0; x < w; x++) row.fill(src[y * w + x], x * k, x * k + k)
    for (let r = 0; r < k; r++) dst.set(row, (y * k + r) * W)
  }
  return out
}

export function buildPayload(ch: SpriteCharacter, output: CharacterOutput, scale = 1): SpriteExportPayload {
  const s = ch.settings
  const k = Math.max(1, Math.min(8, Math.round(scale)))
  const palette = output.palette.map(hex)
  const mul = (p: [number, number]): [number, number] => [p[0] * k, p[1] * k]
  const actions = output.actions.map((o) => {
    const a = ch.actions.find((x) => x.id === o.actionId)
    const an = o.analysis
    const name = a?.name ?? '动作'
    return {
      name,
      loop: an.kind === 'loop',
      fps: an.fps,
      frameWidth: o.frameWidth * k,
      frameHeight: o.frameHeight * k,
      pivot: mul(o.layout.pivot),
      cols: sheetCols(s.cols, o.frames.length),
      frames: o.frames.map((f) => upscaleRgba(f, o.frameWidth, o.frameHeight, k)),
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
        pixelScale: o.layout.pixelScale * k,
        ...(a?.params.height != null && { height: a.params.height }),
        ...(o.ownPalette && { palette: o.palette.map(hex) }),
        edits: a?.edits ?? []
      }
    }
  })
  const report = {
    character: ch.name,
    settings: s,
    palette,
    pixelScale: output.layout.pixelScale * k,
    exportScale: k,
    canvas: output.layout.canvas,
    h0Spread: output.layout.h0Spread,
    qc: output.qc.map(stripQc),
    actions: output.actions.map((o, k) => ({
      name: actions[k].name,
      file: safeFileName(actions[k].name),
      kind: o.analysis.kind,
      frames: o.frames.length,
      fps: o.analysis.fps,
      frameSize: [o.frameWidth * k, o.frameHeight * k],
      pivot: mul(o.layout.pivot),
      height: actionHeight(ch, o.actionId),
      colors: o.palette.length,
      sourceFrames: actions[k].sourceFrames,
      warnings: o.warnings,
      qc: o.qc.map(stripQc)
    }))
  }
  const canvas = { width: output.layout.canvas.width * k, height: output.layout.canvas.height * k, pivot: mul(output.layout.canvas.pivot) }
  return { palette, pixelScale: output.layout.pixelScale * k, exportScale: k, canvas, actions, report }
}

/** 动作实际用的像素身高 */
function actionHeight(ch: SpriteCharacter, actionId: string): number {
  return ch.actions.find((a) => a.id === actionId)?.params.height ?? ch.settings.height
}

function stripQc(q: { id: string; label: string; value: string; status: string; message?: string; frame?: number; raw?: number | null }): Record<string, unknown> {
  return { id: q.id, label: q.label, value: q.value, status: q.status, message: q.message ?? null, frame: q.frame ?? null, raw: q.raw ?? null }
}
