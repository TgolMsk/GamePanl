// 抠图：背景色估计、色相 / 距离两种抠图方式、开运算去噪点、去背景色溢出。

import { rgbToHsv } from './color'
import type { Mask, Rect, RgbFrame } from './util'

/** 前几帧四周边框像素（排除水印区域）逐通道取中位数 */
export function estimateBackground(frames: RgbFrame[], exclude: Rect[]): [number, number, number] {
  const use = frames.slice(0, 10)
  const { width: w, height: h } = use[0]
  const b = Math.max(2, Math.floor(Math.min(h, w) / 40))
  const hist = [new Float64Array(256), new Float64Array(256), new Float64Array(256)]
  let total = 0
  const excluded = (x: number, y: number): boolean => exclude.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)
  for (let y = 0; y < h; y++) {
    const edgeRow = y < b || y >= h - b
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= b && x < w - b) continue
      if (excluded(x, y)) continue
      const i = (y * w + x) * 3
      for (const f of use) {
        hist[0][f.data[i]]++
        hist[1][f.data[i + 1]]++
        hist[2][f.data[i + 2]]++
      }
      total += use.length
    }
  }
  return [histMedian(hist[0], total), histMedian(hist[1], total), histMedian(hist[2], total)]
}

/** 直方图中位数；个数为偶数时取中间两个的平均（与 numpy.median 一致） */
function histMedian(hist: Float64Array, total: number): number {
  if (total === 0) return 0
  const nth = (k: number): number => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc > k) return v
    }
    return 255
  }
  return total % 2 ? nth((total - 1) / 2) : (nth(total / 2 - 1) + nth(total / 2)) / 2
}

export interface KeyOptions {
  mode: 'auto' | 'hue' | 'dist'
  hueTol: number
  satMin: number
  valMin: number
  distTol: number
}

export class Keyer {
  readonly bg: [number, number, number]
  readonly mode: 'hue' | 'dist'
  readonly h0: number
  readonly s0: number
  readonly v0: number
  private readonly bgN: [number, number, number]
  private readonly opts: KeyOptions

  constructor(bgRgb: [number, number, number], opts: KeyOptions) {
    this.bg = bgRgb
    this.bgN = [bgRgb[0] / 255, bgRgb[1] / 255, bgRgb[2] / 255]
    const [h, s, v] = rgbToHsv(...this.bgN)
    this.h0 = h
    this.s0 = s
    this.v0 = v
    this.mode = opts.mode !== 'auto' ? opts.mode : s >= 0.25 ? 'hue' : 'dist'
    this.opts = opts
  }

  /** 这个像素是不是背景（RGB 0–255） */
  isBackground(r: number, g: number, b: number): boolean {
    const o = this.opts
    if (this.mode === 'hue') {
      const [h, s, v] = rgbToHsv(r / 255, g / 255, b / 255)
      let dh = Math.abs(h - this.h0)
      if (dh > 180) dh = 360 - dh
      return dh <= o.hueTol && s >= o.satMin && v >= o.valMin
    }
    const dr = r / 255 - this.bgN[0]
    const dg = g / 255 - this.bgN[1]
    const db = b / 255 - this.bgN[2]
    return Math.sqrt(dr * dr + dg * dg + db * db) <= o.distTol
  }

  /** 前景掩码；exclude 里的区域（水印）一律算背景 */
  foreground(f: RgbFrame, exclude: Rect[] = []): Mask {
    const { width: w, height: h, data } = f
    const out = new Uint8Array(w * h)
    // 同一种颜色只判断一次（纯色背景下重复很多）
    const cache = new Map<number, number>()
    for (let i = 0, p = 0; p < out.length; p++, i += 3) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const key = (r << 16) | (g << 8) | b
      let v = cache.get(key)
      if (v === undefined) {
        v = this.isBackground(r, g, b) ? 0 : 1
        if (cache.size < 1 << 18) cache.set(key, v)
      }
      out[p] = v
    }
    for (const r of exclude) {
      for (let y = r.y0; y < r.y1; y++) out.fill(0, y * w + r.x0, y * w + r.x1)
    }
    return { width: w, height: h, data: out }
  }
}

