import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelViewer } from '@renderer/app/model3d'
import { errText } from '@renderer/screens/Library/shared'
import { Button, cx, GroupList, GroupRow, Icon, IconButton, Select, Sheet, Tag } from '@renderer/ui'
import { modelFileUrl } from '@shared/api'
import type { LibModel, ModelAnimation } from '@shared/types'
import { copyForAI, copyModelTo, revealModel } from './actions'
import { formatCount, formatDims, formatSeconds } from './format'

export interface ModelViewerSheetProps {
  /** 要看的模型；null 时关闭 */
  model: LibModel | null
  /** 打开时先播放的动作（文件里的名字）；不给就播待机或第一个循环动作 */
  clip?: string | null
  onClose: () => void
}

/** 3D 查看器：拖动旋转、滚轮缩放、右键平移，地面网格，下拉或点右边的动作切换播放 */
export function ModelViewerSheet({ model, clip, onClose }: ModelViewerSheetProps): React.JSX.Element | null {
  // 换一个模型就重建查看器
  return model ? <Viewer key={model.id} model={model} initialClip={clip ?? null} onClose={onClose} /> : null
}

type Phase = 'loading' | 'ready' | 'error'

const STILL = ''

/** 动作列表：asset.json 的顺序在前，模型文件里多出来的补在后面；加载完之前先按记录显示 */
function animationRows(model: LibModel, clips: string[] | null): ModelAnimation[] {
  if (clips === null) return model.animations
  const known = model.animations.filter((a) => clips.includes(a.clip))
  const extra = clips
    .filter((c) => !known.some((a) => a.clip === c))
    .map((c): ModelAnimation => ({ name: c, clip: c, seconds: 0, loop: false }))
  return [...known, ...extra]
}

function firstClip(rows: ModelAnimation[], wanted: string | null): string | null {
  if (wanted && rows.some((a) => a.clip === wanted)) return wanted
  const pick =
    rows.find((a) => a.loop && /idle|待机/i.test(a.name + a.clip)) ?? rows.find((a) => a.loop) ?? rows[0]
  return pick?.clip ?? null
}

function Viewer({ model, initialClip, onClose }: { model: LibModel; initialClip: string | null; onClose: () => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<ModelViewer | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [clips, setClips] = useState<string[] | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const rows = useMemo(() => animationRows(model, clips), [model, clips])

  const startRef = useRef({ model, initialClip })
  useEffect(() => {
    let cancelled = false
    let viewer: ModelViewer | null = null
    const { model: m, initialClip: wanted } = startRef.current
    void (async () => {
      try {
        // three.js 比较大，打开查看器时再加载
        const { createModelViewer } = await import('@renderer/app/model3d')
        if (cancelled || !canvasRef.current) return
        viewer = createModelViewer(canvasRef.current)
        viewerRef.current = viewer
        const names = await viewer.load(modelFileUrl(m.id, m.file))
        if (cancelled) return
        const first = firstClip(animationRows(m, names), wanted)
        viewer.play(first)
        setClips(names)
        setPlaying(first)
        setPhase('ready')
      } catch (err) {
        if (cancelled) return
        setError(errText(err))
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
      viewer?.dispose()
      viewerRef.current = null
    }
  }, [])

  const play = (c: string | null): void => {
    viewerRef.current?.play(c)
    viewerRef.current?.setPaused(false)
    setPlaying(c)
    setPaused(false)
  }
  const togglePause = (): void => {
    viewerRef.current?.setPaused(!paused)
    setPaused(!paused)
  }

  const ready = phase === 'ready'
  const options = [
    { value: STILL, label: '静止姿势' },
    ...rows.map((a) => ({ value: a.clip, label: a.loop ? `${a.name}  ↻` : a.name }))
  ]

  return (
    <Sheet
      open
      onClose={onClose}
      title={model.name}
      subtitle={[model.category, formatDims(model.size), `${formatCount(model.triangles)} 面`, model.version && `v${model.version}`]
        .filter(Boolean)
        .join(' · ')}
      width={1000}
      height={620}
      bodyClassName="ql-body mv-body"
      footer={
        <>
          <Button icon="folder" onClick={() => void revealModel(model)}>
            在访达中显示
          </Button>
          <Button onClick={() => void copyModelTo(model)}>拷贝文件夹到…</Button>
          <span className="grow" />
          <Button onClick={onClose}>关闭</Button>
          <Button variant="primary" icon="copy" onClick={() => void copyForAI(model)}>
            复制给 AI
          </Button>
        </>
      }
    >
      <div className="mv-stage">
        <canvas ref={canvasRef} className="mv-canvas" />
        {phase === 'loading' && <div className="mv-msg">正在载入模型…</div>}
        {phase === 'error' && (
          <div className="mv-msg">
            <Icon name="info" size={22} />
            <div>没能载入模型</div>
            <div className="lbl">{error}</div>
          </div>
        )}
        {ready && (
          <div className="mv-bar">
            {rows.length > 0 && (
              <Select
                value={playing ?? STILL}
                options={options}
                ariaLabel="动作"
                onChange={(v) => play(v === STILL ? null : v)}
              />
            )}
            {rows.length > 0 && (
              <IconButton
                icon={paused ? 'play' : 'pause'}
                label={paused ? '继续播放' : '暂停'}
                disabled={playing === null}
                onClick={togglePause}
              />
            )}
            <IconButton icon="scope" label="回到初始视角" onClick={() => viewerRef.current?.resetView()} />
          </div>
        )}
        {ready && <div className="mv-hint">拖动旋转 · 滚轮缩放 · 右键拖动平移</div>}
      </div>

      <div className="ql-info mv-info">
        <GroupList>
          <GroupRow compact label="尺寸" value={formatDims(model.size)} />
          <GroupRow compact label="面数" value={formatCount(model.triangles)} />
          <GroupRow compact label="骨骼" value={model.bones > 0 ? model.bones : '无'} />
          <GroupRow compact label="版本" value={model.version || '—'} />
        </GroupList>

        <section className="gsec">
          <div className="gh">动作</div>
          {rows.length > 0 ? (
            <div className="group">
              {rows.map((a) => (
                <button
                  key={a.clip + a.name}
                  type="button"
                  className={cx('as-lnk', 'mdl-anim', playing === a.clip && 'on')}
                  disabled={!ready}
                  title={a.clip !== a.name ? `文件内名 ${a.clip}` : undefined}
                  onClick={() => play(a.clip)}
                >
                  <span className="ic">
                    <Icon name={playing === a.clip && !paused ? 'pause' : 'play'} size={11} strokeWidth={2.2} />
                  </span>
                  <span className="t">{a.name}</span>
                  {a.loop && <span className="mdl-loop">循环</span>}
                  <span className="go mdl-sec">{a.seconds > 0 ? formatSeconds(a.seconds) : ''}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="lbl as-pad">没有动作</div>
          )}
        </section>

        {model.sockets.length > 0 && (
          <section className="gsec">
            <div className="gh">挂点</div>
            <div className="tags as-pad">
              {model.sockets.map((s) => (
                <Tag key={s} size="xs">
                  {s}
                </Tag>
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  )
}
