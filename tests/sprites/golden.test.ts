// 样例金样测试：wan3_run_swordsman.mp4 跑完整条管线，对照规格第 8 节的期望值和参考实现的输出。
// 测试里用 ffmpeg 把视频解成原始 YUV 当帧源（运行时用 WebCodecs，同一套 YUV → RGB 代码）。
// node_modules/.bin/esbuild tests/sprites/golden.test.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --alias:@renderer=./src/renderer/src --outfile=/tmp/gp-golden.mjs && node /tmp/gp-golden.mjs [输出目录]
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveColor, rgbToHsv, type ColorSpec, type YuvFrame } from '@renderer/sprites/core/color'
import { layoutCharacter } from '@renderer/sprites/core/layout'
import { ActionPipeline, sampleQuotas, sharedPalette, type FrameSource } from '@renderer/sprites/pipeline'
import { DEFAULT_SPRITE_PARAMS, FALLBACK_WATERMARK, type SpriteActionParams } from '@shared/sprites'
import { encodePng } from '../../src/main/spriteExport'

const VIDEO = process.env['GP_SAMPLE'] ?? '/Users/ws/Downloads/wan3_run_swordsman.mp4'
const REF = process.env['GP_REFERENCE'] ?? '/Users/ws/Downloads/sprite_from_video/run_swordsman'
const OUT = process.argv[2] ?? '/tmp/gp-golden'

class FfmpegSource implements FrameSource {
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

function readPngRgba(file: string): { width: number; height: number; rgba: Uint8Array } {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
    .toString()
    .trim()
    .split(',')
    .map(Number)
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  return { width: w, height: h, rgba: new Uint8Array(raw.buffer, raw.byteOffset, raw.length) }
}

/** 两帧不透明区域的 IoU；尺寸可能差 1–2 px，在 ±2 px 内找最佳对齐 */
function bestIoU(a: { width: number; height: number; rgba: Uint8Array }, b: { width: number; height: number; rgba: Uint8Array }): number {
  let best = 0
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      let inter = 0
      let uni = 0
      const x0 = Math.min(0, dx)
      const y0 = Math.min(0, dy)
      const x1 = Math.max(a.width, b.width + dx)
      const y1 = Math.max(a.height, b.height + dy)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const ia = x >= 0 && y >= 0 && x < a.width && y < a.height && a.rgba[(y * a.width + x) * 4 + 3] > 0
          const bx = x - dx
          const by = y - dy
          const ib = bx >= 0 && by >= 0 && bx < b.width && by < b.height && b.rgba[(by * b.width + bx) * 4 + 3] > 0
          if (ia && ib) inter++
          if (ia || ib) uni++
        }
      }
      best = Math.max(best, uni ? inter / uni : 1)
    }
  }
  return best
}

interface RunResult {
  pipe: ActionPipeline
  an: Awaited<ReturnType<ActionPipeline['analyze']>>
  frames: Uint8Array[]
  fw: number
  fh: number
  palette: Array<[number, number, number]>
  ms: number
}

async function run(params: Partial<SpriteActionParams>, name = 'run', src = new FfmpegSource(VIDEO)): Promise<RunResult> {
  const t0 = performance.now()
  const pipe = new ActionPipeline(src)
  const an = await pipe.analyze({ name, params: { ...DEFAULT_SPRITE_PARAMS, ...params }, edits: [], height: 64, work: null })
  const layout = layoutCharacter([an.geometry], { height: 64, pad: 1, outline: true, unifiedCanvas: false })
  const [quota] = sampleQuotas([an.fgCount])
  const palette = sharedPalette([pipe.samples(layout.actions[0], 'mode', quota, 0.5)], 16)
  const r = pipe.render({ layout: layout.actions[0], palette, resample: 'mode', outline: true, pad: 1, alphaThreshold: 0.5 })
  return { pipe, an, frames: r.frames, fw: r.frameWidth, fh: r.frameHeight, palette, ms: performance.now() - t0 }
}

