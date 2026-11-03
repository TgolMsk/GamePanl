// 缩小：mode（覆盖区域里出现最多的调色板颜色）或 box（预乘 Alpha 面积平均），Alpha 二值化；
// 然后映射到调色板、加 1 像素外描边、四周留白，得到一帧 RGBA。

import { nearestLookup, paletteLookup, type Palette } from './palette'
import type { Mask, RgbFrame } from './util'

/** 源画面（工作分辨率）里的裁切框，可以是小数 */
export interface SrcBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 缩小结果：每个输出像素一个调色板下标，255 为透明 */
export interface Indexed {
  width: number
  height: number
  index: Uint8Array
}

export const TRANSPARENT = 255

/** 每个源像素中心落在哪个输出格子里；落在外面为 -1 */
function cellMap(n: number, start: number, scale: number, out: number): Int32Array {
  const m = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const o = Math.floor((i + 0.5 - start) * scale)
    m[i] = o >= 0 && o < out ? o : -1
  }
  return m
}

/** mode 缩小：前景像素先映射到调色板，每个输出像素取覆盖区域里最多的颜色；前景占覆盖面积 ≥ thr 才不透明 */
export function downsampleMode(
  mask: Mask,
  rgb: RgbFrame,
  box: SrcBox,
  cw: number,
  ch: number,
  pal: Palette,
  thr: number
): Indexed {
  const { width: w, height: h } = mask
  const sx = cw / (box.x1 - box.x0)
  const sy = ch / (box.y1 - box.y0)
  const oy = cellMap(h, box.y0, sy, ch)
  const ox = cellMap(w, box.x0, sx, cw)
  const rowsIn = new Int32Array(ch)
  const colsIn = new Int32Array(cw)
  for (let y = 0; y < h; y++) if (oy[y] >= 0) rowsIn[oy[y]]++
  for (let x = 0; x < w; x++) if (ox[x] >= 0) colsIn[ox[x]]++
  const k = pal.length
  const { table, fill } = paletteLookup(pal)
  const fast = table.length > 0
  const md = mask.data
  const px = rgb.data
  const index = new Uint8Array(cw * ch).fill(TRANSPARENT)
  // 一行输出格子一行格子地数：源行按顺序落进输出行（cellMap 单调），计数只要一行大小。
  // 计数时顺手记下最多的颜色（次数相同取下标小的，和数完再找结果一样），不用每格扫一遍调色板
  const counts = new Uint32Array(cw * k)
  const total = new Uint32Array(cw)
  const best = new Uint32Array(cw)
  const bestIdx = new Uint8Array(cw)
  const flush = (cy: number): void => {
    for (let cx = 0; cx < cw; cx++) {
      const t = total[cx]
      if (t === 0) continue
      if (t >= thr * Math.max(1, rowsIn[cy] * colsIn[cx])) index[cy * cw + cx] = bestIdx[cx]
      counts.fill(0, cx * k, cx * k + k)
      total[cx] = 0
      best[cx] = 0
    }
  }
  // 只扫落在裁切框里的列
  let xs = 0
  while (xs < w && ox[xs] < 0) xs++
  let xe = w
  while (xe > xs && ox[xe - 1] < 0) xe--
  let cur = -1
  for (let y = 0; y < h; y++) {
    const cy = oy[y]
    if (cy < 0) continue
    if (cy !== cur) {
      if (cur >= 0) flush(cur)
      cur = cy
    }
    const row = y * w
    for (let x = xs; x < xe; x++) {
      if (!md[row + x]) continue
      const i = (row + x) * 3
      const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]
      let j = fast ? table[key] : TRANSPARENT // 表里 255 = 还没算
      if (j === TRANSPARENT) j = fill(key)
      const cx = ox[x]
      const v = ++counts[cx * k + j]
      total[cx]++
      if (v > best[cx] || (v === best[cx] && j < bestIdx[cx])) {
        best[cx] = v
        bestIdx[cx] = j
      }
    }
  }
  if (cur >= 0) flush(cur)
  return { width: cw, height: ch, index }
}

