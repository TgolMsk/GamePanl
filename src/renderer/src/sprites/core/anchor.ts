// 定妆照：把人物图做成首帧图要用的抠图，以及「版本和定妆照像不像」的颜色比对。
//   抠图：透明底按透明度；纯色底从四条边往里漫水填充（只去掉和边连通的背景），
//         可选去掉被身体包住的大块背景（手臂和身体之间）；边缘一圈按颜色距离给半透明并去掉背景色。
//   比对：在 Oklab 里看视频有多少颜色是定妆照里没有的（多出来的），定妆照有多少颜色视频里没有（少了的）。
//         整体略亮略暗不算；脸变色、衣服换色、配件多了少了会拉低分数；形状和细节看不出来。

import { despill, erode } from './keying'
import { maskCount, type Mask, type Rect, type RgbFrame } from './util'

/** 抠图结果：RGBA（已去背景色），以及人物所在的框 */
export interface CutOut {
  width: number
  height: number
  rgba: Uint8ClampedArray<ArrayBuffer>
  /** 人物（不透明部分）的框；什么都没抠出来时 null */
  bounds: Rect | null
  /** 去掉的背景色；原图是透明底时 null */
  bg: [number, number, number] | null
  /** 背景是不是纯色（四条边大部分像素和背景色接近）；不是纯色时抠不干净 */
  solid: boolean
}

const BG_TOL = 48

/**
 * 人物图抠图（src 不会被改动）。holes：被身体包住、和背景色很接近的大块（手臂和身体之间）也去掉；
 * 白衣服配白底时会把衣服当成背景去掉，所以默认不开。
 */
export function cutOutReference(src: Uint8ClampedArray | Uint8Array, w: number, h: number, holes = false): CutOut {
  const n = w * h
  const out = new Uint8ClampedArray(src.length)
  out.set(src)
  let transparent = 0
  for (let i = 0; i < n; i++) if (src[i * 4 + 3] < 128) transparent++
  if (transparent > n * 0.01) {
    for (let i = 0; i < n; i++) if (out[i * 4 + 3] < 8) out[i * 4 + 3] = 0
    keepMainParts(out, w, h)
    return { width: w, height: h, rgba: out, bounds: alphaBounds(out, w, h), bg: null, solid: true }
  }

  // 四条边最常见的颜色当背景
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  const border: number[] = []
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1)
  for (const p of border) {
    const i = p * 4
    const k = ((src[i] >> 3) << 10) | ((src[i + 1] >> 3) << 5) | (src[i + 2] >> 3)
    const bin = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
    bin.n++
    bin.r += src[i]
    bin.g += src[i + 1]
    bin.b += src[i + 2]
    bins.set(k, bin)
  }
  const top = [...bins.values()].reduce((a, b) => (b.n > a.n ? b : a))
  const bg: [number, number, number] = [top.r / top.n, top.g / top.n, top.b / top.n]
  const dist = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    dist[p] = Math.hypot(src[i] - bg[0], src[i + 1] - bg[1], src[i + 2] - bg[2])
  }
  const solid = border.filter((p) => dist[p] < BG_TOL).length >= border.length * 0.7

  // 从边上和背景色接近的像素开始漫水填充
  const isBg = new Uint8Array(n)
  const stack: number[] = []
  for (const p of border) {
    if (dist[p] < BG_TOL && !isBg[p]) {
      isBg[p] = 1
      stack.push(p)
    }
  }
  while (stack.length) {
    const p = stack.pop() as number
    const x = p % w
    const y = (p - x) / w
    const visit = (q: number): void => {
      if (!isBg[q] && dist[q] < BG_TOL) {
        isBg[q] = 1
        stack.push(q)
      }
    }
    if (x > 0) visit(p - 1)
    if (x < w - 1) visit(p + 1)
    if (y > 0) visit(p - w)
    if (y < h - 1) visit(p + w)
  }
  // 被包住的背景：和背景色很接近、面积不小（眼白、高光这类小块留着）
  if (solid && holes) {
    const seen = new Uint8Array(n)
    const minArea = Math.max(24, n * 0.0015)
    for (let p0 = 0; p0 < n; p0++) {
      if (isBg[p0] || seen[p0] || dist[p0] >= BG_TOL / 2) continue
      const comp: number[] = [p0]
      seen[p0] = 1
      for (let k = 0; k < comp.length; k++) {
        const p = comp[k]
        const x = p % w
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]
        for (const q of nb) {
          if (q < 0 || q >= n || seen[q] || isBg[q] || dist[q] >= BG_TOL / 2) continue
          seen[q] = 1
          comp.push(q)
        }
      }
      if (comp.length >= minArea) for (const p of comp) isBg[p] = 1
    }
  }

  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (isBg[p]) {
      out[i + 3] = 0
      continue
    }
    const x = p % w
    const edge = (x > 0 && isBg[p - 1]) || (x < w - 1 && isBg[p + 1]) || (p >= w && isBg[p - w]) || (p < n - w && isBg[p + w])
    if (!edge) continue
    // 边缘：和背景色越近越透明，并把混进来的背景色减掉
    const a = Math.min(1, Math.max(0.25, dist[p] / (BG_TOL * 2.5)))
    if (a < 1) {
      for (let c = 0; c < 3; c++) out[i + c] = (src[i + c] - (1 - a) * bg[c]) / a
      out[i + 3] = Math.round(a * 255)
    }
  }
  keepMainParts(out, w, h)
  return { width: w, height: h, rgba: out, bounds: alphaBounds(out, w, h), bg, solid }
}

