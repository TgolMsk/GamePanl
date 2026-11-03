// 定妆照：人物图抠图、人物摆放、和定妆照比颜色的相似度。
// 相似度用样例视频校准：第 0 帧当定妆照，原片和略暗的版本应该很像，部分换色、整体换色的版本要低于提醒线（80%）。
// node_modules/.bin/esbuild tests/sprites/anchor.test.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --alias:@renderer=./src/renderer/src --outfile=/tmp/gp-anchor.mjs && node /tmp/gp-anchor.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { anchorMatch, anchorPixels, cutOutReference, placeFigure, screenConflict, type ColorPrint } from '@renderer/sprites/core/anchor'
import { ActionPipeline } from '@renderer/sprites/pipeline'
import { DEFAULT_SPRITE_PARAMS } from '@shared/sprites'
import { FfmpegSource } from './ffmpeg'

const VIDEO = process.env['GP_SAMPLE'] ?? '/Users/ws/Downloads/wan3_run_swordsman.mp4'

/** 白底上画一个人：身体、手臂和身体之间有一块白（要去掉），眼白（要留着），角落一个签名小点（要去掉） */
function synthetic(): { w: number; h: number; rgba: Uint8ClampedArray } {
  const w = 200
  const h = 300
  const rgba = new Uint8ClampedArray(w * h * 4)
  const fill = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set([...c, 255], (y * w + x) * 4)
  }
  fill(0, 0, w, h, [250, 250, 250])
  fill(70, 40, 130, 100, [230, 190, 160]) // 头
  fill(84, 60, 92, 66, [255, 255, 255]) // 眼白（被包住、很小）
  fill(60, 100, 140, 250, [180, 30, 30]) // 身体
  fill(70, 120, 100, 200, [250, 250, 250]) // 手臂和身体之间（被包住的大块背景）
  fill(60, 250, 80, 290, [40, 40, 60]) // 腿
  fill(120, 250, 140, 290, [40, 40, 60])
  fill(185, 285, 190, 290, [20, 20, 20]) // 签名
  return { w, h, rgba }
}

function testCutOut(): void {
  const { w, h, rgba } = synthetic()
  const cut = cutOutReference(rgba, w, h, true)
  const a = (x: number, y: number): number => cut.rgba[(y * w + x) * 4 + 3]
  // 默认不去掉被包住的背景（白衣服配白底时会把衣服去掉）
  const keep = cutOutReference(rgba, w, h)
  assert.equal(keep.rgba[(160 * w + 85) * 4 + 3], 255, '默认留着被包住的背景')
  assert.equal(keep.rgba[(5 * w + 5) * 4 + 3], 0)
  assert.equal(cut.solid, true)
  assert.ok(cut.bg && Math.abs(cut.bg[0] - 250) < 2)
  assert.equal(a(5, 5), 0, '背景去掉')
  assert.equal(a(85, 160), 0, '手臂和身体之间的背景去掉')
  assert.equal(a(87, 62), 255, '眼白留着')
  assert.equal(a(100, 180), 255, '身体留着')
  assert.equal(a(187, 287), 0, '签名去掉')
  assert.deepEqual(cut.bounds, { x0: 60, y0: 40, x1: 140, y1: 290 })

  // 透明底：按透明度
  const t = new Uint8ClampedArray(w * h * 4)
  for (let y = 50; y < 250; y++) for (let x = 80; x < 120; x++) t.set([10, 200, 10, 255], (y * w + x) * 4)
  const tc = cutOutReference(t, w, h)
  assert.equal(tc.bg, null)
  assert.deepEqual(tc.bounds, { x0: 80, y0: 50, x1: 120, y1: 250 })
  assert.ok(screenConflict(tc.rgba, [0, 255, 0]) > 0.9, '绿衣服和绿底冲突')
  assert.ok(screenConflict(tc.rgba, [0, 0, 255]) < 0.01, '绿衣服和蓝底不冲突')

  // 摆放：人物高占 60%，水平居中，脚在 84% 处
  const pos = placeFigure({ x0: 60, y0: 40, x1: 140, y1: 290 }, 1280, 720, 0.6)
  assert.ok(Math.abs(250 * pos.scale - 432) < 0.01)
  assert.ok(Math.abs(pos.x + 60 * pos.scale + 40 * pos.scale - 640) < 0.01)
  assert.ok(Math.abs(pos.y + 290 * pos.scale - 720 * 0.84) < 0.01)
  // 很宽的人物：按宽度收
  const wide = placeFigure({ x0: 0, y0: 0, x1: 1000, y1: 100 }, 1280, 720, 0.6)
  assert.ok(1000 * wide.scale <= 1280 * 0.9 + 1e-6)
  console.log('PASS: cut-out, placement and screen conflict')
}

function rgbaOf(file: string, w: number, h: number, frame = 0): Uint8ClampedArray {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  assert.equal(raw.length, w * h * 4)
  return new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length)
}

async function scoreVideo(file: string, print: ColorPrint): Promise<number> {
  const p = new ActionPipeline(new FfmpegSource(file))
  await p.analyze({ name: 'run', params: DEFAULT_SPRITE_PARAMS, edits: [], height: 64, work: null })
  return anchorMatch(print, p.colorSample()).score
}

async function calibrate(): Promise<void> {
  if (!existsSync(VIDEO)) {
    console.log(`SKIP: calibration (no sample video at ${VIDEO})`)
    return
  }
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', VIDEO]).toString().trim().split(',').map(Number)
  const frame0 = rgbaOf(VIDEO, w, h)
  const cut = cutOutReference(frame0, w, h)
  assert.ok(cut.solid && cut.bounds, '样例第 0 帧是纯色底')
  const print = anchorPixels(frame0, w, h)
  const b = cut.bounds
  const dir = mkdtempSync(join(tmpdir(), 'gp-anchor-'))
  const variant = (name: string, args: string[]): string => {
    const out = join(dir, `${name}.mp4`)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', VIDEO, ...args, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', out])
    return out
  }
  // 衣服整体换色：红蓝通道互换（绿底不变；脸变蓝、头巾变蓝、裤子变棕）
  const swapped = variant('swap', ['-vf', 'colorchannelmixer=rr=0:rb=1:br=1:bb=0'])
  // 局部换色：只有身体中段红蓝互换（手臂肤色、腰带变了）
  const bh = b.y1 - b.y0
  const y0 = Math.round(b.y0 + bh * 0.25)
  const band = Math.round(bh * 0.3)
  const part = variant('part', ['-filter_complex', `[0:v]split[a][b];[b]crop=iw:${band}:0:${y0},colorchannelmixer=rr=0:rb=1:br=1:bb=0[c];[a][c]overlay=0:${y0}`])
  // 整体略暗（光照变化）：不该被当成换装
  const darker = variant('dark', ['-vf', 'eq=brightness=-0.04:saturation=0.9'])
  const same = await scoreVideo(VIDEO, print)
  const dark = await scoreVideo(darker, print)
  const partial = await scoreVideo(part, print)
  const swap = await scoreVideo(swapped, print)
  console.log(`similarity: original ${same.toFixed(3)}, darker ${dark.toFixed(3)}, part recolored ${partial.toFixed(3)}, swapped ${swap.toFixed(3)}`)
  assert.ok(same >= 0.9, '原片和自己的第 0 帧很像')
  assert.ok(dark >= 0.9, '光照略变不算换装')
  assert.ok(partial < 0.8, '局部换色低于提醒线')
  assert.ok(swap < 0.4, '整体换色分数很低')
  console.log('PASS: anchor similarity calibration')
}

testCutOut()
await calibrate()
