// 循环检测与抽帧。
// 特征：分析分辨率下每帧的前景掩码 + 灰度；差异 = 掩码异或 / 并集 + 并集区域内灰度差的平均。

import { roundHalfEven, type Mask, type Rect, type RgbFrame } from './util'

export interface LoopInfo {
  periodFrames: number
  periodSeconds: number
  /** 片段首尾差异 */
  startEndDiff: number
}

/** 帧间差异计算器：只在所有帧前景的并集包围盒里算，结果缓存 */
export class FrameDiff {
  readonly n: number
  private readonly masks: Uint8Array[]
  private readonly grays: Float32Array[]
  private readonly cache: Float64Array

  constructor(masks: Mask[], frames: RgbFrame[], crop: Rect | null) {
    this.n = masks.length
    const w = masks[0]?.width ?? 0
    const r = crop ?? { x0: 0, y0: 0, x1: w, y1: masks[0]?.height ?? 0 }
    const cw = Math.max(0, r.x1 - r.x0)
    const ch = Math.max(0, r.y1 - r.y0)
    this.masks = masks.map((m) => {
      const out = new Uint8Array(cw * ch)
      for (let y = 0; y < ch; y++) out.set(m.data.subarray((r.y0 + y) * w + r.x0, (r.y0 + y) * w + r.x0 + cw), y * cw)
      return out
    })
    this.grays = frames.map((f) => {
      const out = new Float32Array(cw * ch)
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const i = ((r.y0 + y) * w + r.x0 + x) * 3
          out[y * cw + x] = (f.data[i] + f.data[i + 1] + f.data[i + 2]) / 3 / 255
        }
      }
      return out
    })
    this.cache = new Float64Array(this.n * this.n).fill(NaN)
  }

  diff(i: number, j: number): number {
    const k = i * this.n + j
    const hit = this.cache[k]
    if (!Number.isNaN(hit)) return hit
    const a = this.masks[i]
    const b = this.masks[j]
    const ga = this.grays[i]
    const gb = this.grays[j]
    let xor = 0
    let uni = 0
    let gsum = 0
    for (let p = 0; p < a.length; p++) {
      const u = a[p] | b[p]
      if (!u) continue
      uni++
      xor += a[p] ^ b[p]
      gsum += Math.abs(ga[p] - gb[p])
    }
    const d = uni === 0 ? 0 : xor / uni + gsum / uni
    this.cache[k] = d
    this.cache[j * this.n + i] = d
    return d
  }

  /** 两帧掩码的差异（不含灰度），单次动作回位检查用 */
  maskDiff(i: number, j: number): number {
    const a = this.masks[i]
    const b = this.masks[j]
    let xor = 0
    let uni = 0
    for (let p = 0; p < a.length; p++) {
      if (!(a[p] | b[p])) continue
      uni++
      xor += a[p] ^ b[p]
    }
    return uni === 0 ? 0 : xor / uni
  }
}

/**
 * 找循环：在周期范围内对每个间隔 L 求 diff(i, i+L) 的平均，取平均值不超过最小值 1.1 倍的最小 L 作为周期 P；
 * 再在 L ∈ {P−1, P, P+1} 里找首尾差异最小的起点。返回半开区间 [start, end)，end 帧与 start 帧相同。
 */
export function findLoop(
  fd: FrameDiff,
  fps: number,
  minPeriod: number,
  maxPeriod: number
): { start: number; end: number; info: LoopInfo | null } {
  const n = fd.n
  const lmin = Math.max(2, roundHalfEven(minPeriod * fps))
  const lmax = Math.min(n - 2, roundHalfEven(maxPeriod * fps))
  if (lmax < lmin) return { start: 0, end: n, info: null }
  const avg = new Map<number, number>()
  let best = Infinity
  for (let L = lmin; L <= lmax; L++) {
    let s = 0
    for (let i = 0; i < n - L; i++) s += fd.diff(i, i + L)
    const v = s / (n - L)
    avg.set(L, v)
    if (v < best) best = v
  }
  let period = lmax
  for (let L = lmin; L <= lmax; L++) {
    if ((avg.get(L) ?? Infinity) <= best * 1.1) {
      period = L
      break
    }
  }
  let bd = Infinity
  let bs = 0
  let bl = period
  for (const L of [period - 1, period, period + 1]) {
    if (L < 2 || L >= n) continue
    for (let s = 0; s < n - L; s++) {
      const d = fd.diff(s, s + L)
      // 并列时取起点小的、再取 L 小的（与 Python 的元组比较一致）
      if (d < bd || (d === bd && (s < bs || (s === bs && L < bl)))) {
        bd = d
        bs = s
        bl = L
      }
    }
  }
  return {
    start: bs,
    end: bs + bl,
    info: { periodFrames: period, periodSeconds: Math.round((period / fps) * 1000) / 1000, startEndDiff: bd }
  }
}

export interface PickResult {
  picks: number[]
  /** 保持原速的播放帧率 */
  fps: number
}

/** 循环：n = round(L × 目标帧率 ÷ 源帧率)，第 k 帧取 s + round(k × L ÷ n)；end 帧不输出 */
export function pickLoop(start: number, end: number, srcFps: number, targetFps: number, frames: number | null): PickResult {
  const L = end - start
  const count = Math.min(L, frames ?? Math.max(2, roundHalfEven((L * targetFps) / srcFps)))
  const picks: number[] = []
  for (let k = 0; k < count; k++) picks.push(start + roundHalfEven((k * L) / count))
  return { picks, fps: (count * srcFps) / L }
}

/** 单次：n = round((L − 1) × 目标帧率 ÷ 源帧率) + 1，均匀取样并包含首尾两帧 */
export function pickOnce(start: number, end: number, srcFps: number, targetFps: number, frames: number | null): PickResult {
  const L = end - start
  const count = Math.min(L, frames ?? Math.max(2, roundHalfEven(((L - 1) * targetFps) / srcFps) + 1))
  const picks: number[] = []
  for (let k = 0; k < count; k++) picks.push(start + roundHalfEven((k * (L - 1)) / Math.max(1, count - 1)))
  return { picks, fps: ((count - 1) * srcFps) / Math.max(1, L - 1) }
}
