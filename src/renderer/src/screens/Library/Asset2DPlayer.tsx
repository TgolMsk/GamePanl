import { useEffect, useMemo, useRef, useState } from 'react'
import { cx, Icon, IconButton, Select } from '@renderer/ui'
import { asset2dFileUrl } from '@shared/api'
import type { Asset2DFrame, LibAsset2D } from '@shared/types'
import './assets2d.css'

export const asset2dPixelated = (asset: LibAsset2D): boolean =>
  asset.frameSize !== null && Math.max(...asset.frameSize) <= 256

/** 更新同一个资产时，图片地址也换一版，避免浏览器继续使用旧图 */
export function asset2dPreviewUrl(asset: LibAsset2D, thumb = 640): string {
  if (!asset.preview) return ''
  const query = new URLSearchParams({ v: asset.updatedAt })
  if (!asset2dPixelated(asset)) query.set('thumb', String(thumb))
  return `${asset2dFileUrl(asset.id, asset.preview)}?${query}`
}

/** 帧率显示：整数不带小数，否则最多两位（导出的帧率常是 12.63 这种） */
export const fpsText = (fps: number): string => `${Number(fps.toFixed(2))} fps`

/** 卡片上显示哪一帧：预览图就是图集（导入的 Aseprite 等）时取 idle（没有就第一个动画）的第一帧，否则直接用预览图 */
export function asset2dCoverFrame(asset: LibAsset2D): Asset2DFrame | null {
  const animation = asset.animations.find((a) => /^idle/i.test(a.name)) ?? asset.animations[0]
  const frame = animation?.frames[0]
  return frame?.rect && frame.file === asset.preview ? frame : null
}

/** 图集里的一帧画到 canvas（原尺寸，由 CSS 等比缩放、最近邻） */
export function Asset2DFrameThumb({ asset, frame, onError }: { asset: LibAsset2D; frame: Asset2DFrame; onError: () => void }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const failed = useRef(onError)
  failed.current = onError
  const [x, y, w, h] = frame.rect ?? [0, 0, 1, 1]
  useEffect(() => {
    let dead = false
    const image = new Image()
    image.onload = () => {
      const canvas = ref.current
      if (dead || !canvas) return
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(image, x, y, w, h, 0, 0, w, h)
    }
    image.onerror = () => !dead && failed.current()
    image.src = `${asset2dFileUrl(asset.id, frame.file)}?v=${encodeURIComponent(asset.updatedAt)}`
    return () => {
      dead = true
    }
  }, [asset.id, asset.updatedAt, frame.file, x, y, w, h])
  return <canvas ref={ref} className="a2d-thumb a2d-pixel" width={w} height={h} aria-label={asset.name} />
}

/** 动画预览：图片按文件缓存，图集只加载一次；最近邻整数倍放大，支持单次播放和逐帧查看 */
export function Asset2DPlayer({ asset }: { asset: LibAsset2D }): React.JSX.Element {
  return <Player key={`${asset.id}:${asset.updatedAt}`} asset={asset} />
}

