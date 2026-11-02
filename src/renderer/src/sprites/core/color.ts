// 色彩：YCbCr 平面按指定矩阵转 RGB（先按面积平均缩放平面，再换算），以及 HSV。
// 不依赖系统默认转换：矩阵按视频标注，没有标注时长边 ≥ 720 用 BT.709，否则 BT.601；范围没有标注按 video range。

import type { RgbFrame } from './util'

export type ColorMatrix = 'bt709' | 'bt601' | 'bt2020'

/** 一个平面：data[offset + y * stride + x * pixelStride] */
export interface Plane {
  data: Uint8Array
  offset: number
  stride: number
  /** I420 为 1；NV12 的 UV 交错平面为 2 */
  pixelStride: number
  width: number
  height: number
}

export interface YuvFrame {
  width: number
  height: number
  y: Plane
  u: Plane
  v: Plane
}

export interface ColorSpec {
  matrix: ColorMatrix
  fullRange: boolean
}

/** 按标注决定色彩矩阵和范围（标注为 null 时按规则推定） */
export function resolveColor(
  tagged: { matrix: ColorMatrix | null; fullRange: boolean | null },
  width: number,
  height: number
): ColorSpec {
  return {
    matrix: tagged.matrix ?? (Math.max(width, height) >= 720 ? 'bt709' : 'bt601'),
    fullRange: tagged.fullRange ?? false
  }
}

const KR: Record<ColorMatrix, [number, number]> = {
  bt709: [0.2126, 0.0722],
  bt601: [0.299, 0.114],
  bt2020: [0.2627, 0.0593]
}

interface Weights {
  start: Int32Array
  count: Int32Array
  w: Float32Array
  /** 每个输出像素在 w 里的起点 */
  at: Int32Array
}

const weightCache = new Map<string, Weights>()

/** 面积平均的一维权重：输出像素 i 覆盖源区间 [i·s, (i+1)·s)，s = src / dst */
function areaWeights(src: number, dst: number): Weights {
  const key = `${src}>${dst}`
  const hit = weightCache.get(key)
  if (hit) return hit
  const s = src / dst
  const start = new Int32Array(dst)
  const count = new Int32Array(dst)
  const at = new Int32Array(dst)
  const ws: number[] = []
  for (let i = 0; i < dst; i++) {
    const a = i * s
    const b = Math.min(src, (i + 1) * s)
    const j0 = Math.floor(a)
    const j1 = Math.min(src, Math.ceil(b - 1e-9))
    start[i] = j0
    at[i] = ws.length
    let n = 0
    for (let j = j0; j < j1; j++) {
      const cover = Math.min(b, j + 1) - Math.max(a, j)
      ws.push(cover / (b - a))
      n++
    }
    count[i] = n
  }
  const w = { start, count, w: Float32Array.from(ws), at }
  if (weightCache.size > 64) weightCache.clear()
  weightCache.set(key, w)
  return w
}

/** 把一个平面按面积平均缩放到 dw × dh，结果为浮点 */
function resamplePlane(p: Plane, dw: number, dh: number): Float32Array {
  const { data, offset, stride, pixelStride: ps, width: sw, height: sh } = p
  const out = new Float32Array(dw * dh)
  // 整数倍缩小：直接分块求和（最常见：1440→160、1920→160）
  if (sw % dw === 0 && sh % dh === 0) {
    const kx = sw / dw
    const ky = sh / dh
    const inv = 1 / (kx * ky)
    const acc = new Float64Array(dw)
    for (let oy = 0; oy < dh; oy++) {
      acc.fill(0)
      for (let yy = 0; yy < ky; yy++) {
        let i = offset + (oy * ky + yy) * stride
        for (let ox = 0; ox < dw; ox++) {
          let s = 0
          for (let xx = 0; xx < kx; xx++) {
            s += data[i]
            i += ps
          }
          acc[ox] += s
        }
      }
      for (let ox = 0; ox < dw; ox++) out[oy * dw + ox] = acc[ox] * inv
    }
    return out
  }
  // 一般情况：先横向再纵向
  const wx = areaWeights(sw, dw)
  const wy = areaWeights(sh, dh)
  const tmp = new Float32Array(dw * sh)
  for (let y = 0; y < sh; y++) {
    const row = offset + y * stride
    for (let ox = 0; ox < dw; ox++) {
      const j0 = wx.start[ox]
      const n = wx.count[ox]
      const a = wx.at[ox]
      let s = 0
      for (let k = 0; k < n; k++) s += data[row + (j0 + k) * ps] * wx.w[a + k]
      tmp[y * dw + ox] = s
    }
  }
  for (let oy = 0; oy < dh; oy++) {
    const j0 = wy.start[oy]
    const n = wy.count[oy]
    const a = wy.at[oy]
    for (let ox = 0; ox < dw; ox++) {
      let s = 0
      for (let k = 0; k < n; k++) s += tmp[(j0 + k) * dw + ox] * wy.w[a + k]
      out[oy * dw + ox] = s
    }
  }
  return out
}

/** YCbCr 帧缩放到 dw × dh 并转成 RGB（缩放在 YCbCr 上做，换算是线性的，结果与先转后缩一致） */
export function yuvToRgb(f: YuvFrame, dw: number, dh: number, color: ColorSpec): RgbFrame {
  const Y = resamplePlane(f.y, dw, dh)
  const U = resamplePlane(f.u, dw, dh)
  const V = resamplePlane(f.v, dw, dh)
  const [kr, kb] = KR[color.matrix]
  const kg = 1 - kr - kb
  const ys = color.fullRange ? 1 / 255 : 1 / 219
  const yo = color.fullRange ? 0 : 16
  const cs = color.fullRange ? 1 / 255 : 1 / 224
  const crR = 2 * (1 - kr)
  const cbB = 2 * (1 - kb)
  const out = new Uint8Array(dw * dh * 3)
  for (let i = 0, o = 0; i < Y.length; i++, o += 3) {
    const yn = (Y[i] - yo) * ys
    const cb = (U[i] - 128) * cs
    const cr = (V[i] - 128) * cs
    const r = yn + crR * cr
    const b = yn + cbB * cb
    const g = (yn - kr * r - kb * b) / kg
    out[o] = clamp255(r)
    out[o + 1] = clamp255(g)
    out[o + 2] = clamp255(b)
  }
  return { width: dw, height: dh, data: out }
}

function clamp255(v: number): number {
  const x = Math.round(v * 255)
  return x < 0 ? 0 : x > 255 ? 255 : x
}

/** RGB（0–1）转 HSV：h 为度，s、v 为 0–1 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = r > g ? (r > b ? r : b) : g > b ? g : b
  const mn = r < g ? (r < b ? r : b) : g < b ? g : b
  const d = mx - mn
  let h = 0
  if (d > 1e-6) {
    if (mx === r) h = (((g - b) / d) % 6 + 6) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  const s = mx > 1e-6 ? d / mx : 0
  return [h, s, mx]
}

/** 亮度（0.299R + 0.587G + 0.114B） */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}
