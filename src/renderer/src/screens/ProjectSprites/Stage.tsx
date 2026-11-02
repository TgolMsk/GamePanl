// 中间栏：预览（放大、背景、落脚点、对比源视频）+ 像素调节 + 帧条（删帧、换相邻源帧）+ 源视频时间轴（拖动选片段）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { Button, Icon, Segmented, Stepper, cx } from '@renderer/ui'
import { sourceFrame, timelineThumbs, type ActionOutput, type ActionPhase } from '@renderer/sprites/engine'
import type { SpriteAction, SpriteFrameEdit } from '@shared/sprites'
import { BitmapView, prepCanvas, toBitmap, useBitmaps } from './draw'

export type StageBg = 'checker' | 'gray' | 'black' | 'white'

interface ViewPrefs {
  zoom: number | null
  bg: StageBg
  guides: boolean
  compare: boolean
}

const PREFS_KEY = 'gamepanl.sprites.view'

function loadPrefs(): ViewPrefs {
  const d: ViewPrefs = { zoom: null, bg: 'checker', guides: true, compare: false }
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ViewPrefs>) }
  } catch {
    return d
  }
}

export const useViewPrefs = create<ViewPrefs>(() => loadPrefs())
useViewPrefs.subscribe((s) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(s))
  } catch {
    // 记不住只是下次回到默认
  }
})

const BG_OPTIONS: Array<{ value: StageBg; label: string }> = [
  { value: 'checker', label: '格' },
  { value: 'gray', label: '灰' },
  { value: 'black', label: '黑' },
  { value: 'white', label: '白' }
]

/** 换帧记录：把第 base 帧（抽帧算出来的）换成 to；to === base 时去掉记录 */
export function setEdit(edits: SpriteFrameEdit[], base: number, to: number | null): SpriteFrameEdit[] {
  const rest = edits.filter((e) => e.from !== base)
  return to === base ? rest : [...rest, { from: base, to }]
}

export interface StageProps {
  action: SpriteAction
  out: ActionOutput | undefined
  phase: ActionPhase | undefined
  error: string | undefined
  cur: number
  setCur: (i: number) => void
  playing: boolean
  setPlaying: (on: boolean) => void
  onEdits: (edits: SpriteFrameEdit[]) => void
  onSegment: (start: number | null, end: number | null) => void
  onRetry: () => void
  stageRef: React.RefObject<HTMLElement | null>
  /** 预览上方的像素调节条 */
  pixelBar?: React.ReactNode
}

export function Stage(p: StageProps): React.JSX.Element {
  const { out, cur, playing, setPlaying, setCur } = p
  const prefs = useViewPrefs()
  const n = out?.frames.length ?? 0
  const fw = out?.frameWidth ?? 1
  const fh = out?.frameHeight ?? 1
  const bitmaps = useBitmaps(out?.frames, fw, fh)
  const viewRef = useRef<HTMLDivElement>(null)
  const viewSize = useSize(viewRef)
  const zoom = prefs.zoom ?? fitZoom(viewSize, fw, fh, prefs.compare)
  const fps = out?.analysis.fps ?? 12

  // 按导出帧率循环播放
  useEffect(() => {
    if (!playing || n < 2) return
    const t = setInterval(() => setCur((cur + 1) % n), 1000 / fps)
    return () => clearInterval(t)
  }, [playing, n, fps, cur, setCur])

  const i = n ? Math.min(cur, n - 1) : 0
  const pick = out?.analysis.picks[i]

  let view: React.ReactNode
  if (!out) {
    view =
      p.phase === 'error' ? (
        <div className="sp-msg err">
          {p.error ?? '处理失败'}
          <div style={{ marginTop: 12 }}>
            <Button size="sm" onClick={p.onRetry}>
              重试
            </Button>
          </div>
        </div>
      ) : (
        <div className="sp-msg">{p.phase === 'loading' ? '正在读取视频…' : p.phase === 'rendering' ? '正在出图…' : '正在分析…'}</div>
      )
  } else {
    view = (
      <>
        <FrameView bitmap={bitmaps[i]} out={out} zoom={zoom} guides={prefs.guides} checker={prefs.bg === 'checker'} caption={`${i + 1} / ${n} · ${fw}×${fh}`} />
        {prefs.compare && pick && <SourceView out={out} frame={pick.frame} zoom={zoom} />}
      </>
    )
  }

  return (
    <section ref={p.stageRef} className="sp-stage" tabIndex={0} aria-label="序列帧预览">
      {/* 工具条分四组，窄时整组换行，组内不拆开 */}
      <div className="sp-bar">
        <div className="g">
          <Button
            size="sm"
            variant="plain"
            icon={playing ? 'pause' : 'play'}
            onClick={() => setPlaying(!playing)}
            disabled={n < 2}
            aria-label={playing ? '暂停' : '播放'}
            title={playing ? '暂停（空格）' : '播放（空格）'}
          />
          <Button size="sm" variant="plain" icon="chevron.left" onClick={() => n && setCur((i - 1 + n) % n)} disabled={n < 2} aria-label="上一帧" />
          <Button size="sm" variant="plain" icon="chevron.right" onClick={() => n && setCur((i + 1) % n)} disabled={n < 2} aria-label="下一帧" />
          <span className="lbl fps">{out ? `${fps.toFixed(fps % 1 ? 2 : 0)} fps` : ''}</span>
        </div>
        <div className="g">
          <span className="lbl zoom" title={prefs.zoom === null ? '按预览区大小自动放大' : '放大倍数'}>
            {zoom}×
          </span>
          <Stepper value={zoom} min={1} max={8} onChange={(z) => useViewPrefs.setState({ zoom: z })} label="放大倍数" />
          {prefs.zoom !== null && (
            <Button size="sm" variant="plain" onClick={() => useViewPrefs.setState({ zoom: null })} title="按预览区大小自动放大">
              适应
            </Button>
          )}
        </div>
        <div className="g">
          <Segmented ariaLabel="背景" value={prefs.bg} onChange={(bg) => useViewPrefs.setState({ bg })} options={BG_OPTIONS} />
        </div>
        <div className="g">
          <Button size="sm" variant="plain" icon={prefs.guides ? 'checkmark.square' : 'square'} onClick={() => useViewPrefs.setState({ guides: !prefs.guides })}>
            落脚点
          </Button>
          <Button size="sm" variant="plain" icon={prefs.compare ? 'checkmark.square' : 'square'} onClick={() => useViewPrefs.setState({ compare: !prefs.compare })}>
            对比原片
          </Button>
        </div>
      </div>
      {p.pixelBar}
      <div ref={viewRef} className={cx('sp-view', prefs.bg !== 'checker' && `bg-${prefs.bg}`)}>
        {view}
      </div>
      {out && <FrameStrip {...p} out={out} bitmaps={bitmaps} i={i} />}
      {out && <Timeline {...p} out={out} i={i} />}
    </section>
  )
}

