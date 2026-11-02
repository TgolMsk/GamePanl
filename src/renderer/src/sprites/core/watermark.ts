// 水印自动检测：在四个角找「所有帧都是前景、帧间颜色几乎不变」的连通区域（平台叠加的「AI生成」等字样），
// 把挨得近的连成一组，外扩画面尺寸的 2% 作为水印区域。

import type { Mask, NormRect, RgbFrame } from './util'

export interface WatermarkDetection {
  /** 检测到的水印区域（比例坐标） */
  regions: NormRect[]
  /** 与角色前景相交、因此没有屏蔽的区域 */
  conflicts: NormRect[]
}

interface Comp {
  x0: number
  y0: number
  x1: number
  y1: number
  n: number
}

/** rawMasks：不屏蔽水印、不做开运算的前景掩码（分析分辨率，全部帧） */
export function detectWatermark(frames: RgbFrame[], rawMasks: Mask[]): WatermarkDetection {
  const none = { regions: [], conflicts: [] }
  if (frames.length < 2) return none
  const { width: w, height: h } = rawMasks[0]
  const N = w * h
  // 所有帧都是前景
  const always = new Uint8Array(N).fill(1)
  const ever = new Uint8Array(N)
  for (const m of rawMasks) {
    for (let p = 0; p < N; p++) {
      always[p] &= m.data[p]
      ever[p] |= m.data[p]
    }
  }
  // 帧间颜色变化：相邻帧差的平均（三通道平均）
  const change = new Float32Array(N)
  for (let t = 1; t < frames.length; t++) {
    const a = frames[t - 1].data
    const b = frames[t].data
    for (let p = 0; p < N; p++) {
      if (!always[p]) continue
      const i = p * 3
      change[p] += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
    }
  }
  const stable = new Uint8Array(N)
  for (let p = 0; p < N; p++) stable[p] = always[p] && change[p] / (frames.length - 1) < 3 ? 1 : 0

  // 8 邻域连通区域
  const label = new Int32Array(N).fill(-1)
  const comps: Comp[] = []
  const stack: number[] = []
  for (let p = 0; p < N; p++) {
    if (!stable[p] || label[p] >= 0) continue
    const id = comps.length
    const c: Comp = { x0: w, y0: h, x1: 0, y1: 0, n: 0 }
    label[p] = id
    stack.push(p)
    while (stack.length) {
      const q = stack.pop() as number
      const x = q % w
      const y = (q - x) / w
      c.n++
      if (x < c.x0) c.x0 = x
      if (y < c.y0) c.y0 = y
      if (x + 1 > c.x1) c.x1 = x + 1
      if (y + 1 > c.y1) c.y1 = y + 1
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const r = ny * w + nx
          if (stable[r] && label[r] < 0) {
            label[r] = id
            stack.push(r)
          }
        }
      }
    }
    comps.push(c)
  }
  if (comps.length === 0) return none

  const cw = Math.ceil(w * 0.25)
  const chh = Math.ceil(h * 0.25)
  const corners = [
    { x0: 0, y0: 0, x1: cw, y1: chh },
    { x0: w - cw, y0: 0, x1: w, y1: chh },
    { x0: 0, y0: h - chh, x1: cw, y1: h },
    { x0: w - cw, y0: h - chh, x1: w, y1: h }
  ]
  const gap = Math.max(1, Math.round(Math.max(w, h) * 0.04))
  const near = (a: Comp, b: Comp): boolean =>
    a.x0 - gap < b.x1 && b.x0 - gap < a.x1 && a.y0 - gap < b.y1 && b.y0 - gap < a.y1
  const used = new Uint8Array(comps.length)
  const regions: NormRect[] = []
  const conflicts: NormRect[] = []
  for (const k of corners) {
    // 种子：落在这个角里的区域
    const group: Comp[] = []
    comps.forEach((c, i) => {
      if (used[i]) return
      const cx = (c.x0 + c.x1) / 2
      const cy = (c.y0 + c.y1) / 2
      if (cx >= k.x0 && cx < k.x1 && cy >= k.y0 && cy < k.y1) {
        group.push(c)
        used[i] = 1
      }
    })
    if (group.length === 0) continue
    // 挨得近的（相邻的字）连成一组
    let grew = true
    while (grew) {
      grew = false
      comps.forEach((c, i) => {
        if (used[i]) return
        if (group.some((g) => near(g, c))) {
          group.push(c)
          used[i] = 1
          grew = true
        }
      })
    }
    const box = {
      x0: Math.min(...group.map((c) => c.x0)),
      y0: Math.min(...group.map((c) => c.y0)),
      x1: Math.max(...group.map((c) => c.x1)),
      y1: Math.max(...group.map((c) => c.y1))
    }
    const n = group.reduce((s, c) => s + c.n, 0)
    // 太小是噪点，太大不是水印（多半是角色或道具）
    if (n < 4 || box.x1 - box.x0 > w * 0.5 || box.y1 - box.y0 > h * 0.5) continue
    const mx = w * 0.02
    const my = h * 0.02
    const rect: NormRect = [
      Math.max(0, (box.x0 - mx) / w),
      Math.max(0, (box.y0 - my) / h),
      Math.min(1, (box.x1 + mx) / w),
      Math.min(1, (box.y1 + my) / h)
    ]
    // 与角色前景（会动的前景）并集相交：以角色为准，不屏蔽。
    // 水印字边缘的半透明像素会时有时无，离稳定像素 2 格以内的不算
    const px0 = Math.floor(rect[0] * w)
    const py0 = Math.floor(rect[1] * h)
    const px1 = Math.ceil(rect[2] * w)
    const py1 = Math.ceil(rect[3] * h)
    let moving = 0
    for (let y = py0; y < py1; y++) {
      for (let x = px0; x < px1; x++) {
        const p = y * w + x
        if (!ever[p] || always[p]) continue
        let close = false
        for (let dy = -2; dy <= 2 && !close; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && stable[ny * w + nx]) {
              close = true
              break
            }
          }
        }
        if (!close) moving++
      }
    }
    if (moving >= Math.max(3, (px1 - px0) * (py1 - py0) * 0.02)) conflicts.push(rect)
    else regions.push(rect)
  }
  return { regions, conflicts }
}
