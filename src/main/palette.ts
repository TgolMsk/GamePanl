// 从图片提取色板：缩小后做中位切分（median cut），再挑出若干互相有区分度的主色，按明度从深到浅排列。
import { nativeImage } from 'electron'
import { systemThumbnail } from './images'

type Rgb = [number, number, number]

const SAMPLE = 128
const BOXES = 24

function average(group: Rgb[]): Rgb {
  let r = 0
  let g = 0
  let b = 0
  for (const p of group) {
    r += p[0]
    g += p[1]
    b += p[2]
  }
  const n = group.length || 1
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}

function medianCut(pixels: Rgb[], boxes: number): Rgb[][] {
  const groups: Rgb[][] = [pixels]
  while (groups.length < boxes) {
    let bestIndex = -1
    let bestRange = 0
    let bestChannel = 0
    groups.forEach((g, i) => {
      if (g.length < 2) return
      for (let ch = 0; ch < 3; ch++) {
        let min = 255
        let max = 0
        for (const p of g) {
          if (p[ch] < min) min = p[ch]
          if (p[ch] > max) max = p[ch]
        }
        if (max - min > bestRange) {
          bestRange = max - min
          bestIndex = i
          bestChannel = ch
        }
      }
    })
    if (bestIndex < 0) break
    const g = groups[bestIndex].sort((a, b) => a[bestChannel] - b[bestChannel])
    const mid = g.length >> 1
    groups.splice(bestIndex, 1, g.slice(0, mid), g.slice(mid))
  }
  return groups
}

const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const hex = (c: Rgb): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()

/** 从大到小按占比取色，同时保证颜色之间拉开距离；不够就放宽距离 */
function pickDistinct(candidates: Array<{ color: Rgb; weight: number }>, count: number): Rgb[] {
  const sorted = [...candidates].sort((a, b) => b.weight - a.weight)
  for (let minDist = 48; minDist >= 0; minDist -= 8) {
    const picked: Rgb[] = []
    for (const c of sorted) {
      if (picked.every((p) => distance(p, c.color) >= minDist)) picked.push(c.color)
      if (picked.length === count) return picked
    }
    if (minDist === 0) return picked
  }
  return []
}

async function loadPixels(path: string): Promise<Rgb[]> {
  let img = await systemThumbnail(path, SAMPLE, SAMPLE)
  if (!img || img.isEmpty()) {
    const full = nativeImage.createFromPath(path)
    if (full.isEmpty()) return []
    const { width, height } = full.getSize()
    img = width > height ? full.resize({ width: SAMPLE }) : full.resize({ height: SAMPLE })
  }
  const { width, height } = img.getSize()
  const buf = img.toBitmap() // BGRA
  const pixels: Rgb[] = []
  for (let i = 0; i + 3 < buf.length && pixels.length < width * height; i += 4) {
    const a = buf[i + 3]
    if (a < 128) continue
    pixels.push([buf[i + 2], buf[i + 1], buf[i]])
  }
  return pixels
}

/** 提取 count 个主色（十六进制，如 #1B1F2E），按明度从深到浅排列；读不了图片时返回空数组 */
export async function extractPalette(path: string, count: number): Promise<string[]> {
  const pixels = await loadPixels(path)
  if (pixels.length === 0) return []
  const groups = medianCut(pixels, BOXES).filter((g) => g.length > 0)
  const candidates = groups.map((g) => ({ color: average(g), weight: g.length }))
  const picked = pickDistinct(candidates, count)
  return picked.sort((a, b) => luminance(a) - luminance(b)).map(hex)
}
