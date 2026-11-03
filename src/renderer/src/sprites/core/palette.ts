// 调色板：中位切分 + 2 轮 k-means 细化；按 RGB 欧氏距离映射到最近色，不抖动。

import { luma } from './color'

/** 调色板：每项 [r, g, b]，按亮度从亮到暗排列 */
export type Palette = Array<[number, number, number]>

interface Hist {
  colors: Int32Array
  counts: Float64Array
}

function histogram(pixels: Uint8Array): Hist {
  const map = new Map<number, number>()
  for (let i = 0; i < pixels.length; i += 3) {
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  // 按颜色值排序，保证结果与插入顺序无关
  const keys = Array.from(map.keys()).sort((a, b) => a - b)
  return { colors: Int32Array.from(keys), counts: Float64Array.from(keys.map((k) => map.get(k) ?? 0)) }
}

const ch = (key: number, c: number): number => (key >> (16 - c * 8)) & 255

interface Box {
  idx: number[]
  count: number
  range: number
  axis: number
}

function makeBox(h: Hist, idx: number[]): Box {
  const lo = [255, 255, 255]
  const hi = [0, 0, 0]
  let count = 0
  for (const i of idx) {
    const k = h.colors[i]
    count += h.counts[i]
    for (let c = 0; c < 3; c++) {
      const v = ch(k, c)
      if (v < lo[c]) lo[c] = v
      if (v > hi[c]) hi[c] = v
    }
  }
  let axis = 0
  for (let c = 1; c < 3; c++) if (hi[c] - lo[c] > hi[axis] - lo[axis]) axis = c
  return { idx, count, range: hi[axis] - lo[axis], axis }
}

/** 由像素（RGB 三元组连续排列）生成不超过 n 色的调色板 */
export function buildPalette(pixels: Uint8Array, n: number): Palette {
  const h = histogram(pixels)
  const m = h.colors.length
  if (m === 0) return [[0, 0, 0]]
  let pal: Palette
  if (m <= n) {
    pal = Array.from(h.colors, (k) => [ch(k, 0), ch(k, 1), ch(k, 2)] as [number, number, number])
  } else {
    // 中位切分：每次切「像素数 × 跨度」最大的盒子，沿跨度最大的通道在加权中位数处切开
    const boxes: Box[] = [makeBox(h, Array.from({ length: m }, (_, i) => i))]
    while (boxes.length < n) {
      let bi = -1
      let bestScore = 0
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]
        if (b.idx.length < 2 || b.range === 0) continue
        const score = b.count * b.range
        if (score > bestScore) {
          bestScore = score
          bi = i
        }
      }
      if (bi < 0) break
      const b = boxes[bi]
      const sorted = b.idx.slice().sort((x, y) => ch(h.colors[x], b.axis) - ch(h.colors[y], b.axis) || x - y)
      let acc = 0
      let cut = 1
      for (let i = 0; i < sorted.length - 1; i++) {
        acc += h.counts[sorted[i]]
        cut = i + 1
        if (acc >= b.count / 2) break
      }
      boxes.splice(bi, 1, makeBox(h, sorted.slice(0, cut)), makeBox(h, sorted.slice(cut)))
    }
    pal = boxes.map((b) => {
      let r = 0
      let g = 0
      let bl = 0
      for (const i of b.idx) {
        const k = h.colors[i]
        const w = h.counts[i]
        r += ch(k, 0) * w
        g += ch(k, 1) * w
        bl += ch(k, 2) * w
      }
      return [Math.round(r / b.count), Math.round(g / b.count), Math.round(bl / b.count)]
    })
    // 2 轮 k-means
    for (let iter = 0; iter < 2; iter++) {
      const sum = pal.map(() => [0, 0, 0, 0])
      for (let i = 0; i < m; i++) {
        const k = h.colors[i]
        const j = nearest(pal, ch(k, 0), ch(k, 1), ch(k, 2))
        const w = h.counts[i]
        sum[j][0] += ch(k, 0) * w
        sum[j][1] += ch(k, 1) * w
        sum[j][2] += ch(k, 2) * w
        sum[j][3] += w
      }
      pal = pal.map((p, j) =>
        sum[j][3] > 0
          ? [Math.round(sum[j][0] / sum[j][3]), Math.round(sum[j][1] / sum[j][3]), Math.round(sum[j][2] / sum[j][3])]
          : p
      )
    }
    // 只留真正用到的颜色
    const used = new Uint8Array(pal.length)
    for (let i = 0; i < m; i++) {
      const k = h.colors[i]
      used[nearest(pal, ch(k, 0), ch(k, 1), ch(k, 2))] = 1
    }
    pal = pal.filter((_, j) => used[j])
  }
  // 去重，按亮度从亮到暗
  const seen = new Set<number>()
  pal = pal.filter(([r, g, b]) => {
    const k = (r << 16) | (g << 8) | b
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return pal.sort((a, b) => luma(b[0], b[1], b[2]) - luma(a[0], a[1], a[2]) || a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
}

/** 最近色的下标（距离相同取下标小的） */
export function nearest(pal: Palette, r: number, g: number, b: number): number {
  let bi = 0
  let bd = Infinity
  for (let j = 0; j < pal.length; j++) {
    const p = pal[j]
    const dr = r - p[0]
    const dg = g - p[1]
    const db = b - p[2]
    const d = dr * dr + dg * dg + db * db
    if (d < bd) {
      bd = d
      bi = j
    }
  }
  return bi
}

/** 最近色表里「还没算」的标记（调色板最多 64 色，下标到不了 255） */
const UNSET = 255
/** 24 位颜色 → 最近色下标。一个 Worker 共用一张（16 MB），换了调色板才清空：
 *  出图一次几十上百帧、几十万种颜色，帧之间大多重复，按帧建缓存会反复算最近色 */
let lut: Uint8Array | null = null
let lutPalette = ''

export interface PaletteLookup {
  /** key = r << 16 | g << 8 | b；值为 255 时还没算，调 fill */
  table: Uint8Array
  fill: (key: number) => number
}

/** 共用的最近色表。只在一次同步调用里用（换调色板会清空同一张表） */
export function paletteLookup(pal: Palette): PaletteLookup {
  if (pal.length >= UNSET) {
    // 用不到：颜色数上限 64。真遇到时退回不共用的表
    const table = new Uint8Array(0)
    return { table, fill: (key) => nearest(pal, (key >> 16) & 255, (key >> 8) & 255, key & 255) }
  }
  const sig = pal.join(';')
  if (!lut) lut = new Uint8Array(1 << 24)
  if (sig !== lutPalette) {
    lut.fill(UNSET)
    lutPalette = sig
  }
  const table = lut
  const flat = Int32Array.from(pal.flat())
  const n = pal.length
  return {
    table,
    fill: (key) => {
      const r = (key >> 16) & 255
      const g = (key >> 8) & 255
      const b = key & 255
      // 和 nearest 一样：距离相同取下标小的
      let bi = 0
      let bd = Infinity
      for (let j = 0, o = 0; j < n; j++, o += 3) {
        const dr = r - flat[o]
        const dg = g - flat[o + 1]
        const db = b - flat[o + 2]
        const d = dr * dr + dg * dg + db * db
        if (d < bd) {
          bd = d
          bi = j
        }
      }
      table[key] = bi
      return bi
    }
  }
}

/** 带缓存的最近色查找（同一调色板反复映射时用） */
export function nearestLookup(pal: Palette): (r: number, g: number, b: number) => number {
  const { table, fill } = paletteLookup(pal)
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b
    const v = key < table.length ? table[key] : UNSET
    return v !== UNSET ? v : fill(key)
  }
}

/** 最暗的颜色（描边用） */
export function darkestIndex(pal: Palette): number {
  let bi = 0
  for (let j = 1; j < pal.length; j++) {
    if (luma(pal[j][0], pal[j][1], pal[j][2]) < luma(pal[bi][0], pal[bi][1], pal[bi][2])) bi = j
  }
  return bi
}
