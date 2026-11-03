import { hud } from '@renderer/app/hud'
import { showError } from '@renderer/screens/Library/shared'
import { Button, Icon, Segmented, Sheet, TextArea } from '@renderer/ui'
import { spriteRefUrl } from '@shared/api'
import { actionFacing, actionLoopKind, anchorRef, buildSpritePrompt, defaultBrief, SPRITE_FACING_LABELS, type SpriteAction, type SpriteActionParams, type SpriteCharacter, type SpriteFacing, type SpriteOwner } from '@shared/sprites'
import { useSpriteAutosave } from './useSpriteAutosave'

export interface GenerateProps {
  owner: SpriteOwner
  ch: SpriteCharacter
  action: SpriteAction
  onChange: (character: SpriteCharacter) => void
  setParams: (patch: Partial<SpriteActionParams>) => void
  onRefs: () => void
  onImport: () => void
  /** 做 / 重做某个朝向的定妆照 */
  onAnchor: (facing: SpriteFacing) => void
}

export function Generate({ owner, ch, action, onChange, setParams, onRefs, onImport, onAnchor }: GenerateProps): React.JSX.Element {
  const facing = actionFacing(ch.view, action.name)
  const anchor = anchorRef(ch, facing)
  const main = anchor ?? ch.refs.find((ref) => ref.id === ch.mainRef)
  const label = SPRITE_FACING_LABELS[facing]
  const group = ch.groups.find((g) => g.id === action.group)?.name ?? '未分组'
  const copyMain = async (): Promise<void> => {
    if (!main) return
    try {
      if (await window.gp.sprites.copyRef(owner, ch.id, main.id)) hud.show(anchor ? '已复制定妆照，粘贴到生成网站的首帧' : '已复制主图，可直接粘贴到生成网站')
      else hud.show('没有复制成功，请重试')
    } catch (err) { showError('复制图片失败', err) }
  }
  const once = buildSpritePrompt(ch, action).lastFrame
  return (
    <section className="sp-generate" aria-label="生成动作视频">
      <header className="sp-generate-heading">
        <div><h2>{action.name}</h2><span className="sp-note">{group} · 待生成</span></div>
        <Segmented value={actionLoopKind(action) ?? 'auto'} ariaLabel="动作类型" options={[{ value: 'loop', label: '循环' }, { value: 'once', label: '单次' }]} onChange={(kind) => setParams({ kind })} />
      </header>
      <div className="sp-generate-body">
        <aside className="sp-generate-ref">
          {main ? <>
            <div className={anchor ? 'sp-generate-thumb anchor' : 'sp-generate-thumb checker'} style={anchor ? { aspectRatio: `${anchor.width} / ${anchor.height}` } : undefined} draggable title={anchor ? '拖到生成网站当首帧' : '拖到生成网站作为参考图'} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); void window.gp.sprites.dragRef(owner, ch.id, main.id).catch((err) => showError('拖出图片失败', err)) }}><img src={spriteRefUrl(owner, ch.id, main.id, 640)} alt={anchor ? `${label}定妆照` : `${ch.name}的主图`} draggable={false} /></div>
            {anchor ? <div className="sp-generate-frames">
              <span><b>首帧</b>{label}定妆照</span>
              <span><b>尾帧</b>{once ? '同一张定妆照' : '不放'}</span>
            </div> : <p className="sp-generate-tip">还没有{label}定妆照。所有动作都从同一张定妆照开始生成，角色才不会一个动作一个样。</p>}
            <Button icon="copy" size="sm" onClick={() => void copyMain()}>{anchor ? '复制定妆照' : '复制主图'}</Button>
            <span className="sp-note">也可以直接拖到生成网站</span>
            {anchor ? <Button size="sm" variant="plain" onClick={() => onAnchor(facing)}>重做定妆照…</Button> : <Button size="sm" variant="primary" onClick={() => onAnchor(facing)}>做{label}定妆照…</Button>}
          </> : <>
            <Icon name="photo" size={32} strokeWidth={1.3} />
            <p>先到人物素材里添加人物图</p>
            <Button size="sm" onClick={onRefs}>添加人物图…</Button>
          </>}
        </aside>
        <PromptEditor key={`${owner ?? 'library'}:${ch.id}:${action.id}`} owner={owner} ch={ch} action={action} onChange={onChange} />
      </div>
      <footer className="sp-generate-import">
        <Button variant="primary" icon="tray.down" onClick={onImport}>导入这个动作的视频…</Button>
        <p className="sp-note">也可以直接把生成好的视频拖进窗口：选中这个动作时，拖入一个文件名对不上的视频会放进这里。</p>
      </footer>
    </section>
  )
}

