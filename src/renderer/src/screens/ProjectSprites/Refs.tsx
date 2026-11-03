import { useState, type DragEvent, type MouseEvent } from 'react'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { hud } from '@renderer/app/hud'
import { showError } from '@renderer/screens/Library/shared'
import { LibraryPickerSheet } from '@renderer/screens/ProjectAssets/LibraryPickerSheet'
import { Button, ConfirmSheet, Icon, Segmented, TextArea } from '@renderer/ui'
import { spriteRefUrl, type SpriteRefsResult } from '@shared/api'
import { anchorRef, SPRITE_FACING_LABELS, SPRITE_VIEW_LABELS, viewFacings, type SpriteCharacter, type SpriteFacing, type SpriteOwner, type SpriteRef, type SpriteView } from '@shared/sprites'
import { useSpriteAutosave } from './useSpriteAutosave'

export interface RefsProps {
  owner: SpriteOwner
  ch: SpriteCharacter
  onChange: (character: SpriteCharacter) => void
  onSelectAction: (id: string) => void
  onTemplate: () => void
  /** 做 / 重做某个朝向的定妆照 */
  onAnchor: (facing: SpriteFacing) => void
}

export function Refs(props: RefsProps): React.JSX.Element {
  return <RefsContent key={`${props.owner ?? 'library'}:${props.ch.id}`} {...props} />
}