/** 一维面积权重：输出格子 o 覆盖源区间 [start + o/scale, start + (o+1)/scale)，超出画面的部分算透明 */
function boxWeights(n: number, start: number, scale: number, out: number): Array<Array<[number, number]>> {
  const res: Array<Array<[number, number]>> = []
  for (let o = 0; o < out; o++) {
    const a = start + o / scale
    const b = start + (o + 1) / scale
    const list: Array<[number, number]> = []
    for (let j = Math.max(0, Math.floor(a)); j < Math.min(n, Math.ceil(b)); j++) {
      const cover = Math.min(b, j + 1) - Math.max(a, j)
      if (cover > 0) list.push([j, cover / (b - a)])
    }
    res.push(list)
  }
  return res
}

/** box 缩小：预乘 Alpha 的面积平均（背景不参与混色），Alpha ≥ thr 为不透明；返回 RGB 和不透明标记 */
export function downsampleBox(
  mask: Mask,
  rgb: RgbFrame,
  box: SrcBox,
  cw: number,
  ch: number,
  thr: number
): { rgb: Uint8Array; opaque: Uint8Array } {
  const { width: w, height: h } = mask
  const wx = boxWeights(w, box.x0, cw / (box.x1 - box.x0), cw)
  const wy = boxWeights(h, box.y0, ch / (box.y1 - box.y0), ch)
  const md = mask.data
  const px = rgb.data
  const outRgb = new Uint8Array(cw * ch * 3)
  const opaque = new Uint8Array(cw * ch)
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let a = 0
      let r = 0
      let g = 0
      let b = 0
      for (const [y, fy] of wy[cy]) {
        for (const [x, fx] of wx[cx]) {
          const p = y * w + x
          if (!md[p]) continue
          const f = fy * fx
          a += f
          r += px[p * 3] * f
          g += px[p * 3 + 1] * f
          b += px[p * 3 + 2] * f
        }
      }
      const c = cy * cw + cx
      if (a >= thr && a > 0) {
        opaque[c] = 1
        outRgb[c * 3] = Math.round(r / a)
        outRgb[c * 3 + 1] = Math.round(g / a)
        outRgb[c * 3 + 2] = Math.round(b / a)
      }
    }
  }
  return { rgb: outRgb, opaque }
}

/** box 缩小的结果映射到调色板 */
export function indexBox(res: { rgb: Uint8Array; opaque: Uint8Array }, cw: number, ch: number, pal: Palette): Indexed {
  const look = nearestLookup(pal)
  const index = new Uint8Array(cw * ch).fill(TRANSPARENT)
  for (let c = 0; c < cw * ch; c++) {
    if (res.opaque[c]) index[c] = look(res.rgb[c * 3], res.rgb[c * 3 + 1], res.rgb[c * 3 + 2])
  }
  return { width: cw, height: ch, index }
}

/** 留白 + 描边后的一帧：调色板下标（TRANSPARENT 为透明） */
export function composeCell(src: Indexed, pad: number, outline: number | null): Indexed {
  const fw = src.width + 2 * pad
  const fh = src.height + 2 * pad
  const index = new Uint8Array(fw * fh).fill(TRANSPARENT)
  for (let y = 0; y < src.height; y++) {
    index.set(src.index.subarray(y * src.width, (y + 1) * src.width), (y + pad) * fw + pad)
  }
  if (outline !== null) {
    const ring: number[] = []
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const i = y * fw + x
        if (index[i] !== TRANSPARENT) continue
        if (
          (x > 0 && index[i - 1] !== TRANSPARENT) ||
          (x < fw - 1 && index[i + 1] !== TRANSPARENT) ||
          (y > 0 && index[i - fw] !== TRANSPARENT) ||
          (y < fh - 1 && index[i + fw] !== TRANSPARENT)
        ) {
          ring.push(i)
        }
      }
    }
    for (const i of ring) index[i] = outline
  }
  return { width: fw, height: fh, index }
}

/** 调色板下标转 RGBA（透明像素 RGB 为 0） */
export function toRgba(cell: Indexed, pal: Palette): Uint8Array {
  const out = new Uint8Array(cell.width * cell.height * 4)
  for (let i = 0; i < cell.index.length; i++) {
    const j = cell.index[i]
    if (j === TRANSPARENT) continue
    const p = pal[j]
    out[i * 4] = p[0]
    out[i * 4 + 1] = p[1]
    out[i * 4 + 2] = p[2]
    out[i * 4 + 3] = 255
  }
  return out
}