/** 只留主体：去掉比最大一块小很多的零碎（签名、水印、散落的小点） */
function keepMainParts(rgba: Uint8ClampedArray, w: number, h: number): void {
  const n = w * h
  const label = new Int32Array(n).fill(-1)
  const sizes: number[] = []
  const comps: number[][] = []
  for (let p0 = 0; p0 < n; p0++) {
    if (label[p0] >= 0 || rgba[p0 * 4 + 3] < 128) continue
    const id = comps.length
    const comp = [p0]
    label[p0] = id
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k]
      const x = p % w
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]
      for (const q of nb) {
        if (q < 0 || q >= n || label[q] >= 0 || rgba[q * 4 + 3] < 128) continue
        label[q] = id
        comp.push(q)
      }
    }
    comps.push(comp)
    sizes.push(comp.length)
  }
  if (comps.length < 2) return
  const keep = Math.max(...sizes) * 0.03
  for (let id = 0; id < comps.length; id++) {
    if (sizes[id] >= keep) continue
    for (const p of comps[id]) rgba[p * 4 + 3] = 0
  }
  // 留下的块旁边的半透明边不动；孤立的半透明像素清掉
  for (let p = 0; p < n; p++) {
    const a = rgba[p * 4 + 3]
    if (a === 0 || a >= 128) continue
    const x = p % w
    const near = (q: number): boolean => q >= 0 && q < n && label[q] >= 0 && sizes[label[q]] >= keep && rgba[q * 4 + 3] >= 128
    if (!((x > 0 && near(p - 1)) || (x < w - 1 && near(p + 1)) || near(p - w) || near(p + w))) rgba[p * 4 + 3] = 0
  }
}

function alphaBounds(rgba: Uint8ClampedArray, w: number, h: number): Rect | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] < 128) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/** 首帧图里人物的位置：人物高度占画面 fill，水平居中，脚下留 (1 - fill) × 0.4 */
export function placeFigure(bounds: Rect, canvasW: number, canvasH: number, fill: number): { x: number; y: number; scale: number } {
  const bw = bounds.x1 - bounds.x0
  const bh = bounds.y1 - bounds.y0
  let scale = (fill * canvasH) / bh
  if (bw * scale > canvasW * 0.9) scale = (canvasW * 0.9) / bw
  const feet = canvasH * (1 - (1 - fill) * 0.4)
  return { x: (canvasW - bw * scale) / 2 - bounds.x0 * scale, y: feet - bounds.y1 * scale, scale }
}

/** 人物身上接近某种底色的像素占比（RGBA，只看不透明的）：太多时这种底色会把衣服一起抠掉 */
export function screenConflict(rgba: Uint8ClampedArray | Uint8Array, screen: [number, number, number]): number {
  const hueOf = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    let hh = 0
    if (d > 0) {
      if (max === r) hh = ((g - b) / d) % 6
      else if (max === g) hh = (b - r) / d + 2
      else hh = (r - g) / d + 4
    }
    return { h: (hh * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max / 255 }
  }
  const target = hueOf(screen[0], screen[1], screen[2]).h
  let all = 0
  let hit = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 200) continue
    all++
    const c = hueOf(rgba[i], rgba[i + 1], rgba[i + 2])
    const dh = Math.min(Math.abs(c.h - target), 360 - Math.abs(c.h - target))
    if (dh < 30 && c.s > 0.35 && c.v > 0.3) hit++
  }
  return all ? hit / all : 0
}

// ---------- 颜色比对 ----------

/** sRGB → Oklab（L 0–1，a、b 约 ±0.4） */
function oklab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

// Oklab 分成 0.02 见方的小格；某种颜色「有」= 落在它附近 2 格内（约 0.04–0.06，整体略亮略暗不算变色）
const CELL = 0.02
const NL = 52
const NAB = 44
const RADIUS = 2
/** 占比低于这个的颜色当噪点，不算「有」 */
const MIN_FRAC = 0.0005