function RefsContent({ owner, ch, onChange, onSelectAction, onTemplate, onAnchor }: RefsProps): React.JSX.Element {
  const [picker, setPicker] = useState(false)
  const [remove, setRemove] = useState<SpriteRef | null>(null)
  const [busy, setBusy] = useState(false)
  const form = useSpriteAutosave(
    { description: ch.description, promptExtra: ch.promptExtra },
    (draft) => window.gp.sprites.update(owner, ch.id, draft),
    onChange
  )
  const main = ch.refs.find((ref) => ref.id === ch.mainRef)
  const videoCount = ch.actions.filter((action) => action.video).length
  const planned = ch.actions.find((action) => !action.video)
  const groups = ch.groups.map((g) => ({ ...g, actions: ch.actions.filter((a) => a.group === g.id) }))
  const loose = ch.actions.filter((a) => !ch.groups.some((g) => g.id === a.group))
  if (loose.length) groups.push({ id: 'ungrouped', name: '未分组', actions: loose })

  const report = (r: SpriteRefsResult): void => {
    onChange(r.character)
    const parts = [r.added ? `已添加 ${r.added} 张人物图` : '', r.skipped.length ? `跳过 ${r.skipped.length} 个：${r.skipped[0].reason}` : ''].filter(Boolean)
    if (parts.length) hud.show(parts.join('；'))
  }
  const add = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { report(await window.gp.sprites.addRefs(owner, ch.id)) } catch (err) { showError('添加人物图失败', err) } finally { setBusy(false) }
  }
  const setMain = async (refId: string): Promise<void> => {
    if (refId === ch.mainRef) return
    try { onChange(await window.gp.sprites.update(owner, ch.id, { mainRef: refId })) } catch (err) { showError('设置主图失败', err) }
  }
  const copy = async (refId: string, isMain = false): Promise<void> => {
    try {
      const copied = await window.gp.sprites.copyRef(owner, ch.id, refId)
      if (copied) hud.show(isMain ? '已复制主图，可直接粘贴到生成网站' : '已复制图片')
      else hud.show('没有复制成功，请重试')
    } catch (err) { showError('复制图片失败', err) }
  }
  const reveal = async (refId: string): Promise<void> => {
    try { await window.gp.sprites.revealRef(owner, ch.id, refId) } catch (err) { showError('打开访达失败', err) }
  }
  const drag = (e: DragEvent, refId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    void window.gp.sprites.dragRef(owner, ch.id, refId).catch((err) => showError('拖出图片失败', err))
  }
  const menu = async (e: MouseEvent, ref: SpriteRef): Promise<void> => {
    const picked = await showContextMenu(e, [
      ...(ref.facing ? [{ id: 'redo', label: '重做定妆照…' }] : []),
      { id: 'main', label: '设为主图', enabled: ref.id !== ch.mainRef },
      { id: 'copy', label: '复制图片' },
      { id: 'reveal', label: '在访达中显示' },
      menuSeparator,
      { id: 'delete', label: '删除', destructive: true }
    ])
    if (picked === 'redo' && ref.facing) onAnchor(ref.facing)
    if (picked === 'main') void setMain(ref.id)
    if (picked === 'copy') void copy(ref.id)
    if (picked === 'reveal') void reveal(ref.id)
    if (picked === 'delete') setRemove(ref)
  }

  return (
    <section className="sp-refs" aria-label="人物素材">
      <div className="sp-page-heading"><h2>人物素材</h2><span className="sp-note">{ch.refs.length} 张</span></div>
      <div className="sp-refs-top">
        {main ? (
          <div className="sp-ref-main checker" draggable onDragStart={(e) => drag(e, main.id)} title="拖到生成网站或访达">
            <img src={spriteRefUrl(owner, ch.id, main.id)} alt={`${ch.name}的主图`} draggable={false} />
            <span className="sp-ref-main-caption">主图 · 可以拖到生成网站</span>
          </div>
        ) : (
          <div className="sp-ref-empty">
            <Icon name="photo" size={36} strokeWidth={1.3} />
            <p>拖入立绘、三视图等人物图，作为生成动作视频的参考图</p>
            <Button icon="plus" disabled={busy} onClick={() => void add()}>添加人物图…</Button>
            <Button variant="plain" onClick={() => setPicker(true)}>从全局库选…</Button>
          </div>
        )}
        <div className="sp-ref-fields">
          <label className="sp-text-field"><span>人物描述</span><TextArea minRows={3} maxRows={6} maxLength={2000} value={form.draft.description} placeholder="外貌、服装、武器、画风，例如：红发少年剑士，蓝色短披风，右手持长剑，像素风" onChange={(e) => form.edit({ description: e.target.value })} onBlur={form.flush} /></label>
          <div className="sp-text-field"><span id={`sp-ref-view-${ch.id}`}>视角</span><Segmented<SpriteView> value={ch.view} ariaLabel="视角" options={(Object.entries(SPRITE_VIEW_LABELS) as [SpriteView, string][]).map(([value, label]) => ({ value, label }))} onChange={(view) => { void window.gp.sprites.update(owner, ch.id, { view }).then(onChange).catch((err) => showError('保存视角失败', err)) }} /></div>
          <label className="sp-text-field"><span>提示词补充要求</span><TextArea minRows={2} maxRows={5} maxLength={2000} value={form.draft.promptExtra} placeholder="每条提示词末尾都会加上，例如：16-bit 像素游戏风格" onChange={(e) => form.edit({ promptExtra: e.target.value })} onBlur={form.flush} /></label>
          <div className="sp-ref-buttons">
            <Button size="sm" icon="copy" disabled={!main} onClick={() => main && void copy(main.id, true)}>复制主图</Button>
            <Button size="sm" icon="folder" disabled={!main} onClick={() => main && void reveal(main.id)}>在访达中显示</Button>
            <Button size="sm" icon="checklist" onClick={onTemplate}>动作清单模板…</Button>
          </div>
          <div className="sp-autosave-status sp-note" role="status">{form.status}</div>
        </div>
      </div>
      <div className="sp-ref-section-heading"><h3>定妆照</h3><span className="sp-note">每个动作都用定妆照当首帧去生成，角色才不会一个动作一个样</span></div>
      <div className="sp-anchor-row">
        {viewFacings(ch.view).map((facing) => {
          const ref = anchorRef(ch, facing)
          const label = SPRITE_FACING_LABELS[facing]
          return ref ? (
            <button type="button" key={facing} className="sp-anchor-tile" title={`${label}定妆照：拖到生成网站当首帧；点击重做`} draggable onDragStart={(e) => drag(e, ref.id)} onClick={() => onAnchor(facing)} onContextMenu={(e) => void menu(e, ref)}>
              <span className="sp-anchor-thumb"><img src={spriteRefUrl(owner, ch.id, ref.id, 480)} alt={`${label}定妆照`} draggable={false} /></span>
              <span className="sp-ref-name">{label} · {ref.width}×{ref.height}</span>
            </button>
          ) : (
            <button type="button" key={facing} className="sp-anchor-tile empty" disabled={!ch.refs.length} onClick={() => onAnchor(facing)}>
              <span className="sp-anchor-thumb"><Icon name="plus" size={20} /><span>做{label}定妆照…</span></span>
              <span className="sp-ref-name sp-note">{ch.refs.length ? '从人物图抠出来，摆到纯色底上' : '先添加人物图'}</span>
            </button>
          )
        })}
      </div>
      <div className="sp-ref-section-heading"><h3>全部人物图</h3><Button size="sm" variant="plain" onClick={() => setPicker(true)}>从全局库选…</Button></div>
      <div className="sp-ref-grid">
        {ch.refs.filter((ref) => !ref.facing).map((ref) => (
          <button type="button" key={ref.id} className={`sp-ref-tile${ref.id === ch.mainRef ? ' on' : ''}`} aria-pressed={ref.id === ch.mainRef} title={`${ref.name} · ${ref.width}×${ref.height}；点击设为主图，可拖出`} draggable onDragStart={(e) => drag(e, ref.id)} onClick={() => void setMain(ref.id)} onContextMenu={(e) => void menu(e, ref)}>
            <span className="sp-ref-thumb checker"><img src={spriteRefUrl(owner, ch.id, ref.id, 320)} alt={ref.name} loading="lazy" draggable={false} />{ref.id === ch.mainRef && <span className="sp-ref-badge">主图</span>}</span>
            <span className="sp-ref-name">{ref.name}</span>
          </button>
        ))}
        <button type="button" className="sp-ref-add" disabled={busy} onClick={() => void add()}><Icon name="plus" size={22} /><span>{busy ? '添加中…' : '添加人物图…'}</span></button>
      </div>
      <div className="sp-ref-progress">
        <div className="sp-ref-section-heading"><h3>动作 {videoCount}/{ch.actions.length} 已有视频</h3>{planned && <Button size="sm" onClick={() => onSelectAction(planned.id)}>去生成第一个待生成动作</Button>}</div>
        <div className="sp-ref-progress-groups">{groups.map((g) => <div key={g.id}><span>{g.name}</span><span>{g.actions.filter((a) => a.video).length}/{g.actions.length}</span></div>)}</div>
      </div>
      <LibraryPickerSheet open={picker} projectName={ch.name} title="从全局库选人物图" subtitle={`选择加入「${ch.name}」人物素材的图片`} confirmLabel={(n) => `添加 ${n} 张`} onClose={() => setPicker(false)} onAdd={async (ids) => {
        try {
          report(await window.gp.sprites.addRefsFromImages(owner, ch.id, ids.map((id) => ({ scope: 'library' as const, id }))))
          setPicker(false)
          return true
        } catch (err) { showError('添加人物图失败', err); return false }
      }} />
      <ConfirmSheet open={remove !== null} title="删除人物图？" message={`「${remove?.name ?? ''}」会从人物素材里删除。${remove?.id === ch.mainRef && ch.refs.length > 1 ? '删除主图后会改用另一张人物图。' : ''}`} confirmLabel="删除" destructive onCancel={() => setRemove(null)} onConfirm={async () => {
        if (!remove) return
        try { onChange(await window.gp.sprites.deleteRef(owner, ch.id, remove.id)); setRemove(null) } catch (err) { showError('删除人物图失败', err) }
      }} />
    </section>
  )
}