function Player({ asset }: { asset: LibAsset2D }): React.JSX.Element {
  const [animationIndex, setAnimationIndex] = useState(0)
  const [frameIndex, setFrameIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const [size, setSize] = useState<[number, number] | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const images = useRef(new Map<string, Promise<HTMLImageElement>>())
  const loaded = useRef(new Map<string, HTMLImageElement>())
  const indexRef = useRef(0)
  const animation = asset.animations[animationIndex] ?? null
  const frame = animation?.frames[frameIndex] ?? animation?.frames[0] ?? null
  const files = useMemo(() => [...new Set(animation?.frames.map((f) => f.file) ?? [])], [animation])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!animation) return
    let cancelled = false
    setPhase('loading')
    void Promise.all(
      files.map((file) => {
        let job = images.current.get(file)
        if (!job) {
          job = new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.onerror = () => reject(new Error('读不到图片'))
            image.src = `${asset2dFileUrl(asset.id, file)}?v=${encodeURIComponent(asset.updatedAt)}`
          })
          images.current.set(file, job)
        }
        return job.then((image) => loaded.current.set(file, image))
      })
    )
      .then(() => {
        if (!cancelled) setPhase('ready')
      })
      .catch(() => {
        if (!cancelled) setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [animation, files, asset.id, asset.updatedAt])

  useEffect(() => {
    if (!animation || paused || phase !== 'ready') return
    let request = 0
    let last = 0
    const interval = 1000 / Math.max(1, animation.fps)
    const tick = (now: number): void => {
      if (last === 0) last = now
      const steps = Math.floor((now - last) / interval)
      if (steps > 0) {
        last += steps * interval
        const next = indexRef.current + steps
        if (!animation.loop && next >= animation.frames.length) {
          indexRef.current = animation.frames.length - 1
          setFrameIndex(indexRef.current)
          setPaused(true)
          return
        }
        indexRef.current = next % animation.frames.length
        setFrameIndex(indexRef.current)
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [animation, paused, phase])

  useEffect(() => {
    const canvas = canvasRef.current
    const image = frame && loaded.current.get(frame.file)
    if (!canvas || !frame || !image || phase !== 'ready') return
    const [x, y, width, height] = frame.rect ?? [0, 0, image.naturalWidth, image.naturalHeight]
    const zoom = Math.max(
      1,
      Math.min(8, Math.floor(Math.min((bounds.width - 24) / width, (bounds.height - 24) / height)))
    )
    canvas.width = width * zoom
    canvas.height = height * zoom
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height)
    setSize((old) => (old?.[0] === width && old[1] === height ? old : [width, height]))
  }, [frame, phase, bounds])

  const chooseAnimation = (value: string): void => {
    indexRef.current = 0
    setFrameIndex(0)
    setAnimationIndex(Number(value))
    setPaused(false)
  }
  const step = (delta: number): void => {
    if (!animation) return
    setPaused(true)
    indexRef.current = (indexRef.current + delta + animation.frames.length) % animation.frames.length
    setFrameIndex(indexRef.current)
  }
  const toggle = (): void => {
    if (animation && paused && !animation.loop && frameIndex === animation.frames.length - 1) {
      indexRef.current = 0
      setFrameIndex(0)
    }
    setPaused(!paused)
  }

  return (
    <div className="a2d-player">
      <div ref={stageRef} className="a2d-stage checker">
        {animation ? (
          <>
            <canvas
              ref={canvasRef}
              aria-label={`${asset.name} · ${animation.name} · 第 ${frameIndex + 1} 帧`}
              hidden={phase !== 'ready'}
            />
            {phase !== 'ready' && (
              <div className="a2d-player-message">{phase === 'loading' ? '正在读取图片…' : '没能读取动画图片'}</div>
            )}
          </>
        ) : asset.preview ? (
          <img
            className={cx('a2d-static', asset2dPixelated(asset) && 'a2d-pixel')}
            src={asset2dPreviewUrl(asset, 1200)}
            alt={asset.name}
            draggable={false}
            onError={() => setPhase('error')}
            hidden={phase === 'error'}
          />
        ) : (
          <Icon name="grid" size={32} strokeWidth={1.2} />
        )}
        {!animation && asset.preview && phase === 'error' && <div className="a2d-player-message">没能读取预览图</div>}
      </div>
      {animation && (
        <div className="a2d-player-controls">
          {asset.animations.length > 1 ? (
            <Select
              value={String(animationIndex)}
              options={asset.animations.map((a, i) => ({ value: String(i), label: a.group ? `${a.group} · ${a.name}` : a.name }))}
              onChange={chooseAnimation}
              ariaLabel="动画"
              className="a2d-animation-select"
            />
          ) : (
            <span className="a2d-animation-name" title={animation.group ? `${animation.group} · ${animation.name}` : animation.name}>
              {animation.group ? `${animation.group} · ${animation.name}` : animation.name}
            </span>
          )}
          <div className="a2d-player-buttons">
            <IconButton icon="chevron.left" label="上一帧" onClick={() => step(-1)} disabled={phase !== 'ready'} />
            <IconButton
              icon={paused ? 'play' : 'pause'}
              label={paused ? '播放动画' : '暂停动画'}
              onClick={toggle}
              disabled={phase !== 'ready'}
            />
            <IconButton icon="chevron.right" label="下一帧" onClick={() => step(1)} disabled={phase !== 'ready'} />
          </div>
          <div className="a2d-player-position">
            {frameIndex + 1} / {animation.frames.length} · {fpsText(animation.fps)}{size && ` · ${size[0]}×${size[1]}`}
          </div>
        </div>
      )}
    </div>
  )
}