interface PromptEditorProps {
  owner: SpriteOwner
  ch: SpriteCharacter
  action: SpriteAction
  onChange: (character: SpriteCharacter) => void
}

function PromptEditor({ owner, ch, action, onChange }: PromptEditorProps): React.JSX.Element {
  const form = useSpriteAutosave({ brief: action.brief }, (draft) => window.gp.sprites.updateAction(owner, ch.id, action.id, draft), onChange)
  const prompt = buildSpritePrompt(ch, { ...action, brief: form.draft.brief })
  const copy = async (text: string, label: string): Promise<void> => {
    try { await window.gp.clipboard.copyText(text); hud.show(`已复制${label}`) } catch (err) { showError('复制失败', err) }
  }
  return (
    <div className="sp-prompt-editor">
      <label className="sp-text-field"><span className="sp-field-heading"><span>动作说明</span><span className="sp-note" role="status">{form.status}</span></span><TextArea minRows={2} maxRows={5} maxLength={500} value={form.draft.brief} placeholder={defaultBrief(action.name) || '描述这个动作的起势、过程和收势'} onChange={(e) => form.edit({ brief: e.target.value })} onBlur={form.flush} /></label>
      <div className="sp-text-field"><div className="sp-field-heading"><label htmlFor={`sp-prompt-${action.id}`}>提示词</label><Button size="sm" icon="copy" onClick={() => void copy(prompt.prompt, '提示词')}>复制提示词</Button></div><TextArea id={`sp-prompt-${action.id}`} className="sp-prompt-output" minRows={8} maxRows={14} value={prompt.prompt} readOnly /></div>
      <div className="sp-text-field"><div className="sp-field-heading"><label htmlFor={`sp-negative-${action.id}`}>负面提示词</label><Button size="sm" icon="copy" onClick={() => void copy(prompt.negative, '负面提示词')}>复制</Button></div><TextArea id={`sp-negative-${action.id}`} className="sp-prompt-output" minRows={3} maxRows={5} value={prompt.negative} readOnly /></div>
      <p className="sp-note">{prompt.firstFrame
        ? `在生成网站：首帧放定妆照${prompt.lastFrame ? '，尾帧也放这张' : '，尾帧不放'}；参考图可以再放人物原图；画幅选 ${ch.frameSetup.aspect}；${prompt.seconds}。`
        : `在生成网站：以人物主图作为参考图；${prompt.seconds}。做好定妆照后用它当首帧，角色更一致。`}</p>
    </div>
  )
}

export interface PromptSheetProps extends PromptEditorProps {
  open?: boolean
  onClose: () => void
}

export function PromptSheet({ open = true, onClose, ...props }: PromptSheetProps): React.JSX.Element {
  return <Sheet open={open} onClose={onClose} title={`${props.action.name} · 生成提示词`} subtitle="修改动作说明后会自动保存，提示词可以直接复制" width={720} bodyClassName="sp-prompt-sheet" footer={<><span className="grow" /><Button onClick={onClose}>完成</Button></>}>
    <PromptEditor key={`${props.owner ?? 'library'}:${props.ch.id}:${props.action.id}`} {...props} />
  </Sheet>
}