function strip(frames: Uint8Array[], fw: number, fh: number, z: number): { rgba: Uint8Array; width: number; height: number } {
  const width = fw * frames.length * z
  const height = fh * z
  const rgba = new Uint8Array(width * height * 4)
  frames.forEach((f, k) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < fw * z; x++) {
        const s = (Math.floor(y / z) * fw + Math.floor(x / z)) * 4
        rgba.set(f.subarray(s, s + 4), (y * width + k * fw * z + x) * 4)
      }
    }
  })
  return { rgba, width, height }
}

/** 上下拼两张图（灰底），给人看的对比图 */
function stack(a: { rgba: Uint8Array; width: number; height: number }, b: { rgba: Uint8Array; width: number; height: number }): Buffer {
  const gap = 12
  const width = Math.max(a.width, b.width)
  const height = a.height + gap + b.height
  const out = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p++) out.set([128, 128, 128, 255], p * 4)
  const blit = (img: typeof a, oy: number): void => {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4
        if (img.rgba[s + 3] > 0) out.set(img.rgba.subarray(s, s + 4), ((oy + y) * width + x) * 4)
      }
    }
  }
  blit(a, 0)
  blit(b, a.height + gap)
  return encodePng(out, width, height)
}

const rows: string[] = []
const report = (k: string, v: string): void => {
  rows.push(`${k}：${v}`)
  console.log(`${k}：${v}`)
}

mkdirSync(OUT, { recursive: true })

// 1) 默认参数 + 固定水印区域
const fixed = await run({ watermark: FALLBACK_WATERMARK })
const { an } = fixed
report('背景色', `RGB(${an.bg.join(',')})，抠图模式 ${an.keyMode}`)
for (let c = 0; c < 3; c++) assert.ok(Math.abs(an.bg[c] - [25, 179, 66][c]) <= 4, '背景色偏差超过 ±4')
assert.equal(an.keyMode, 'hue')
report('循环', `周期 ${an.loop?.periodFrames} 帧（${an.loop?.periodSeconds.toFixed(3)} 秒），片段 ${an.segment[0]}–${an.segment[1] - 1}，首尾差异 ${an.loop?.startEndDiff.toFixed(4)}，衔接差异 ${an.seamDiff?.toFixed(4)}`)
assert.ok(an.loop && Math.abs(an.loop.periodFrames - 19) <= 1, '周期不是 19±1')
assert.ok(an.loop && an.loop.startEndDiff <= 0.06, '首尾差异 > 0.06')
report('输出', `${fixed.frames.length} 帧，单帧 ${fixed.fw}×${fixed.fh}，${fixed.palette.length} 色，${an.fps.toFixed(3)} fps，源帧 [${an.picks.map((p) => p.frame).join(', ')}]`)
assert.equal(fixed.frames.length, 8)
assert.ok(Math.abs(fixed.fw - 53) <= 1 && Math.abs(fixed.fh - 66) <= 1, '单帧尺寸不是 53×66 ±1')
assert.ok(fixed.palette.length <= 16)
let green = 0
let semi = 0
const [h0] = rgbToHsv(an.bg[0] / 255, an.bg[1] / 255, an.bg[2] / 255)
for (const f of fixed.frames) {
  for (let i = 0; i < f.length; i += 4) {
    if (f[i + 3] !== 0 && f[i + 3] !== 255) semi++
    if (f[i + 3] === 0) continue
    const [h, s] = rgbToHsv(f[i] / 255, f[i + 1] / 255, f[i + 2] / 255)
    let dh = Math.abs(h - h0)
    if (dh > 180) dh = 360 - dh
    if (dh <= 35 && s >= 0.25) green++
  }
}
report('Alpha 与绿边', `半透明像素 ${semi}，绿边像素 ${green}`)
assert.equal(semi, 0)
assert.equal(green, 0)

console.log('质检：')
for (const q of an.qc) console.log(`  [${q.status}] ${q.label}：${q.value}${q.message && q.status === 'warn' ? ` —— ${q.message}` : ''}`)

