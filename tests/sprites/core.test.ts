// 序列帧核心算法单元测试（规格第 8 节的合成数据表，结果必须完全一致）。
// node_modules/.bin/esbuild tests/sprites/core.test.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --alias:@renderer=./src/renderer/src --outfile=/tmp/gp-core-test.mjs && node /tmp/gp-core-test.mjs
import assert from 'node:assert/strict'
import { despill, Keyer, openMask } from '@renderer/sprites/core/keying'
import { FrameDiff, findLoop, pickLoop, pickOnce } from '@renderer/sprites/core/loop'
import { layoutCharacter, type ActionGeometry } from '@renderer/sprites/core/layout'
import { downsampleMode } from '@renderer/sprites/core/downsample'
import { buildPalette, nearest, type Palette } from '@renderer/sprites/core/palette'
import { maskCount, roundHalfEven, sampleIndices, sampleIndicesSparse, seededRandom, type RgbFrame } from '@renderer/sprites/core/util'
import { detectActionName } from '@shared/sprites'

const KEY = { mode: 'auto' as const, hueTol: 35, satMin: 0.25, valMin: 0.2, distTol: 0.15 }

function frameOf(w: number, h: number, bg: [number, number, number]): RgbFrame {
  const data = new Uint8Array(w * h * 3)
  for (let p = 0; p < w * h; p++) data.set(bg, p * 3)
  return { width: w, height: h, data }
}

function fill(f: RgbFrame, x0: number, y0: number, w: number, h: number, c: [number, number, number]): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) f.data.set(c, (y * f.width + x) * 3)
}

function px(...colors: Array<[number, number, number]>): RgbFrame {
  return { width: colors.length, height: 1, data: Uint8Array.from(colors.flat()) }
}

function despilled(bg: [number, number, number], ...colors: Array<[number, number, number]>): number[][] {
  const out = despill(px(...colors), bg)
  return colors.map((_, i) => [...out.data.subarray(i * 3, i * 3 + 3)])
}

let passed = 0
function test(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`通过：${name}`)
}

test('四舍六入五成双', () => {
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, 2.4999, 2.5001].map(roundHalfEven), [0, 2, 2, 4, 2, 3])
})

test('绿幕去溢出 (90,140,95) → (90,95,95)', () => {
  assert.deepEqual(despilled([25, 179, 66], [90, 140, 95]), [[90, 95, 95]])
})

test('品红去溢出：红、蓝、白不变', () => {
  assert.deepEqual(despilled([255, 0, 255], [200, 30, 30], [30, 30, 200], [235, 235, 235]), [
    [200, 30, 30],
    [30, 30, 200],
    [235, 235, 235]
  ])
})

test('品红去溢出 (60,8,60) → (8,8,8)', () => {
  assert.deepEqual(despilled([255, 0, 255], [60, 8, 60]), [[8, 8, 8]])
})

test('品红抠图：前景恰好 400 像素，暗品红线判为背景', () => {
  const f = frameOf(40, 40, [255, 0, 255])
  fill(f, 2, 2, 10, 10, [200, 30, 30])
  fill(f, 20, 2, 10, 10, [30, 30, 200])
  fill(f, 2, 20, 10, 10, [235, 235, 235])
  fill(f, 20, 20, 10, 10, [20, 20, 20])
  fill(f, 2, 35, 10, 1, [60, 8, 60])
  const k = new Keyer([255, 0, 255], KEY)
  assert.equal(k.mode, 'hue')
  const m = k.foreground(f)
  assert.equal(maskCount(m), 400)
  // 与参考实现一致：4 邻域开运算削掉每个方块的 4 个角
  assert.equal(maskCount(openMask(m, 1)), 384)
})

