import { useState } from 'react'
import { hud } from '@renderer/app/hud'
import { showError } from '@renderer/screens/Library/shared'
import { Button, Select, Sheet, TextArea, TextField } from '@renderer/ui'
import type { ID } from '@shared/types'
import { defaultGroupName, type SpriteCharacter, type SpriteOwner } from '@shared/sprites'

interface PlanSheetProps {
  open?: boolean
  owner: SpriteOwner
  ch: SpriteCharacter
  onChange: (character: SpriteCharacter) => void
  onClose: () => void
}

export function NewGroupSheet(props: PlanSheetProps): React.JSX.Element | null {
  return props.open === false ? null : <NewGroupContent key={`${props.owner ?? 'library'}:${props.ch.id}`} {...props} />
}

function NewGroupContent({ owner, ch, onChange, onClose }: PlanSheetProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const duplicate = ch.groups.some((g) => g.name.toLowerCase() === name.trim().toLowerCase())
  const full = ch.groups.length >= 50
  const valid = !!name.trim() && !duplicate && !full && !busy
  const close = (): void => { if (!busy) onClose() }
  const save = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    try {
      onChange(await window.gp.sprites.update(owner, ch.id, { groups: [...ch.groups, { id: crypto.randomUUID().replace(/-/g, '').slice(0, 16), name: name.trim() }] }))
      hud.show(`已新建分组「${name.trim()}」`)
      onClose()
    } catch (err) { showError('新建分组失败', err); setBusy(false) }
  }
  return <Sheet open title="新建分组" subtitle="把同类动作放在一起，之后可以从动作右键菜单移入" width={420} onClose={close} footer={<><span className="grow" /><Button disabled={busy} onClick={close}>取消</Button><Button variant="primary" disabled={!valid} onClick={() => void save()}>{busy ? '新建中…' : '新建分组'}</Button></>}>
    <TextField autoFocus maxLength={40} aria-label="分组名称" placeholder="例如：移动、攻击、交互" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save() }} />
    {(duplicate || full) && <p className="sp-note">{full ? '每个角色最多 50 个分组。' : '已经有这个分组了，请换个名字。'}</p>}
  </Sheet>
}

interface AddPlannedSheetProps extends PlanSheetProps {
  onSelectAction?: (id: string, character: SpriteCharacter) => void
}

export function AddPlannedSheet(props: AddPlannedSheetProps): React.JSX.Element | null {
  return props.open === false ? null : <AddPlannedContent key={`${props.owner ?? 'library'}:${props.ch.id}`} {...props} />
}

function AddPlannedContent({ owner, ch, onChange, onClose, onSelectAction }: AddPlannedSheetProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [group, setGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const seen = new Set<string>()
  const names = text.split(/[,，\n\r]+/).map((name) => name.trim()).filter((name) => {
    if (!name || seen.has(name.toLowerCase())) return false
    seen.add(name.toLowerCase())
    return true
  })
  const existing = new Set(ch.actions.map((a) => a.name.toLowerCase()))
  const fresh = names.filter((name) => !existing.has(name.toLowerCase()))
  const tooLong = names.some((name) => name.length > 40)
  const tooMany = names.length > 100
  const valid = fresh.length > 0 && !tooLong && !tooMany && !busy
  const close = (): void => { if (!busy) onClose() }
  const save = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    try {
      const result = await window.gp.sprites.addPlanned(owner, ch.id, names, group || null)
      const added = result.actions.filter((a) => !ch.actions.some((old) => old.id === a.id))
      onChange(result)
      if (added[0]) onSelectAction?.(added[0].id, result)
      hud.show(`已加入 ${added.length} 个待生成动作`)
      onClose()
    } catch (err) { showError('添加动作失败', err); setBusy(false) }
  }
  return <Sheet open title="添加待生成动作" subtitle="一次可以列出多个动作，用逗号或换行隔开" width={480} onClose={close} footer={<><span className="sp-note">{fresh.length ? `新增 ${fresh.length} 个动作` : ''}</span><span className="grow" /><Button disabled={busy} onClick={close}>取消</Button><Button variant="primary" disabled={!valid} onClick={() => void save()}>{busy ? '添加中…' : '添加动作'}</Button></>}>
    <div className="sp-plan-fields">
      <label className="sp-text-field"><span>动作名称</span><TextArea autoFocus minRows={4} maxRows={8} placeholder={'idle, walk, run\nattack, hit, death'} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} /></label>
      <div className="sp-field-heading"><label htmlFor="sp-planned-group">分组</label><Select id="sp-planned-group" value={group} disabled={busy} options={[{ value: '', label: '按名字自动' }, ...ch.groups.map((g) => ({ value: g.id, label: g.name }))]} onChange={setGroup} /></div>
      <div className="sp-note">{tooLong ? '每个动作名最多 40 个字。' : tooMany ? '一次最多添加 100 个动作。' : names.length > fresh.length ? `已有的 ${names.length - fresh.length} 个同名动作会跳过。` : '动作名会用作导出的动画名和文件夹名。'}</div>
    </div>
  </Sheet>
}