// 2) 强制片段 13–32，逐帧对比参考输出
const forced = await run({ watermark: FALLBACK_WATERMARK, start: 13, end: 32 })
assert.deepEqual(
  forced.an.picks.map((p) => p.frame),
  [13, 15, 18, 20, 23, 25, 27, 30]
)
const refDir = join(REF, 'frames')
if (existsSync(refDir)) {
  const files = readdirSync(refDir).filter((f) => f.endsWith('.png')).sort()
  const ious = files.map((f, k) => bestIoU({ width: forced.fw, height: forced.fh, rgba: forced.frames[k] }, readPngRgba(join(refDir, f))))
  report('与参考输出的 IoU', ious.map((x) => x.toFixed(3)).join(' '))
  assert.ok(Math.min(...ious) >= 0.9, 'IoU < 0.90')
  const ref = readPngRgba(join(REF, 'preview_x4.png'))
  writeFileSync(join(OUT, 'compare_preview_x4.png'), stack(strip(forced.frames, forced.fw, forced.fh, 4), ref))
  report('对比图', join(OUT, 'compare_preview_x4.png'))
} else {
  console.log(`跳过 IoU：没有参考输出 ${refDir}`)
}

// 3) 确定性
const again = await run({ watermark: FALLBACK_WATERMARK })
assert.equal(again.frames.length, fixed.frames.length)
again.frames.forEach((f, k) => assert.ok(Buffer.from(f).equals(Buffer.from(fixed.frames[k])), `第 ${k} 帧两次结果不同`))
assert.deepEqual(again.palette, fixed.palette)
report('确定性', '两次运行逐字节相同')

// 4) 默认参数：自动检出水印
const auto = await run({})
const wm = auto.an.watermark
report('水印自动检测', `${wm.source}，区域 ${wm.regions.map((r) => r.map((v) => v.toFixed(2)).join(',')).join(' / ') || '无'}${wm.conflicts.length ? `，冲突 ${wm.conflicts.length}` : ''}`)
assert.equal(wm.source, 'auto')
assert.ok(
  wm.regions.some((r) => r[0] <= 0.7 && r[2] >= 0.9 && r[1] <= 0.87 && r[3] >= 0.93),
  '没有检出右下角「AI生成」水印'
)
assert.equal(auto.frames.length, fixed.frames.length)

// 5) 多动作：同一个视频当 run 和 idle 两个动作，缩放比、落脚点、调色板一致
const src2 = new FfmpegSource(VIDEO)
const pa = new ActionPipeline(src2)
const pb = new ActionPipeline(new FfmpegSource(VIDEO))
const params = { ...DEFAULT_SPRITE_PARAMS, watermark: FALLBACK_WATERMARK }
const aa = await pa.analyze({ name: 'run', params, edits: [], height: 64, work: null })
const ab = await pb.analyze({ name: 'idle', params, edits: [], height: 64, work: null })
const L = layoutCharacter([aa.geometry, ab.geometry], { height: 64, pad: 1, outline: true, unifiedCanvas: false })
const q2 = sampleQuotas([aa.fgCount, ab.fgCount])
const pal2 = sharedPalette([pa.samples(L.actions[0], 'mode', q2[0], 0.5), pb.samples(L.actions[1], 'mode', q2[1], 0.5)], 16)
assert.equal(L.actions[0].scale, L.actions[1].scale)
assert.deepEqual(L.actions[0].pivot, L.actions[1].pivot)
assert.equal(L.h0Inconsistent, false)
// 角色模式按首帧站姿身高定比例：第 0 帧角色高约 64 px
assert.ok(Math.abs(L.actions[0].scale * aa.geometry.h0 - 64) < 0.5, '首帧身高不是 64 px')
report('多动作', `缩放比 ${L.actions[0].pixelScale.toFixed(5)} 相同，落脚点 [${L.actions[0].pivot.join(',')}] 相同，共用 ${pal2.length} 色`)

// 6) 性能（Node + ffmpeg 解码，只做参考；应用里用硬件解码）
const t = await run({ watermark: FALLBACK_WATERMARK })
report('耗时', `整条管线 ${Math.round(t.ms)} ms（其中 ffmpeg 解码约 ${Math.round((t.pipe as unknown as { src: FfmpegSource }).src.decodeMs)} ms）`)

writeFileSync(join(OUT, 'sheet_ours_x4.png'), encodePng(strip(fixed.frames, fixed.fw, fixed.fh, 4).rgba, fixed.fw * 8 * 4, fixed.fh * 4))
writeFileSync(join(OUT, 'golden.txt'), rows.join('\n') + '\n')
console.log('样例金样测试全部通过')