test('循环检测：17 帧周期的合成序列找出 17，不是 34', () => {
  const rnd = seededRandom(7)
  const n = 120
  const frames: RgbFrame[] = []
  for (let t = 0; t < n; t++) {
    const f = frameOf(80, 60, [25, 179, 66])
    const ph = (2 * Math.PI * t) / 17
    const x = Math.round(30 + 12 * Math.sin(ph))
    const y = Math.round(28 + 6 * Math.cos(ph))
    fill(f, x, y, 14, 18, [200, 60, 50])
    fill(f, x + 3, y + 4, 6, 6, [240, 220, 200])
    for (let i = 0; i < f.data.length; i++) f.data[i] = Math.max(0, Math.min(255, f.data[i] + Math.round((rnd() - 0.5) * 8)))
    frames.push(f)
  }
  const k = new Keyer([25, 179, 66], KEY)
  const masks = frames.map((f) => k.foreground(f))
  const r = findLoop(new FrameDiff(masks, frames, null), 30, 0.3, 2.0)
  assert.equal(r.info?.periodFrames, 17)
  assert.equal(r.end - r.start, 17)
})

test('抽帧取整：循环 s=13 L=19 n=8', () => {
  const r = pickLoop(13, 32, 30, 12, null)
  assert.deepEqual(r.picks, [13, 15, 18, 20, 23, 25, 27, 30])
  assert.equal(r.fps.toFixed(3), '12.632')
})

test('单次抽帧：片段 13–39 指定 6 帧', () => {
  const r = pickOnce(13, 40, 30, 12, 6)
  assert.deepEqual(r.picks, [13, 18, 23, 29, 34, 39])
  assert.equal(r.fps.toFixed(2), '5.77')
})

test('调色板：不超过指定颜色数、确定性、按亮度从亮到暗', () => {
  const rnd = seededRandom(3)
  const pix = new Uint8Array(3 * 5000)
  for (let i = 0; i < pix.length; i++) pix[i] = Math.floor(rnd() * 256)
  const a = buildPalette(pix, 16)
  const b = buildPalette(pix, 16)
  assert.ok(a.length <= 16 && a.length >= 8)
  assert.deepEqual(a, b)
  const l = a.map(([r, g, bl]) => 0.299 * r + 0.587 * g + 0.114 * bl)
  for (let i = 1; i < l.length; i++) assert.ok(l[i] <= l[i - 1])
})

test('多动作布局：首帧身高差 ≤ 3% 共用缩放比，落脚点对齐', () => {
  const geo = (h0: number, refX: number, ground: number): ActionGeometry => ({
    workWidth: 768,
    workHeight: 768,
    workScale: 768 / 1440,
    union: { x0: refX - 60, y0: ground - h0 - 20, x1: refX + 70, y1: ground },
    h0,
    refX,
    ground,
    tweak: 1
  })
  const L = layoutCharacter([geo(300, 380, 600), geo(305, 380, 600)], { height: 64, pad: 1, outline: true, unifiedCanvas: false })
  assert.equal(L.mode, 'character')
  assert.equal(L.h0Inconsistent, false)
  assert.equal(L.actions[0].scale, L.actions[1].scale)
  // 共用缩放比让首帧身高约等于像素身高（中位数 302.5 → 300 的那个约 63.5 px）
  assert.ok(Math.abs(L.actions[0].scale * 300 - (64 * 300) / 302.5) < 1e-9)
  assert.ok(Math.abs(L.pixelScale - 64 / (302.5 / (768 / 1440))) < 1e-12)
  // 落脚点在各自单元格底边（留白 1 + 描边 1）；公共画布按落脚点对齐，容得下两个动作
  for (const a of L.actions) assert.equal(a.pivot[1], a.frameHeight)
  assert.equal(L.canvas.pivot[1], Math.max(...L.actions.map((a) => a.pivot[1])))
  assert.equal(L.canvas.pivot[0], Math.max(...L.actions.map((a) => a.pivot[0])))
  const bad = layoutCharacter([geo(300, 380, 600), geo(270, 380, 600)], { height: 64, pad: 1, outline: true, unifiedCanvas: true })
  assert.equal(bad.h0Inconsistent, true)
  // 统一画布：每个动作单元格一样大
  assert.equal(bad.actions[0].frameWidth, bad.actions[1].frameWidth)
  assert.equal(bad.actions[0].frameHeight, bad.actions[1].frameHeight)
})