/** 4 邻域腐蚀：边缘一圈置为背景 */
export function erode(m: Mask): Mask {
  const { width: w, height: h, data: s } = m
  const o = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      o[i] = s[i] & s[i - 1] & s[i + 1] & s[i - w] & s[i + w]
    }
  }
  return { width: w, height: h, data: o }
}

/** 4 邻域膨胀 */
export function dilate(m: Mask): Mask {
  const { width: w, height: h, data: s } = m
  const o = new Uint8Array(s)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (s[i]) continue
      if ((x > 0 && s[i - 1]) || (x < w - 1 && s[i + 1]) || (y > 0 && s[i - w]) || (y < h - 1 && s[i + w])) o[i] = 1
    }
  }
  return { width: w, height: h, data: o }
}

/** 开运算：先腐蚀 n 次再膨胀 n 次 */
export function openMask(m: Mask, n: number): Mask {
  let r = m
  for (let i = 0; i < n; i++) r = erode(r)
  for (let i = 0; i < n; i++) r = dilate(r)
  return r
}

/**
 * 新增：去掉零星噪点。开运算挡不住「十字形」的 5 像素噪点，一个噪点就能把全部帧共用的裁切框撑大一圈
 * （样例里第 13 帧左下角有一个，裁切宽度从 51 变成 63）。8 邻域连通块面积小于 minArea、
 * 又不到最大块 0.5% 的去掉；角色身上断开的小部件（剑尖、发梢）通常比这大得多。
 */
export function dropSpecks(m: Mask, minArea: number): Mask {
  const { width: w, height: h, data: s } = m
  const label = new Int32Array(w * h)
  const areas: number[] = [0]
  const stack = new Int32Array(w * h)
  for (let i = 0; i < s.length; i++) {
    if (!s[i] || label[i]) continue
    const id = areas.length
    let top = 0
    let area = 0
    stack[top++] = i
    label[i] = id
    while (top > 0) {
      const p = stack[--top]
      area++
      const x = p % w
      const y = (p - x) / w
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (s[q] && !label[q]) {
            label[q] = id
            stack[top++] = q
          }
        }
      }
    }
    areas.push(area)
  }
  if (areas.length <= 2) return m
  const largest = Math.max(...areas)
  const limit = Math.min(minArea, largest * 0.005)
  const drop = areas.map((a) => a < limit)
  if (!drop.some(Boolean)) return m
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s[i] && !drop[label[i]] ? 1 : 0
  return { width: w, height: h, data: o }
}

/**
 * 去背景色溢出：单主色背景（绿、蓝）把主色通道压到另外两个通道的最大值；
 * 双主色背景（品红、青、黄）把两个主色通道共同高出第三通道的部分减掉；中性背景不处理。
 */
export function despill(f: RgbFrame, bg: [number, number, number]): RgbFrame {
  const order = [0, 1, 2].sort((a, b) => bg[b] - bg[a] || a - b)
  const [hi, mid, lo] = order
  const out = new Uint8Array(f.data)
  if (bg[hi] - bg[mid] >= 40) {
    for (let i = 0; i < out.length; i += 3) {
      const m = Math.max(out[i + mid], out[i + lo])
      if (out[i + hi] > m) out[i + hi] = m
    }
  } else if (bg[mid] - bg[lo] >= 40) {
    for (let i = 0; i < out.length; i += 3) {
      const spill = Math.min(out[i + hi], out[i + mid]) - out[i + lo]
      if (spill > 0) {
        out[i + hi] -= spill
        out[i + mid] -= spill
      }
    }
  }
  return { width: f.width, height: f.height, data: out }
}
