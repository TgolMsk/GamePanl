// 定妆照（首帧图）：从人物图抠出人物，按统一的画幅、大小、底色摆好，存成人物素材里的一张图。
// 生成每个动作视频时都用它当首帧（单次动作首尾帧都用它），角色才不会一个动作一个样。
import { useEffect, useMemo, useRef, useState } from 'react'
import { hud } from '@renderer/app/hud'
import { showError } from '@renderer/screens/Library/shared'
import { cutOutReference, placeFigure, screenConflict, type CutOut } from '@renderer/sprites/core/anchor'
import { Button, Segmented, Select, Sheet, TextArea } from '@renderer/ui'
import { spriteRefUrl } from '@shared/api'
import {
  anchorRef,
  buildAnchorPrompt,
  SPRITE_ASPECTS,
  SPRITE_FACING_LABELS,
  SPRITE_SCREENS,
  type SpriteAspect,
  type SpriteCharacter,
  type SpriteFacing,
  type SpriteFrameSetup,
  type SpriteOwner,
  type SpriteRef,
  type SpriteScreen
} from '@shared/sprites'
import { expectDownload, useGen } from './gen'

/** 抠图在长边不超过这个尺寸上做（首帧图里人物高度最多 1000 多像素，够用） */
const CUT_SIDE = 1024

interface Loaded {
  refId: string
  holes: boolean
  cut: CutOut
  /** 抠好的人物（带透明度） */
  figure: OffscreenCanvas
  /** 原图（缩到 CUT_SIDE 以内） */
  source: OffscreenCanvas
}