function cellIndex(r: number, g: number, b: number): number {
  const c = oklab(r, g, b)
  const l = Math.min(NL - 1, Math.max(0, Math.floor(c[0] / CELL)))
  const a = Math.min(NAB - 1, Math.max(0, Math.floor((c[1] + 0.44) / CELL)))
  const bb = Math.min(NAB - 1, Math.max(0, Math.floor((c[2] + 0.44) / CELL)))
  return (l * NAB + a) * NAB + bb
}

/** 一组像素「有」的颜色：出现过的小格往外扩 RADIUS 格 */
function coverage(pixels: Uint8Array): Uint8Array {
  const n = Math.floor(pixels.length / 3)
  const count = new Uint32Array(NL * NAB * NAB)
  for (let i = 0; i < n * 3; i += 3) count[cellIndex(pixels[i], pixels[i + 1], pixels[i + 2])]++
  const occ = new Uint8Array(count.length)
  const min = Math.max(1, n * MIN_FRAC)
  for (let k = 0; k < count.length; k++) {
    if (count[k] < min) continue
    const bb = k % NAB
    const a = Math.floor(k / NAB) % NAB
    const l = Math.floor(k / (NAB * NAB))
    for (let dl = -RADIUS; dl <= RADIUS; dl++) {
      const L = l + dl
      if (L < 0 || L >= NL) continue
      for (let da = -RADIUS; da <= RADIUS; da++) {
        const A = a + da
        if (A < 0 || A >= NAB) continue
        for (let db = -RADIUS; db <= RADIUS; db++) {
          const B = bb + db
          if (B >= 0 && B < NAB) occ[(L * NAB + A) * NAB + B] = 1
        }
      }
    }
  }
  return occ
}

/** pixels 里有多少比例的颜色不在 occ 里 */
function uncovered(pixels: Uint8Array, occ: Uint8Array): number {
  const n = Math.floor(pixels.length / 3)
  if (n === 0) return 0
  let u = 0
  for (let i = 0; i < n * 3; i += 3) if (!occ[cellIndex(pixels[i], pixels[i + 1], pixels[i + 2])]) u++
  return u / n
}

/** 定妆照的颜色指纹：角色像素取样，以及它「有」的颜色 */
export interface ColorPrint {
  pixels: Uint8Array
  occ: Uint8Array
}

/** pixels：定妆照里角色部分的 RGB 连续排列 */
export function anchorPrint(pixels: Uint8Array): ColorPrint {
  return { pixels, occ: coverage(pixels) }
}

/**
 * 定妆照里角色部分的颜色取样（RGBA 原图）：抠掉底色，去掉边缘两圈并去掉溢色（和视频那边的处理对齐），
 * 均匀取最多 4 万个像素。
 */
export function anchorPixels(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): ColorPrint {
  // 定妆照是纯色底（绿、蓝、品红），被包住的同色块也是底色
  const cut = cutOutReference(rgba, w, h, true)
  let mask: Mask = { width: w, height: h, data: new Uint8Array(w * h) }
  for (let p = 0; p < w * h; p++) mask.data[p] = cut.rgba[p * 4 + 3] === 255 ? 1 : 0
  mask = erode(erode(mask))
  let rgb: RgbFrame = { width: w, height: h, data: new Uint8Array(w * h * 3) }
  for (let p = 0; p < w * h; p++) {
    rgb.data[p * 3] = rgba[p * 4]
    rgb.data[p * 3 + 1] = rgba[p * 4 + 1]
    rgb.data[p * 3 + 2] = rgba[p * 4 + 2]
  }
  if (cut.bg) rgb = despill(rgb, cut.bg)
  const total = maskCount(mask)
  if (total < 50) throw new Error('定妆照里没有抠出人物')
  const step = Math.max(1, Math.ceil(total / 40000))
  const out = new Uint8Array(Math.ceil(total / step) * 3)
  let k = 0
  let seen = 0
  for (let p = 0; p < w * h; p++) {
    if (!mask.data[p] || seen++ % step !== 0 || k + 3 > out.length) continue
    out[k++] = rgb.data[p * 3]
    out[k++] = rgb.data[p * 3 + 1]
    out[k++] = rgb.data[p * 3 + 2]
  }
  return anchorPrint(out.subarray(0, k))
}

export interface AnchorMatch {
  /** 0–1 */
  score: number
  /** 视频里有、定妆照里没有的颜色占比（换色、多了东西） */
  added: number
  /** 定妆照里有、视频里没有的颜色占比（少了东西、换色） */
  missing: number
}

/** 多出 + 少了的颜色合计到这个比例时相似度为 0 */
const ZERO_AT = 0.3

/** 和定妆照像不像：pixels 是视频里角色部分的 RGB 取样 */
export function anchorMatch(anchor: ColorPrint, pixels: Uint8Array): AnchorMatch {
  const added = uncovered(pixels, anchor.occ)
  const missing = uncovered(anchor.pixels, coverage(pixels))
  return { score: Math.max(0, 1 - (added + missing) / ZERO_AT), added, missing }
}
