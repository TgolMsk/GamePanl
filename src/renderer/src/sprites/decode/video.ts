// WebCodecs 解码：自己解封装 MP4 / MOV，VideoDecoder 硬件解码，拷出 YCbCr 平面后按自己选定的矩阵转 RGB。
// 不用 <video> + canvas（系统默认的色彩转换不可控，也做不到逐帧精确）。

import { resolveColor, type ColorMatrix, type Plane, type YuvFrame } from '../core/color'
import type { FrameSource } from '../pipeline'
import { parseMp4, type Mp4Sample, type Mp4VideoTrack } from './mp4'

export class WebCodecsSource implements FrameSource {
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly frameCount: number
  readonly color
  readonly codec: string
  private readonly track: Mp4VideoTrack
  private readonly buf: Uint8Array
  /** 展示顺序第 i 帧 → 解码顺序下标 */
  private readonly byPresentation: number[]
  /** 解码顺序下标 → 展示顺序帧号 */
  private readonly presentationOf: Int32Array
  private config: VideoDecoderConfig | null = null

  constructor(buf: Uint8Array) {
    this.buf = buf
    this.track = parseMp4(buf)
    const t = this.track
    this.width = t.width
    this.height = t.height
    this.fps = Math.round(t.fps * 1000) / 1000
    this.frameCount = t.samples.length
    this.codec = t.codec
    this.color = resolveColor({ matrix: t.color.matrix as ColorMatrix | null, fullRange: t.color.fullRange }, t.width, t.height)
    const order = t.samples.map((s, i) => [s.cts, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    this.byPresentation = order.map((x) => x[1])
    this.presentationOf = new Int32Array(t.samples.length)
    this.byPresentation.forEach((d, p) => (this.presentationOf[d] = p))
  }

  private async decoderConfig(): Promise<VideoDecoderConfig> {
    if (this.config) return this.config
    const base: VideoDecoderConfig = {
      codec: this.track.codec,
      description: this.track.description,
      codedWidth: this.track.width,
      codedHeight: this.track.height,
      optimizeForLatency: false
    }
    for (const hw of ['no-preference', 'prefer-software'] as const) {
      const cfg = { ...base, hardwareAcceleration: hw }
      try {
        const r = await VideoDecoder.isConfigSupported(cfg)
        if (r.supported) {
          this.config = cfg
          return cfg
        }
      } catch {
        // 试下一种
      }
    }
    throw new Error(`这台电脑解不了这种视频编码（${this.track.codec}），请转成 H.264 再试`)
  }

  async decode(indices: number[] | 'all', onFrame: (index: number, f: YuvFrame) => void): Promise<void> {
    const cfg = await this.decoderConfig()
    const samples = this.track.samples
    const n = samples.length
    let want: Set<number> | null = null
    let first = 0
    let last = n - 1
    if (indices !== 'all') {
      want = new Set(indices.filter((i) => i >= 0 && i < n))
      if (want.size === 0) return
      // 需要的展示帧对应的解码下标范围，往前退到关键帧
      const dec = [...want].map((p) => this.byPresentation[p])
      first = Math.min(...dec)
      last = Math.max(...dec)
      while (first > 0 && !samples[first].keyframe) first--
      // 解码顺序解到需要的最后一帧即可（参考帧都在它前面），flush 会把重排序中的帧全部吐出来
    }
    const tsToIndex = new Map<number, number>()
    for (let d = first; d <= last; d++) tsToIndex.set(samples[d].cts, this.presentationOf[d])

    let chain: Promise<void> = Promise.resolve()
    let failure: unknown = null
    const decoder = new VideoDecoder({
      output: (frame) => {
        const index = tsToIndex.get(frame.timestamp) ?? -1
        if (index < 0 || (want && !want.has(index))) {
          frame.close()
          return
        }
        chain = chain.then(async () => {
          try {
            const yuv = await copyPlanes(frame, this.color)
            onFrame(index, yuv)
          } catch (err) {
            failure ??= err
          } finally {
            frame.close()
          }
        })
      },
      error: (err) => {
        failure ??= err
      }
    })
    try {
      decoder.configure(cfg)
      for (let d = first; d <= last; d++) {
        const s: Mp4Sample = samples[d]
        decoder.decode(
          new EncodedVideoChunk({
            type: s.keyframe ? 'key' : 'delta',
            timestamp: s.cts,
            duration: s.duration,
            data: this.buf.subarray(s.offset, s.offset + s.size)
          })
        )
        // 别一次塞太多，解码器内部队列有限
        if (decoder.decodeQueueSize > 24) await new Promise<void>((r) => decoder.addEventListener('dequeue', () => r(), { once: true }))
        if (failure) break
      }
      if (!failure) await decoder.flush()
      await chain
    } finally {
      if (decoder.state !== 'closed') decoder.close()
    }
    if (failure) throw failure instanceof Error ? failure : new Error(`解码失败：${String(failure)}`)
  }
}

/** 把 VideoFrame 的 YCbCr 平面拷到内存（8 位）；格式不认识时让浏览器转 RGBA 再换算回来 */
async function copyPlanes(frame: VideoFrame, color: { matrix: ColorMatrix; fullRange: boolean }): Promise<YuvFrame> {
  const rect = frame.visibleRect ?? { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight }
  const w = rect.width
  const h = rect.height
  const fmt = frame.format
  const cw = Math.ceil(w / 2)
  const chh = Math.ceil(h / 2)
  if (fmt === 'I420' || fmt === 'I420A' || fmt === 'NV12' || fmt === 'I422' || fmt === 'I444') {
    const size = frame.allocationSize()
    const data = new Uint8Array(size)
    const layout = await frame.copyTo(data)
    const plane = (i: number, pw: number, ph: number, pixelStride = 1, extra = 0): Plane => ({
      data,
      offset: layout[i].offset + extra,
      stride: layout[i].stride,
      pixelStride,
      width: pw,
      height: ph
    })
    if (fmt === 'NV12') {
      return { width: w, height: h, y: plane(0, w, h), u: plane(1, cw, chh, 2, 0), v: plane(1, cw, chh, 2, 1) }
    }
    const [uw, uh] = fmt === 'I444' ? [w, h] : fmt === 'I422' ? [cw, h] : [cw, chh]
    return { width: w, height: h, y: plane(0, w, h), u: plane(1, uw, uh), v: plane(2, uw, uh) }
  }
  // 高位深（lib.dom 里还没有这几个格式名）：右移到 8 位
  const hi = fmt as string | null
  if (hi === 'I420P10' || hi === 'I420P12' || hi === 'I422P10' || hi === 'I444P10') {
    const shift = hi.endsWith('12') ? 4 : 2
    const size = frame.allocationSize()
    const raw = new Uint8Array(size)
    const layout = await frame.copyTo(raw)
    const view = new DataView(raw.buffer)
    const [uw, uh] = hi.startsWith('I444') ? [w, h] : hi.startsWith('I422') ? [cw, h] : [cw, chh]
    const to8 = (i: number, pw: number, ph: number): Plane => {
      const out = new Uint8Array(pw * ph)
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          out[y * pw + x] = Math.min(255, view.getUint16(layout[i].offset + y * layout[i].stride + x * 2, true) >> shift)
        }
      }
      return { data: out, offset: 0, stride: pw, pixelStride: 1, width: pw, height: ph }
    }
    return { width: w, height: h, y: to8(0, w, h), u: to8(1, uw, uh), v: to8(2, uw, uh) }
  }
  // 其他格式（RGBA、GPU 纹理）：让浏览器转成 RGBA，再按本视频的矩阵换回 YCbCr 走同一条路
  const rgba = new Uint8Array(w * h * 4)
  await frame.copyTo(rgba, { format: 'RGBA' } as VideoFrameCopyToOptions)
  const [kr, kb] = color.matrix === 'bt601' ? [0.299, 0.114] : color.matrix === 'bt2020' ? [0.2627, 0.0593] : [0.2126, 0.0722]
  const [yo, ys, cs] = color.fullRange ? [0, 255, 255] : [16, 219, 224]
  const Y = new Uint8Array(w * h)
  const U = new Uint8Array(w * h)
  const V = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const r = rgba[p * 4] / 255
    const g = rgba[p * 4 + 1] / 255
    const b = rgba[p * 4 + 2] / 255
    const yy = kr * r + (1 - kr - kb) * g + kb * b
    Y[p] = Math.round(yo + ys * yy)
    U[p] = Math.round(128 + cs * ((b - yy) / (2 * (1 - kb))))
    V[p] = Math.round(128 + cs * ((r - yy) / (2 * (1 - kr))))
  }
  const full = (d: Uint8Array): Plane => ({ data: d, offset: 0, stride: w, pixelStride: 1, width: w, height: h })
  return { width: w, height: h, y: full(Y), u: full(U), v: full(V) }
}
