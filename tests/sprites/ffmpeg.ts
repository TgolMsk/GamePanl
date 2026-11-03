// 测试用的 ffmpeg 帧源和 PNG 读取（运行时用 WebCodecs，同一套 YUV → RGB 代码）。
import { execFileSync, spawn } from 'node:child_process'
import { resolveColor, type ColorSpec, type YuvFrame } from '@renderer/sprites/core/color'
import type { FrameSource } from '@renderer/sprites/pipeline'

export class FfmpegSource implements FrameSource {
  width: number
  height: number
  fps: number
  frameCount: number
  color: ColorSpec
  codec: string
  decodeMs = 0

  constructor(private readonly path: string) {
    const j = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_streams', '-of', 'json', path]).toString()
    ) as { streams: Array<Record<string, string>> }
    const s = j.streams[0]
    this.width = Number(s['width'])
    this.height = Number(s['height'])
    const [a, b] = s['r_frame_rate'].split('/').map(Number)
    this.fps = a / b
    this.frameCount = Number(s['nb_read_packets'])
    this.codec = s['codec_name']
    const matrix = s['color_space'] === 'bt709' ? 'bt709' : s['color_space']?.startsWith('bt470') || s['color_space'] === 'smpte170m' ? 'bt601' : null
    const fullRange = s['color_range'] === 'pc' ? true : s['color_range'] === 'tv' ? false : null
    this.color = resolveColor({ matrix, fullRange }, this.width, this.height)
  }

  async decode(indices: number[] | 'all', onFrame: (index: number, f: YuvFrame) => void): Promise<void> {
    const t0 = performance.now()
    const want = indices === 'all' ? null : new Set(indices)
    const last = want ? Math.max(...want) : Infinity
    const { width: w, height: h } = this
    const cw = w >> 1
    const chh = h >> 1
    const size = w * h + 2 * cw * chh
    const frame = new Uint8Array(size)
    let fill = 0
    let idx = 0
    const proc = spawn('ffmpeg', ['-v', 'error', '-i', this.path, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'])
    const plane = (offset: number, pw: number, ph: number): YuvFrame['y'] => ({ data: frame, offset, stride: pw, pixelStride: 1, width: pw, height: ph })
    outer: for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
      let off = 0
      while (off < chunk.length) {
        const n = Math.min(size - fill, chunk.length - off)
        frame.set(chunk.subarray(off, off + n), fill)
        fill += n
        off += n
        if (fill === size) {
          if (!want || want.has(idx)) onFrame(idx, { width: w, height: h, y: plane(0, w, h), u: plane(w * h, cw, chh), v: plane(w * h + cw * chh, cw, chh) })
          idx++
          fill = 0
          if (idx > last) break outer
        }
      }
    }
    proc.kill()
    this.decodeMs += performance.now() - t0
  }
}

export function readPngRgba(file: string): { width: number; height: number; rgba: Uint8Array } {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
    .toString()
    .trim()
    .split(',')
    .map(Number)
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  return { width: w, height: h, rgba: new Uint8Array(raw.buffer, raw.byteOffset, raw.length) }
}
