// 序列帧管线的基础工具：取整、随机数、帧和掩码的数据结构。
// core/ 下的代码只用类型化数组，不碰 DOM，Web Worker 和 Node 测试里都能跑。

/** RGB 帧：连续内存，每像素 3 字节 */
export interface RgbFrame {
  width: number
  height: number
  data: Uint8Array
}

/** 掩码：每像素 1 字节，1 为前景（角色） */
export interface Mask {
  width: number
  height: number
  data: Uint8Array
}

/** 矩形：x1、y1 不含 */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 相对画面的 0–1 比例矩形 [x0, y0, x1, y1] */
export type NormRect = [number, number, number, number]

/** 四舍六入五成双（与 Python 的 round 一致） */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

/** 固定种子的伪随机数（mulberry32），返回 [0, 1) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 从 0..n-1 里不重复地抽 k 个（固定种子），按抽中的顺序返回 */
export function sampleIndices(n: number, k: number, seed = 0): Uint32Array {
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  if (k >= n) return idx
  const rnd = seededRandom(seed)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (n - i))
    const t = idx[i]
    idx[i] = idx[j]
    idx[j] = t
  }
  return idx.slice(0, k)
}

/** 按长边缩放到 longSide，宽高取偶数（与参考实现 fit_size 一致） */
export function fitSize(w: number, h: number, longSide: number): [number, number] {
  const s = longSide / Math.max(w, h)
  return [Math.max(2, roundHalfEven((w * s) / 2) * 2), Math.max(2, roundHalfEven((h * s) / 2) * 2)]
}

/** 比例矩形换算成像素范围：起点向下取整，终点向上取整 */
export function normToPixels(r: NormRect, w: number, h: number): Rect {
  return {
    x0: Math.max(0, Math.floor(r[0] * w)),
    y0: Math.max(0, Math.floor(r[1] * h)),
    x1: Math.min(w, Math.ceil(r[2] * w)),
    y1: Math.min(h, Math.ceil(r[3] * h))
  }
}

export function median(values: ArrayLike<number>): number {
  const a = Array.from(values).sort((x, y) => x - y)
  if (a.length === 0) return 0
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/** 掩码的包围盒；全空返回 null */
export function maskBounds(m: Mask): Rect | null {
  const { width: w, height: h, data } = m
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (data[row + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/** 前景像素的水平质心；全空返回 null */
export function maskCentroidX(m: Mask): number | null {
  const { width: w, height: h, data } = m
  let sum = 0
  let n = 0
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (data[row + x]) {
        sum += x
        n++
      }
    }
  }
  return n ? sum / n : null
}

export function maskCount(m: Mask): number {
  let n = 0
  for (let i = 0; i < m.data.length; i++) n += m.data[i]
  return n
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

/** 0–255 RGB 转十六进制 #rrggbb */
export function hex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}