/** 元素内容区大小（跟着窗口、侧栏变化） */
function useSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (): void =>
      setSize((old) => (old && old.w === el.clientWidth && old.h === el.clientHeight ? old : { w: el.clientWidth, h: el.clientHeight }))
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [ref])
  return size
}

/** 自动放大：整数倍、整帧（连同下方说明文字）放得进预览区；对比原片时左右各占一半 */
export function fitZoom(view: { w: number; h: number } | null, fw: number, fh: number, compare: boolean): number {
  if (!view) return Math.max(1, Math.min(8, Math.floor(300 / fh)))
  const pad = 40 // .sp-view 四周 20
  const cap = 44 // 帧下方的说明文字，上下各留一份保证居中时不出界
  const gap = 28
  const w = compare ? (view.w - pad - gap) / 2 : view.w - pad
  const h = view.h - pad - cap
  return Math.max(1, Math.min(8, Math.floor(Math.min(w / fw, h / fh))))
}

function FrameView({
  bitmap,
  out,
  zoom,
  guides,
  checker,
  caption
}: {
  bitmap: ImageBitmap | undefined
  out: ActionOutput
  zoom: number
  guides: boolean
  checker: boolean
  caption: string
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = out.frameWidth * zoom
  const h = out.frameHeight * zoom
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = prepCanvas(c, w, h)
    if (ctx && bitmap) ctx.drawImage(bitmap, 0, 0, w, h)
  }, [bitmap, w, h])
  const [px, py] = out.layout.pivot
  return (
    <div className="sp-cell" style={{ width: w, height: h }}>
      <canvas ref={ref} className={checker ? 'checker' : undefined} />
      {guides && (
        <>
          <div className="sp-pv frame" />
          <div className="sp-pv ground" style={{ top: py * zoom }} />
          <div className="sp-pv pivot" style={{ left: px * zoom, top: py * zoom }} />
        </>
      )}
      <div className="cap">{caption}</div>
    </div>
  )
}