interface ExtractSheetProps extends PlanSheetProps {
  actionId: ID
  onSelectAction: (id: string, character: SpriteCharacter) => void
}

/** 从同一个视频再抽一个动作：一个视频里有好几个动作时，每个动作各选一段 */
export function ExtractSheet(props: ExtractSheetProps): React.JSX.Element | null {
  return props.open === false ? null : <ExtractContent key={`${props.owner ?? 'library'}:${props.ch.id}:${props.actionId}`} {...props} />
}

function ExtractContent({ owner, ch, actionId, onChange, onClose, onSelectAction }: ExtractSheetProps): React.JSX.Element | null {
  const source = ch.actions.find((a) => a.id === actionId)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('same')
  const [busy, setBusy] = useState(false)
  if (!source) return null
  const trimmed = name.trim()
  const duplicate = ch.actions.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())
  const valid = !!trimmed && trimmed.length <= 40 && !duplicate && !busy
  const close = (): void => { if (!busy) onClose() }
  const save = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    try {
      const g = group === 'same' ? undefined : group === 'none' ? null : group
      const result = await window.gp.sprites.extractAction(owner, ch.id, source.id, trimmed, g)
      const added = result.actions.find((a) => !ch.actions.some((old) => old.id === a.id))
      onChange(result)
      if (added) onSelectAction(added.id, result)
      hud.show(`已建「${trimmed}」：在下方时间轴拖动片段起止，选出这个动作那一段`)
      onClose()
    } catch (err) { showError('没能建动作', err); setBusy(false) }
  }
  const sourceGroup = ch.groups.find((g) => g.id === source.group)?.name ?? '未分组'
  return <Sheet open title="从这个视频再抽一个动作" subtitle={`和「${source.name}」用同一个视频，各自在时间轴上选自己那一段`} width={460} onClose={close} footer={<><span className="grow" /><Button disabled={busy} onClick={close}>取消</Button><Button variant="primary" disabled={!valid} onClick={() => void save()}>{busy ? '新建中…' : '新建动作'}</Button></>}>
    <div className="sp-plan-fields">
      <label className="sp-text-field"><span>动作名称</span><TextField autoFocus maxLength={40} placeholder="例如：attack2、jump、受击" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save() }} /></label>
      <div className="sp-field-heading"><label htmlFor="sp-extract-group">分组</label><Select id="sp-extract-group" value={group} disabled={busy} options={[{ value: 'same', label: `和原动作一样（${sourceGroup}）` }, { value: 'auto', label: trimmed ? `按名字自动（${defaultGroupName(trimmed)}）` : '按名字自动' }, ...ch.groups.map((g) => ({ value: g.id, label: g.name })), { value: 'none', label: '未分组' }]} onChange={setGroup} /></div>
      <div className="sp-note">{duplicate ? '已经有这个名字的动作了，请换一个。' : '抠图参数照搬原动作；片段、删帧、循环 / 单次各自设置。导出时可以把每个动作单独存成 2D 资产。'}</div>
    </div>
  </Sheet>
}
