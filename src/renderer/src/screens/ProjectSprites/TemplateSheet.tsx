import { useState } from 'react'
import { hud } from '@renderer/app/hud'
import { showError } from '@renderer/screens/Library/shared'
import { Button, Icon, Sheet } from '@renderer/ui'
import { SPRITE_TEMPLATES, SPRITE_VIEW_LABELS, type SpriteCharacter, type SpriteOwner } from '@shared/sprites'

export interface TemplateSheetProps {
  open?: boolean
  owner: SpriteOwner
  ch: SpriteCharacter
  onChange: (character: SpriteCharacter) => void
  onClose: () => void
}

export function TemplateSheet(props: TemplateSheetProps): React.JSX.Element | null {
  return props.open === false ? null : <TemplateContent key={`${props.owner ?? 'library'}:${props.ch.id}`} {...props} />
}

function TemplateContent({ owner, ch, onChange, onClose }: TemplateSheetProps): React.JSX.Element {
  const [selected, setSelected] = useState(SPRITE_TEMPLATES[0].id)
  const [busy, setBusy] = useState(false)
  const tpl = SPRITE_TEMPLATES.find((t) => t.id === selected) ?? SPRITE_TEMPLATES[0]
  const names = new Set(ch.actions.map((a) => a.name.toLowerCase()))
  const groups = [...new Set(tpl.actions.map((a) => a.group))]
  const added = tpl.actions.filter((a) => !names.has(a.name.toLowerCase())).length
  const close = (): void => { if (!busy) onClose() }
  const apply = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.gp.sprites.applyTemplate(owner, ch.id, tpl.id)
      onChange(result)
      hud.show(`已加入 ${result.actions.filter((a) => !ch.actions.some((old) => old.id === a.id)).length} 个待生成动作`)
      onClose()
    } catch (err) { showError('加入动作清单失败', err); setBusy(false) }
  }
  return <Sheet open title="动作清单模板" subtitle="按游戏类型列出要做的动作，还没有视频的显示为待生成" width={740} bodyClassName="sp-template-sheet" onClose={close} footer={<><span className="sp-note">新增 {added} 个动作</span><span className="grow" /><Button disabled={busy} onClick={close}>取消</Button><Button variant="primary" disabled={busy} onClick={() => void apply()}>{busy ? '加入中…' : '加入清单'}</Button></>}>
    <div className="sp-template-list" role="group" aria-label="动作清单模板">
      {SPRITE_TEMPLATES.map((t) => <button key={t.id} type="button" className={`sp-template-option${t.id === tpl.id ? ' on' : ''}`} aria-pressed={t.id === tpl.id} disabled={busy} onClick={() => setSelected(t.id)}><span>{t.name}</span><small>{t.hint}</small></button>)}
    </div>
    <div className="sp-template-preview">
      <h3>{tpl.name}</h3>
      {groups.map((group) => <section key={group}><h4>{group}</h4>{tpl.actions.filter((a) => a.group === group).map((a) => <div key={a.name} className="sp-template-action"><span>{a.name}</span>{names.has(a.name.toLowerCase()) ? <span className="sp-note"><Icon name="check" size={12} />已有</span> : <span className="sp-template-new">新增</span>}</div>)}</section>)}
      <p className="sp-template-view sp-note">视角会改成：{SPRITE_VIEW_LABELS[tpl.view]}</p>
    </div>
  </Sheet>
}