/** 源视频对应帧（裁到同一块区域，按同样的比例显示） */
function SourceView({ out, frame, zoom }: { out: ActionOutput; frame: number; zoom: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const { box, scale } = out.layout
  const padTop = ((out.frameHeight - out.layout.ch) / 2) * zoom
  const w = Math.max(1, Math.round((box.x1 - box.x0) * scale * zoom))
  const h = Math.max(1, Math.round((box.y1 - box.y0) * scale * zoom))
  useEffect(() => {
    let dead = false
    const dpr = window.devicePixelRatio || 1
    void sourceFrame(out.key, frame, box, Math.max(w, h) * dpr).then(async (r) => {
      if (dead || !ref.current) return
      const bmp = await toBitmap(r.rgba, r.width, r.height)
      const ctx = prepCanvas(ref.current, w, h)
      if (ctx) {
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(bmp, 0, 0, w, h)
      }
      bmp.close()
    })
    return () => {
      dead = true
    }
  }, [out.key, frame, box, w, h])
  return (
    <div className="sp-cell" style={{ width: w, height: out.frameHeight * zoom }}>
      <canvas ref={ref} style={{ marginTop: padTop }} />
      <div className="cap">源视频第 {frame} 帧</div>
    </div>
  )
}

function FrameStrip(p: StageProps & { out: ActionOutput; bitmaps: ImageBitmap[]; i: number }): React.JSX.Element {
  const { out, action, i } = p
  const th = 56
  const tw = Math.max(28, Math.min(120, Math.round((out.frameWidth / out.frameHeight) * th)))
  const total = out.analysis.info.frameCount
  const edits = action.edits
  const swap = (base: number, frame: number, d: number): void => {
    const to = Math.max(0, Math.min(total - 1, frame + d))
    p.onEdits(setEdit(edits, base, to))
  }
  return (
    <div className="sp-strip" aria-label="帧条">
      {out.analysis.picks.map((pk, k) => {
        const edited = pk.frame !== pk.base
        return (
          <div
            key={`${pk.base}`}
            className={cx('sp-fr', k === i && 'on')}
            onClick={() => {
              p.setPlaying(false)
              p.setCur(k)
            }}
          >
            <div className="img checker">
              <BitmapView bitmap={p.bitmaps[k]} width={tw} height={th} />
            </div>
            <span className={cx('n', edited && 'ed')} title={edited ? `原来是第 ${pk.base} 帧` : undefined}>
              {k + 1} · {pk.frame}
            </span>
            <div className="tools">
              <button type="button" title="换成前一帧" onClick={(e) => (e.stopPropagation(), swap(pk.base, pk.frame, -1))}>
                <Icon name="chevron.left" size={12} strokeWidth={2.2} />
              </button>
              {edited ? (
                <button type="button" title="恢复" onClick={(e) => (e.stopPropagation(), p.onEdits(setEdit(edits, pk.base, pk.base)))}>
                  <Icon name="undo" size={11} strokeWidth={2.2} />
                </button>
              ) : (
                <button
                  type="button"
                  title="删掉这一帧"
                  disabled={out.analysis.picks.length <= 1}
                  onClick={(e) => (e.stopPropagation(), p.onEdits(setEdit(edits, pk.base, null)))}
                >
                  <Icon name="xmark" size={11} strokeWidth={2.4} />
                </button>
              )}
              <button type="button" title="换成后一帧" onClick={(e) => (e.stopPropagation(), swap(pk.base, pk.frame, 1))}>
                <Icon name="chevron.right" size={12} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        )
      })}
      {out.analysis.dropped.map((b) => (
        <button key={`d${b}`} type="button" className="sp-fr gone" title="点击恢复这一帧" onClick={() => p.onEdits(setEdit(edits, b, b))}>
          <div className="img" style={{ width: tw, height: th }}>
            已删
          </div>
          <span className="n">恢复 {b}</span>
        </button>
      ))}
    </div>
  )
}

const thumbCache = new Map<string, Promise<HTMLCanvasElement>>()

/** 时间轴缩略图拼成一张长图（每个动作只做一次） */
function useTimelineStrip(key: string): { canvas: HTMLCanvasElement; w: number; h: number; count: number } | null {
  const [strip, setStrip] = useState<{ canvas: HTMLCanvasElement; w: number; h: number; count: number } | null>(null)
  useEffect(() => {
    let dead = false
    let p = thumbCache.get(key)
    if (!p) {
      p = timelineThumbs(key, 44).then((r) => {
        const c = document.createElement('canvas')
        c.width = r.width * r.count
        c.height = r.height
        const ctx = c.getContext('2d')
        if (ctx) {
          const sz = r.width * r.height * 4
          for (let t = 0; t < r.count; t++) {
            const img = new ImageData(new Uint8ClampedArray(r.rgba.buffer, r.rgba.byteOffset + t * sz, sz).slice(), r.width, r.height)
            ctx.putImageData(img, t * r.width, 0)
          }
        }
        c.dataset.w = String(r.width)
        c.dataset.count = String(r.count)
        return c
      })
      thumbCache.set(key, p)
      p.catch(() => thumbCache.delete(key))
    }
    void p.then((c) => {
      if (!dead) setStrip({ canvas: c, w: Number(c.dataset.w), h: c.height, count: Number(c.dataset.count) })
    })
    return () => {
      dead = true
    }
  }, [key])
  return strip
}

function Timeline(p: StageProps & { out: ActionOutput; i: number }): React.JSX.Element {
  const { out, i } = p
  const total = out.analysis.info.frameCount
  const [seg0, seg1] = out.analysis.segment
  const [drag, setDrag] = useState<[number, number] | null>(null)
  const [s, e] = drag ?? [seg0, seg1]
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const strip = useTimelineStrip(out.key)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !width || !strip) return
    const H = 44
    const ctx = prepCanvas(c, width, H)
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    // 每格放一帧；格子比缩略图窄时取中间一条
    const cell = width / strip.count
    for (let t = 0; t < strip.count; t++) {
      const x0 = Math.floor(t * cell)
      const x1 = Math.floor((t + 1) * cell)
      const dw = Math.max(1, x1 - x0)
      const sw = Math.min(strip.w, (dw * strip.h) / H)
      ctx.drawImage(strip.canvas, t * strip.w + (strip.w - sw) / 2, 0, sw, strip.h, x0, 0, dw, H)
    }
  }, [strip, width])

  const xOf = (f: number): number => (width * f) / total
  const frameAt = (clientX: number): number => {
    const r = boxRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.round(((clientX - r.left) / r.width) * total)
  }

  const startDrag = (which: 0 | 1) => (ev: React.PointerEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    const el = ev.currentTarget as HTMLElement
    el.setPointerCapture(ev.pointerId)
    let cur: [number, number] = [seg0, seg1]
    const move = (m: PointerEvent): void => {
      const f = frameAt(m.clientX)
      cur = which === 0 ? [Math.max(0, Math.min(cur[1] - 2, f)), cur[1]] : [cur[0], Math.min(total, Math.max(cur[0] + 2, f))]
      setDrag(cur)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(null)
      if (cur[0] !== seg0 || cur[1] !== seg1) p.onSegment(cur[0], cur[1])
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // 点时间轴：跳到最近的一帧
  const onClick = (ev: React.MouseEvent): void => {
    const f = frameAt(ev.clientX)
    let best = 0
    out.analysis.picks.forEach((pk, k) => {
      if (Math.abs(pk.frame - f) < Math.abs(out.analysis.picks[best].frame - f)) best = k
    })
    p.setPlaying(false)
    p.setCur(best)
  }

  const loop = out.analysis.loop
  const info = out.analysis.kind === 'loop' ? '循环' : '单次'
  const why = out.analysis.kindFrom === 'name' ? '按动作名' : out.analysis.kindFrom === 'manual' ? '手动指定' : '按首尾差异'
  const pick = out.analysis.picks[i]
  return (
    <div className="sp-tl">
      <div className="hd">
        <span
          className="lbl"
          title={`源视频 ${total} 帧 · 片段第 ${s}–${e - 1} 帧（${e - s} 帧）· ${info}（${why}）${loop ? ` · 周期 ${loop.periodFrames} 帧` : ''}`}
        >
          片段 {s}–{e - 1}（{e - s} 帧，共 {total}）· {info}
          {loop ? ` · 周期 ${loop.periodFrames}` : ''}
        </span>
        <span className="grow" />
        {!out.analysis.segmentAuto && (
          <Button size="sm" variant="plain" onClick={() => p.onSegment(null, null)}>
            自动选片段
          </Button>
        )}
      </div>
      <div ref={boxRef} className="sp-tlbox" onClick={onClick}>
        <canvas ref={canvasRef} />
        <div className="dim" style={{ left: 0, width: xOf(s) }} />
        <div className="dim" style={{ left: xOf(e), right: 0 }} />
        <div className="seg" style={{ left: xOf(s), width: xOf(e) - xOf(s) }} />
        {out.analysis.picks.map((pk) => (
          <div key={pk.base} className="tick" style={{ left: xOf(pk.frame + 0.5) }} />
        ))}
        {pick && <div className="cur" style={{ left: xOf(pick.frame + 0.5) }} />}
        <div className="hdl" style={{ left: xOf(s) }} onPointerDown={startDrag(0)} title="拖动调整片段起点" />
        <div className="hdl" style={{ left: xOf(e) }} onPointerDown={startDrag(1)} title="拖动调整片段终点" />
      </div>
    </div>
  )
}

/** 列表行和缩略图用：一个动作的第一帧 */
export function FirstFrame({ out, size }: { out: ActionOutput | undefined; size: number }): React.JSX.Element {
  const frames = useMemo(() => (out ? [out.frames[0]] : undefined), [out])
  const bitmaps = useBitmaps(frames, out?.frameWidth ?? 1, out?.frameHeight ?? 1)
  return <BitmapView bitmap={bitmaps[0]} width={size} height={size} />
}