async function loadRef(owner: SpriteOwner, chId: string, ref: SpriteRef, holes: boolean): Promise<Loaded> {
  const big = Math.max(ref.width, ref.height) > CUT_SIDE
  const res = await fetch(spriteRefUrl(owner, chId, ref.id, big ? CUT_SIDE : undefined))
  if (!res.ok) throw new Error('读不到这张人物图')
  const bmp = await createImageBitmap(await res.blob())
  const k = Math.min(1, CUT_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const source = new OffscreenCanvas(w, h)
  const sctx = source.getContext('2d', { willReadFrequently: true })
  if (!sctx) throw new Error('读不到这张人物图')
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const cut = cutOutReference(sctx.getImageData(0, 0, w, h).data, w, h, holes)
  const figure = new OffscreenCanvas(w, h)
  figure.getContext('2d')?.putImageData(new ImageData(cut.rgba, w, h), 0, 0)
  return { refId: ref.id, holes, cut, figure, source }
}

/** 按设置画首帧图；cut 为 false 时原图缩放后放在画面正中 */
function drawFirstFrame(target: HTMLCanvasElement | OffscreenCanvas, l: Loaded, setup: SpriteFrameSetup, cut: boolean): void {
  const [W, H] = SPRITE_ASPECTS[setup.aspect]
  target.width = W
  target.height = H
  const ctx = target.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return
  ctx.fillStyle = SPRITE_SCREENS[setup.screen].hex
  ctx.fillRect(0, 0, W, H)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (cut) {
    if (!l.cut.bounds) return
    const p = placeFigure(l.cut.bounds, W, H, setup.fill)
    ctx.drawImage(l.figure, p.x, p.y, l.figure.width * p.scale, l.figure.height * p.scale)
  } else {
    const k = Math.min(W / l.source.width, H / l.source.height)
    ctx.drawImage(l.source, (W - l.source.width * k) / 2, (H - l.source.height * k) / 2, l.source.width * k, l.source.height * k)
  }
}

export interface AnchorSheetProps {
  owner: SpriteOwner
  ch: SpriteCharacter
  facing: SpriteFacing
  /** 先选这张人物图（刚画好、刚收进来的） */
  from?: string | null
  onChange: (character: SpriteCharacter) => void
  onClose: () => void
  onJobs: () => void
}

export function AnchorSheet({ owner, ch, facing, from: preferred = null, onChange, onClose, onJobs }: AnchorSheetProps): React.JSX.Element {
  const label = SPRITE_FACING_LABELS[facing]
  const current = anchorRef(ch, facing)
  const sources = ch.refs.filter((r) => !r.facing)
  const initial = (preferred && sources.find((r) => r.id === preferred)) || (current?.from && sources.find((r) => r.id === current.from)) || sources.find((r) => r.id === ch.mainRef) || sources[0] || null
  const codex = useGen((s) => !!s.tools?.codex)
  const inbox = useGen((s) => s.settings?.inbox ?? false)
  const [from, setFrom] = useState<string | null>(initial?.id ?? null)
  const [mode, setMode] = useState<'cut' | 'asis'>('cut')
  const [holes, setHoles] = useState(false)
  const [setup, setSetup] = useState<SpriteFrameSetup>(ch.frameSetup)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const prompt = buildAnchorPrompt({ ...ch, frameSetup: setup }, facing)

  useEffect(() => {
    const ref = sources.find((r) => r.id === from)
    setLoaded(null)
    setError(null)
    if (!ref) return
    let alive = true
    loadRef(owner, ch.id, ref, holes).then(
      (l) => alive && setLoaded(l),
      (err) => alive && setError(err instanceof Error ? err.message : String(err))
    )
    return () => {
      alive = false
    }
    // sources 每次渲染都是新数组；只在换了图时重新抠
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ch.id, from, holes])

  const conflicts = useMemo(() => {
    if (!loaded) return null
    return Object.fromEntries((Object.keys(SPRITE_SCREENS) as SpriteScreen[]).map((s) => [s, screenConflict(loaded.cut.rgba, SPRITE_SCREENS[s].rgb)])) as Record<SpriteScreen, number>
  }, [loaded])

  useEffect(() => {
    if (loaded && canvas.current) drawFirstFrame(canvas.current, loaded, setup, mode === 'cut')
  }, [loaded, setup, mode])

  const conflict = conflicts?.[setup.screen] ?? 0
  const better = conflicts ? (Object.keys(conflicts) as SpriteScreen[]).reduce((a, b) => (conflicts[b] < conflicts[a] ? b : a)) : setup.screen
  const empty = loaded !== null && mode === 'cut' && !loaded.cut.bounds

  const save = async (): Promise<void> => {
    if (!loaded || saving || empty) return
    setSaving(true)
    try {
      let png: Uint8Array | null = null
      if (mode === 'cut') {
        const out = new OffscreenCanvas(1, 1)
        drawFirstFrame(out, loaded, setup, true)
        png = new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer())
      }
      let next = await window.gp.sprites.saveAnchor(owner, ch.id, facing, loaded.refId, png)
      if (JSON.stringify(setup) !== JSON.stringify(next.frameSetup)) next = await window.gp.sprites.update(owner, ch.id, { frameSetup: setup })
      onChange(next)
      hud.show(`已存为${label}定妆照`, { ok: true })
      onClose()
    } catch (err) {
      showError('保存定妆照失败', err)
    } finally {
      setSaving(false)
    }
  }

  const copyPrompt = async (): Promise<void> => {
    try {
      await window.gp.clipboard.copyText(prompt)
      expectDownload(owner, ch.id, null, prompt)
      hud.show(inbox ? '已复制定妆照提示词；画好下载的图片会自动放进人物素材' : '已复制定妆照提示词')
    } catch (err) {
      showError('复制失败', err)
    }
  }

  const draw = async (): Promise<void> => {
    try {
      if (JSON.stringify(setup) !== JSON.stringify(ch.frameSetup)) onChange(await window.gp.sprites.update(owner, ch.id, { frameSetup: setup }))
      await window.gp.sprites.generateImage(owner, ch.id, facing, 'anchor')
      hud.show(`codex 开始画${label}定妆照草稿，画好后在提示里点「做成定妆照」`, { action: { label: '查看任务', run: onJobs } })
      onClose()
    } catch (err) {
      showError('没能开始画图', err)
    }
  }

  const [W, H] = SPRITE_ASPECTS[mode === 'cut' ? setup.aspect : '16:9']
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${current ? '重做' : '做'}${label}定妆照`}
      subtitle="定妆照是生成每个动作视频的首帧：人物摆在纯色底上，大小、位置都统一"
      width={820}
      bodyClassName="sp-anchor-sheet"
      footer={<><span className="grow" /><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!loaded || saving || empty} onClick={() => void save()}>{saving ? '保存中…' : '存为定妆照'}</Button></>}
    >
      <div className="sp-anchor-preview">
        <div className="sp-anchor-canvas" style={{ aspectRatio: `${W} / ${H}` }}>
          {loaded ? <canvas ref={canvas} aria-label="首帧图预览" /> : <span className="sp-note">{error ?? (from ? '正在抠图…' : '先到人物素材里添加人物图')}</span>}
        </div>
        <div className="sp-anchor-notes" role="status">
          {loaded && mode === 'cut' && !loaded.cut.solid && <p className="warn">这张图的背景不是纯色，可能去不干净。可以先复制下面的提示词，让 AI 画一张纯色底的标准定妆照，加进人物素材后再用它做。</p>}
          {empty && <p className="warn">没有抠出人物，换一张图试试，或选「原图不动」。</p>}
          {loaded && conflict > 0.02 && (
            <p className="warn">
              人物身上有 {Math.round(conflict * 100)}% 接近{SPRITE_SCREENS[setup.screen].label}的颜色，抠图时会被一起去掉。
              {better !== setup.screen && <Button size="sm" variant="plain" onClick={() => setSetup({ ...setup, screen: better })}>换成{SPRITE_SCREENS[better].label}</Button>}
            </p>
          )}
          {loaded && mode === 'asis' && <p>原图不动：直接把这张图当首帧，画幅按原图。适合已经是纯色底、全身站姿的图。</p>}
        </div>
      </div>
      <div className="sp-anchor-fields">
        <label className="sp-text-field"><span>用哪张人物图</span>
          {sources.length ? <Select<string> className="sp-anchor-select" value={from ?? ''} ariaLabel="用哪张人物图" options={sources.map((r) => ({ value: r.id, label: r.name || '人物图' }))} onChange={setFrom} /> : <span className="sp-note">还没有人物图</span>}
        </label>
        <div className="sp-text-field"><span>背景</span><Segmented<'cut' | 'asis'> value={mode} ariaLabel="背景" options={[{ value: 'cut', label: '去掉背景重新摆' }, { value: 'asis', label: '原图不动' }]} onChange={setMode} />
          {mode === 'cut' && <label className="sp-anchor-check"><input type="checkbox" checked={holes} onChange={(e) => setHoles(e.target.checked)} />也去掉手臂和身体之间露出的背景（衣服和背景同色时别开）</label>}
        </div>
        <div className="sp-text-field"><span>画幅（和生成视频选的一致）</span><Segmented<SpriteAspect> value={setup.aspect} ariaLabel="画幅" options={(Object.keys(SPRITE_ASPECTS) as SpriteAspect[]).map((a) => ({ value: a, label: a }))} onChange={(aspect) => setSetup({ ...setup, aspect })} /></div>
        <label className="sp-text-field"><span className="sp-field-heading"><span>人物大小</span><span className="sp-note">占画面高度 {Math.round(setup.fill * 100)}%</span></span>
          <input type="range" className="sp-range" min={40} max={80} step={5} value={Math.round(setup.fill * 100)} disabled={mode === 'asis'} aria-label="人物大小" onChange={(e) => setSetup({ ...setup, fill: Number(e.target.value) / 100 })} />
        </label>
        <div className="sp-text-field"><span>底色</span><Segmented<SpriteScreen> value={setup.screen} ariaLabel="底色" options={(Object.keys(SPRITE_SCREENS) as SpriteScreen[]).map((s) => ({ value: s, label: SPRITE_SCREENS[s].label }))} onChange={(screen) => setSetup({ ...setup, screen })} /></div>
        <p className="sp-note">画幅、人物大小、底色整个角色共用，几张定妆照保持一致；提示词里的背景色也跟着改。</p>
        <div className="sp-text-field">
          <div className="sp-field-heading"><span>没有合适的人物图时，让 AI 画一张</span><span className="sp-anchor-ai"><Button size="sm" icon="copy" onClick={() => void copyPrompt()}>复制</Button>{codex && sources.length > 0 && <Button size="sm" icon="sparkles" title="照着主图让本机 codex 画（ChatGPT 订阅自带的生图）" onClick={() => void draw()}>用 codex 画</Button>}</span></div>
          <TextArea className="sp-prompt-output" minRows={4} maxRows={7} value={prompt} readOnly aria-label="定妆照提示词" />
        </div>
      </div>
    </Sheet>
  )
}
