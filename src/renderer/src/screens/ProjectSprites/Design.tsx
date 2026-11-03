// 人物素材页的「AI 画人物图」：没有合适的人物图时，按人物描述（加上项目美术风格）画一张能直接做定妆照的图。
// 复制提示词去 ChatGPT / 即梦画（下载后自动收进人物素材），或让本机的 codex 直接画。
import { useEffect, useState } from 'react'
import { hud } from '@renderer/app/hud'
import { showError } from '@renderer/screens/Library/shared'
import { Button, Icon, Segmented } from '@renderer/ui'
import { buildAnchorPrompt, buildDesignPrompt, SPRITE_FACING_LABELS, viewFacings, type SpriteCharacter, type SpriteFacing, type SpriteOwner } from '@shared/sprites'
import { activeJobs, expectDownload, isWaiting, useGen } from './gen'

export interface DesignProps {
  owner: SpriteOwner
  ch: SpriteCharacter
  /** 输入框里还没存的描述和补充要求 */
  draft: { description: string; promptExtra: string }
  onChange: (character: SpriteCharacter) => void
  onJobs: () => void
}

export function Design({ owner, ch, draft, onChange, onJobs }: DesignProps): React.JSX.Element {
  const facings = viewFacings(ch.view)
  const [facing, setFacing] = useState<SpriteFacing>(facings[0])
  const [style, setStyle] = useState('')
  const [busy, setBusy] = useState(false)
  const tools = useGen((s) => s.tools)
  const inbox = useGen((s) => s.settings?.inbox ?? false)
  const jobs = useGen((s) => s.jobs)
  const drawing = activeJobs(jobs, owner, ch.id).filter((j) => j.kind === 'image')
  const waiting = useGen((s) => isWaiting(s.waiting, owner, ch.id, null))
  const f = facings.includes(facing) ? facing : facings[0]
  const live = { ...ch, ...draft }
  const hasRefs = ch.refs.length > 0

  useEffect(() => {
    let alive = true
    void window.gp.sprites.stylePrompt(owner).then((s) => alive && setStyle(s), () => undefined)
    return () => {
      alive = false
    }
  }, [owner])

  const copy = async (mode: 'design' | 'anchor'): Promise<void> => {
    const text = mode === 'design' ? buildDesignPrompt(live, f, style) : buildAnchorPrompt(live, f)
    try {
      await window.gp.clipboard.copyText(text)
      expectDownload(owner, ch.id, null, text)
      hud.show(inbox ? '已复制提示词；画好下载的图片会自动放进人物素材' : '已复制提示词')
    } catch (err) {
      showError('复制失败', err)
    }
  }

  const draw = async (mode: 'design' | 'anchor'): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      // 让 codex 用输入框里最新的描述
      if (draft.description !== ch.description || draft.promptExtra !== ch.promptExtra) onChange(await window.gp.sprites.update(owner, ch.id, draft))
      const job = await window.gp.sprites.generateImage(owner, ch.id, f, mode)
      hud.show(`codex 开始画${job.label.replace(' · ', '')}，一般要一两分钟`, { action: { label: '查看任务', run: onJobs } })
    } catch (err) {
      showError('没能开始画图', err)
    } finally {
      setBusy(false)
    }
  }

  const noCodex = !tools?.codex
  return (
    <div className="sp-design">
      <div className="sp-ref-section-heading">
        <h3>AI 画人物图</h3>
        {facings.length > 1 && <Segmented<SpriteFacing> value={f} ariaLabel="画哪个朝向" options={facings.map((x) => ({ value: x, label: SPRITE_FACING_LABELS[x] }))} onChange={setFacing} />}
      </div>
      <p className="sp-note">
        按人物描述画一张纯色底、全身{SPRITE_FACING_LABELS[f]}站姿的图，画好可以直接做定妆照。
        {owner !== null && (style ? `会带上项目的美术风格：${style.length > 40 ? `${style.slice(0, 40)}…` : style}` : '项目还没选美术风格（在项目设置里选），提示词里不带风格。')}
      </p>
      <div className="sp-ref-buttons">
        <Button size="sm" icon="copy" onClick={() => void copy('design')}>复制设定图提示词</Button>
        <Button size="sm" icon="sparkles" disabled={busy || noCodex} title={noCodex ? '没找到 codex：点「生成设置」看怎么装' : '用本机 codex（ChatGPT 订阅自带的生图）画，不另外花钱'} onClick={() => void draw('design')}>用 codex 按描述画</Button>
        {hasRefs && <Button size="sm" variant="plain" disabled={busy || noCodex} title="照着主图，画一张标准站姿、纯色底的定妆照草稿" onClick={() => void draw('anchor')}>照主图画标准站姿</Button>}
        {hasRefs && <Button size="sm" variant="plain" onClick={() => void copy('anchor')}>复制照主图画的提示词</Button>}
      </div>
      {drawing.length > 0 && <p className="sp-generate-waiting" role="status"><Icon name="sparkles" size={13} />codex 画图中（{drawing.map((j) => j.label).join('、')}）<Button size="sm" variant="plain" onClick={onJobs}>查看任务</Button></p>}
      {waiting && <p className="sp-generate-waiting" role="status"><Icon name="tray.down" size={13} />已复制提示词：两小时内「下载」里新出现的图片会自动放进人物素材。</p>}
    </div>
  )
}