test('动作单独设像素身高：缩放比按比例换算，不参加统一画布', () => {
  const geo = (h0: number): ActionGeometry => ({
    workWidth: 768,
    workHeight: 768,
    workScale: 768 / 1440,
    union: { x0: 320, y0: 280, x1: 450, y1: 600 },
    h0,
    refX: 380,
    ground: 600,
    tweak: 1
  })
  const base = layoutCharacter([geo(300), geo(300)], { height: 64, pad: 1, outline: true, unifiedCanvas: true })
  const L = layoutCharacter([geo(300), geo(300)], { height: 64, pad: 1, outline: true, unifiedCanvas: true, heights: [null, 32] })
  assert.equal(L.actions[0].scale, base.actions[0].scale)
  assert.ok(Math.abs(L.actions[1].scale - base.actions[0].scale / 2) < 1e-12)
  assert.ok(L.actions[1].frameHeight < L.actions[0].frameHeight)
  // 单个动作：直接用单独身高
  const one = layoutCharacter([geo(300)], { height: 64, pad: 0, outline: false, unifiedCanvas: false, heights: [40] })
  assert.equal(one.actions[0].ch, 40)
})

test('动作名识别', () => {
  assert.equal(detectActionName('wan3_run_swordsman'), 'run')
  assert.equal(detectActionName('剑士-攻击-02'), 'attack')
  assert.equal(detectActionName('hero idle v2'), 'idle')
  assert.equal(detectActionName('summer_landscape'), null)
})

test('稀疏抽样和原抽样下标、顺序完全一样', () => {
  for (const [n, k, seed] of [[10, 3, 0], [1000, 999, 1], [500000, 300, 0], [123457, 40000, 7]]) {
    assert.deepEqual(sampleIndicesSparse(n, k, seed), sampleIndices(n, k, seed))
  }
})

test('mode 缩小：按格子取最多的颜色（同票取下标小的），前景不足阈值的格子透明', () => {
  // 逐格数票的直白写法当对照
  const rnd = seededRandom(3)
  const w = 37
  const h = 29
  const pal: Palette = [[250, 240, 230], [200, 40, 40], [40, 200, 40], [40, 40, 200], [10, 10, 10]]
  const mask = { width: w, height: h, data: new Uint8Array(w * h) }
  const rgb: RgbFrame = { width: w, height: h, data: new Uint8Array(w * h * 3) }
  for (let i = 0; i < w * h; i++) {
    mask.data[i] = rnd() < 0.7 ? 1 : 0
    const c = pal[Math.floor(rnd() * pal.length)]
    for (let j = 0; j < 3; j++) rgb.data[i * 3 + j] = Math.max(0, Math.min(255, c[j] + Math.round((rnd() - 0.5) * 60)))
  }
  const box = { x0: 2.5, y0: 1.25, x1: 35.5, y1: 27 }
  const cw = 7
  const ch = 6
  const got = downsampleMode(mask, rgb, box, cw, ch, pal, 0.5)
  const cell = (n: number, start: number, scale: number, out: number) => (i: number) => {
    const o = Math.floor((i + 0.5 - start) * scale)
    return o >= 0 && o < out ? o : -1
  }
  const ox = cell(w, box.x0, cw / (box.x1 - box.x0), cw)
  const oy = cell(h, box.y0, ch / (box.y1 - box.y0), ch)
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const votes = new Array(pal.length).fill(0)
      let area = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (ox(x) !== cx || oy(y) !== cy) continue
          area++
          const i = y * w + x
          if (mask.data[i]) votes[nearest(pal, rgb.data[i * 3], rgb.data[i * 3 + 1], rgb.data[i * 3 + 2])]++
        }
      }
      const total = votes.reduce((a, b) => a + b, 0)
      const best = votes.indexOf(Math.max(...votes))
      assert.equal(got.index[cy * cw + cx], total > 0 && total >= 0.5 * Math.max(1, area) ? best : 255, `格子 ${cx},${cy}`)
    }
  }
})

console.log(`全部 ${passed} 项核心算法测试通过`)
