// 画布小工具：RGBA → ImageBitmap，最近邻放大绘制。
import { useEffect, useRef, useState } from 'react'

export async function toBitmap(rgba: Uint8Array, width: number, height: number): Promise<ImageBitmap> {
  const data = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4).slice(), width, height)
  return createImageBitmap(data)
}

/** 一组帧转成 ImageBitmap（帧数组换了才重做） */
export function useBitmaps(frames: Uint8Array[] | undefined, width: number, height: number): ImageBitmap[] {
  const [bitmaps, setBitmaps] = useState<ImageBitmap[]>([])
  useEffect(() => {
    if (!frames || frames.length === 0) {
      setBitmaps([])
      return
    }
    let dead = false
    void Promise.all(frames.map((f) => toBitmap(f, width, height))).then((b) => {
      if (dead) b.forEach((x) => x.close())
      else setBitmaps(b)
    })
    return () => {
      dead = true
    }
  }, [frames, width, height])
  useEffect(() => () => bitmaps.forEach((b) => b.close()), [bitmaps])
  return bitmaps
}

/** 画布按设备像素比放大，内容按 CSS 像素画；返回 2D 上下文 */
export function prepCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(cssW * dpr))
  const h = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, cssW, cssH)
  return ctx
}

/** 一张位图按整数倍最近邻画进固定大小的格子（居中） */
export function BitmapView({
  bitmap,
  width,
  height,
  className
}: {
  bitmap: ImageBitmap | undefined
  width: number
  height: number
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = prepCanvas(c, width, height)
    if (!ctx || !bitmap) return
    const s = Math.min(width / bitmap.width, height / bitmap.height)
    const z = s >= 1 ? Math.floor(s) : s
    const w = bitmap.width * z
    const h = bitmap.height * z
    ctx.drawImage(bitmap, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h)
  }, [bitmap, width, height])
  return <canvas ref={ref} className={className} />
}

export function hex([r, g, b]: readonly number[]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
