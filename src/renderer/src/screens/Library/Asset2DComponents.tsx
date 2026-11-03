import { useId, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useLibAssets2D } from '@renderer/app/data'
import { formatBytes, formatDate } from '@renderer/app/format'
import { hud } from '@renderer/app/hud'
import { go } from '@renderer/app/nav'
import { rememberSpriteSelection } from '@renderer/screens/ProjectSprites/selection'
import {
  Button,
  cx,
  GroupList,
  GroupRow,
  Icon,
  SearchField,
  Segmented,
  Select,
  Sheet,
  Tag,
  TagEditor,
  TextField
} from '@renderer/ui'
import { asset2dFileUrl, type LibAsset2DPatch } from '@shared/api'
import type { SpriteOwner } from '@shared/sprites'
import { ASSET2D_CATEGORIES, type Asset2DCategory, type ID, type LibAsset2D, type MenuItemSpec } from '@shared/types'
import { Asset2DFrameThumb, Asset2DPlayer, asset2dCoverFrame, asset2dPixelated, asset2dPreviewUrl, fpsText } from './Asset2DPlayer'
import { matches, showError } from './shared'
import './assets2d.css'

export type Asset2DFilter = 'all' | Asset2DCategory
export const ASSET2D_FILTERS = [
  { value: 'all' as const, label: '全部' },
  ...ASSET2D_CATEGORIES.map((c) => ({ value: c, label: c }))
]

/** 窗口窄时换成系统弹出菜单，分类和搜索仍然都能用 */
export function Asset2DCategoryFilter({
  value,
  onChange
}: {
  value: Asset2DFilter
  onChange: (value: Asset2DFilter) => void
}): React.JSX.Element {
  return (
    <div className="a2d-categories">
      <Segmented ariaLabel="按分类显示" value={value} onChange={onChange} options={ASSET2D_FILTERS} />
      <Select
        className="a2d-categories-compact"
        ariaLabel="按分类显示"
        value={value}
        onChange={onChange}
        options={ASSET2D_FILTERS}
      />
    </div>
  )
}
export const asset2dFields = (a: LibAsset2D): string[] => [
  a.name,
  a.id,
  a.category,
  ...a.tags,
  ...a.formats,
  ...a.animations.map((x) => x.name)
]
const frameSize = (a: LibAsset2D): string => (a.frameSize ? `${a.frameSize[0]}×${a.frameSize[1]}` : '—')
const cardMeta = (a: LibAsset2D): string =>
  a.animations.length > 0
    ? `${a.animations.length} 个动画${a.frameSize ? ` · ${frameSize(a)}` : ''}`
    : `${a.imageCount} 张图`

export async function revealAsset2D(asset: LibAsset2D): Promise<void> {
  try {
    await window.gp.shell.revealAsset2D(asset.id)
  } catch {
    hud.show('找不到资产文件夹')
  }
}

export async function copyAsset2DTo(asset: LibAsset2D): Promise<void> {
  try {
    const dest = await window.gp.library.copyAsset2DTo(asset.id)
    if (dest) hud.show(`已拷贝到 …/${dest.split('/').slice(-2).join('/')}`, { ok: true })
  } catch (err) {
    showError('拷贝失败', err)
  }
}

/** 原生拖出整个资产文件夹 */
export function dragAsset2DOut(e: DragEvent, asset: LibAsset2D): void {
  e.preventDefault()
  void window.gp.shell.dragAsset2D(asset.id).catch(() => undefined)
}

export function openAsset2DSprite(asset: LibAsset2D): void {
  if (!asset.fromSprite) return
  const owner = asset.fromSprite.owner
  rememberSpriteSelection(owner, asset.fromSprite.characterId, null)
  go(owner === null ? { view: 'library', tab: 'sprites' } : { view: 'project', projectId: owner, tab: 'sprites' })
}

export async function makeAsset2DSprite(asset: LibAsset2D, owner: SpriteOwner = null): Promise<void> {
  try {
    const character = await window.gp.sprites.fromAsset2D(owner, asset.id)
    rememberSpriteSelection(owner, character.id, 'refs')
    go(owner === null ? { view: 'library', tab: 'sprites' } : { view: 'project', projectId: owner, tab: 'sprites' })
    hud.show(`已建角色「${character.name}」，人物图在人物素材里`, { ok: true })
  } catch (err) {
    showError('没能创建角色', err)
  }
}

export function asset2dMenuItems(single: boolean, asset: LibAsset2D): MenuItemSpec[] {
  return [
    { id: 'a2d:view', label: '预览…', enabled: single },
    { id: 'a2d:reveal', label: '在访达中显示', enabled: single },
    { id: 'a2d:copyto', label: '拷贝文件夹到…', enabled: single },
    asset.fromSprite
      ? { id: 'a2d:sprite', label: '打开序列帧', enabled: single }
      : { id: 'a2d:make-sprite', label: '做成序列帧角色', enabled: single }
  ]
}

export function handleAsset2DMenu(picked: string, asset: LibAsset2D, openView: () => void, owner: SpriteOwner = null): boolean {
  if (picked === 'a2d:view') openView()
  else if (picked === 'a2d:reveal') void revealAsset2D(asset)
  else if (picked === 'a2d:copyto') void copyAsset2DTo(asset)
  else if (picked === 'a2d:sprite') openAsset2DSprite(asset)
  else if (picked === 'a2d:make-sprite') void makeAsset2DSprite(asset, owner)
  else return false
  return true
}

function Preview({ asset, thumb = 640 }: { asset: LibAsset2D; thumb?: number }): React.JSX.Element {
  const src = asset2dPreviewUrl(asset, thumb)
  const [broken, setBroken] = useState<string | null>(null)
  const cover = asset2dCoverFrame(asset)
  if (cover && src !== broken) return <Asset2DFrameThumb asset={asset} frame={cover} onError={() => setBroken(src)} />
  return !src || src === broken ? (
    <span className="ph">
      <Icon name="grid" size={30} strokeWidth={1.2} />
    </span>
  ) : (
    <img
      className={asset2dPixelated(asset) ? 'a2d-pixel' : undefined}
      src={src}
      alt={asset.name}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setBroken(src)}
    />
  )
}

export function Asset2DCard({
  asset,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onView
}: {
  asset: LibAsset2D
  selected?: boolean
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void
  onView?: () => void
}): React.JSX.Element {
  return (
    <div className={cx('card', 'a2d-card', selected && 'sel')} data-id={asset.id} onContextMenu={onContextMenu}>
      <button
        type="button"
        className="hit"
        aria-label={asset.name}
        title="双击或按空格预览 · 可以拖到访达或游戏项目里"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        draggable
        onDragStart={(e) => dragAsset2DOut(e, asset)}
      >
        <span className="frame a2d-frame checker" style={{ aspectRatio: '4 / 3' }}>
          <Preview asset={asset} />
          {asset.animations.length > 0 && (
            <span className="a2d-badge">
              <Icon name="play" size={9} strokeWidth={2.4} />
              {asset.animations.length}
            </span>
          )}
        </span>
        <span className="cap">{asset.name}</span>
        <span className="meta">{cardMeta(asset)}</span>
      </button>
      {onView && (
        <button type="button" className="eye" aria-label="预览 2D 资产" title="预览（空格）" onClick={onView}>
          <Icon name="eye" size={15} />
        </button>
      )}
    </div>
  )
}

interface InspectorProps {
  owner?: SpriteOwner
  asset: LibAsset2D | null
  selection: LibAsset2D[]
  editable: boolean
  onPatch?: (id: ID, patch: LibAsset2DPatch) => void
  onRemove: () => void
  removeLabel: string
  onBatchCategory?: (category: Asset2DCategory) => void
  onClearSelection: () => void
  extraRows?: ReactNode
  emptyText: string
}

/** 全局库可以修改名称、分类和标签；项目只引用，信息在这里只读 */
export function Asset2DInspector({
  owner = null,
  asset,
  selection,
  editable,
  onPatch,
  onRemove,
  removeLabel,
  onBatchCategory,
  onClearSelection,
  extraRows,
  emptyText
}: InspectorProps): React.JSX.Element {
  const catId = useId()
  const [makingSprite, setMakingSprite] = useState(false)
  if (selection.length > 1) {
    const first = selection[0].category
    const common: Asset2DCategory | '' = selection.every((a) => a.category === first) ? first : ''
    return (
      <aside className="inspector a2d-inspector" aria-label="检查器">
        <div className="a2d-multi">
          <div className="a2d-title">已选 {selection.length} 个资产</div>
          <div className="lbl">⌘ 点击加选，⇧ 点击连选，Esc 取消选择</div>
        </div>
        {editable && onBatchCategory && (
          <GroupList>
            <GroupRow compact label="分类" htmlFor={catId}>
              <Select<Asset2DCategory | ''>
                id={catId}
                value={common}
                options={ASSET2D_CATEGORIES}
                placeholder="多种"
                onChange={(category) => category && onBatchCategory(category)}
              />
            </GroupRow>
          </GroupList>
        )}
        <div className="a2d-spacer" />
        <div className="a2d-actions">
          <Button onClick={onRemove}>
            {removeLabel} {selection.length} 个
          </Button>
          <Button onClick={onClearSelection}>取消选择</Button>
        </div>
      </aside>
    )
  }
  if (!asset)
    return (
      <aside className="inspector a2d-inspector" aria-label="检查器">
        <div className="a2d-none">{emptyText}</div>
      </aside>
    )
  const a = asset
  const animationGroups = new Map<string, LibAsset2D['animations']>()
  for (const animation of a.animations) {
    const group = animation.group?.trim() ?? ''
    const list = animationGroups.get(group) ?? []
    list.push(animation)
    animationGroups.set(group, list)
  }
  const hasAnimationGroups = [...animationGroups.keys()].some(Boolean)
  const makeSprite = async (): Promise<void> => {
    if (makingSprite) return
    setMakingSprite(true)
    try {
      await makeAsset2DSprite(a, owner)
    } finally {
      setMakingSprite(false)
    }
  }
  return (
    <aside className="inspector a2d-inspector" aria-label="检查器">
      <Asset2DPlayer asset={a} />
      <div className="a2d-head">
        {editable && onPatch ? (
          <NameField key={a.id} name={a.name} onSave={(name) => onPatch(a.id, { name })} />
        ) : (
          <div className="a2d-title">{a.name}</div>
        )}
        {a.id !== a.name && (
          <div className="a2d-sub" title="拖出、拷贝出去的文件夹叫这个名字">
            文件夹：{a.id}
          </div>
        )}
      </div>
      <GroupList>
        <GroupRow compact label="分类" htmlFor={editable ? catId : undefined} value={editable ? undefined : a.category}>
          {editable && onPatch ? (
            <Select
              id={catId}
              value={a.category}
              options={ASSET2D_CATEGORIES}
              onChange={(category) => onPatch(a.id, { category })}
            />
          ) : undefined}
        </GroupRow>
        <GroupRow compact label="帧尺寸" value={frameSize(a)} />
        <GroupRow compact label="格式" value={a.formats.join(' · ') || '—'} />
        <GroupRow compact label="文件" value={`${a.imageCount} 张图 · ${a.fileCount} 个文件`} />
        <GroupRow compact label="大小" value={formatBytes(a.bytes)} />
        <GroupRow compact label="加入时间" value={formatDate(a.addedAt, { time: true })} />
        {extraRows}
      </GroupList>
      <section className="gsec">
        <div className="gh">
          动画 <span className="a2d-count">{a.animations.length || ''}</span>
        </div>
        {a.animations.length > 0 ? (
          <div className="a2d-animation-groups">
            {[...animationGroups].map(([group, animations]) => (
              <div key={group}>
                {hasAnimationGroups && <div className="a2d-animation-group-name">{group || '未分组'}</div>}
                <div className="group">
                  {animations.map((animation, i) => (
                    <div className="a2d-animation-row" key={`${i}:${animation.name}`}>
                      <span title={animation.name}>{animation.name}</span>
                      <span>
                        {animation.frames.length} 帧 · {fpsText(animation.fps)} · {animation.loop ? '循环' : '单次'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="lbl a2d-pad">静态资产，没有动画</div>
        )}
      </section>
      {!!a.references?.length && (
        <section className="gsec">
          <div className="gh">人物素材</div>
          <div className="a2d-references">
            {a.references.map((file) => (
              <img
                key={file}
                className="checker"
                src={`${asset2dFileUrl(a.id, file)}?thumb=160&v=${encodeURIComponent(a.updatedAt)}`}
                alt={file.split('/').pop() ?? file}
                title={file.split('/').pop() ?? file}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ))}
          </div>
        </section>
      )}
      <section className="gsec">
        <div className="gh">标签</div>
        {editable && onPatch ? (
          <TagEditor tags={a.tags} onChange={(tags) => onPatch(a.id, { tags })} />
        ) : a.tags.length > 0 ? (
          <div className="tags a2d-pad">
            {a.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        ) : (
          <div className="lbl a2d-pad">没有标签</div>
        )}
      </section>
      <section className="gsec">
        <div className="gh">来源</div>
        <div className="a2d-source">
          {a.fromSprite && <div>序列帧导出</div>}
          {a.source && <div>{a.source}</div>}
          {a.importedFrom && (
            <div className="a2d-path" title={a.importedFrom}>
              {a.importedFrom}
            </div>
          )}
          {!a.hasAssetJson && <div>没有 asset.json，信息从图片和图集读出</div>}
          {a.fromSprite ? (
            <Button icon="film" onClick={() => openAsset2DSprite(a)}>
              打开序列帧
            </Button>
          ) : (
            <Button icon="film" onClick={() => void makeSprite()} disabled={makingSprite}>
              {makingSprite ? '正在创建角色…' : '做成序列帧角色'}
            </Button>
          )}
        </div>
      </section>
      <div className="a2d-spacer" />
      <div className="a2d-actions">
        <Button icon="folder" onClick={() => void copyAsset2DTo(a)}>
          拷贝文件夹到…
        </Button>
        <div className="a2d-actions-row">
          <Button onClick={() => void revealAsset2D(a)}>在访达中显示</Button>
          <Button onClick={onRemove}>{removeLabel}</Button>
        </div>
      </div>
    </aside>
  )
}

function NameField({ name, onSave }: { name: string; onSave: (name: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const commit = (): void => {
    const v = draft?.trim() ?? ''
    const discard = cancelled.current
    cancelled.current = false
    setDraft(null)
    if (!discard && v && v !== name) onSave(v)
  }
  return (
    <TextField
      className="a2d-name"
      value={draft ?? name}
      placeholder="未命名"
      aria-label="名称"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function Asset2DViewerSheet({
  asset,
  onClose
}: {
  asset: LibAsset2D | null
  onClose: () => void
}): React.JSX.Element | null {
  return asset ? (
    <Sheet
      open
      onClose={onClose}
      title={asset.name}
      subtitle={`${asset.category} · ${cardMeta(asset)}`}
      width={800}
      height={620}
      bodyClassName="a2d-viewer"
      footer={
        <>
          <Button onClick={() => void revealAsset2D(asset)}>在访达中显示</Button>
          <Button onClick={() => void copyAsset2DTo(asset)}>拷贝文件夹到…</Button>
          <span className="grow" />
          <Button onClick={onClose}>关闭</Button>
        </>
      }
    >
      <Asset2DPlayer asset={asset} />
    </Sheet>
  ) : null
}

interface PickerProps {
  open: boolean
  projectName: string
  existing: ReadonlySet<ID>
  onClose: () => void
  onAdd: (ids: ID[]) => Promise<boolean>
}

export function Asset2DPickerSheet(props: PickerProps): React.JSX.Element | null {
  return props.open ? <Picker {...props} /> : null
}

function Picker({ projectName, existing, onClose, onAdd }: PickerProps): React.JSX.Element {
  const assets = useLibAssets2D()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<ID[]>([])
  const [busy, setBusy] = useState(false)
  const list = assets.data.filter((a) => matches(q, asset2dFields(a)))
  const n = picked.length
  const add = async (): Promise<void> => {
    if (n === 0 || busy) return
    setBusy(true)
    try {
      await onAdd(picked)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="从全局库添加 2D 资产"
      subtitle={`选择要加入「${projectName}」的资产，只记引用，不复制文件`}
      width={800}
      height={633}
      accessory={<SearchField value={q} onChange={setQ} placeholder="搜索 2D 资产" autoFocus />}
      closeButton={false}
      bodyStyle={{ padding: '16px 20px 20px' }}
      footer={
        <>
          <span className="lbl">{n ? `已选 ${n} 个` : '点按资产来选择，可多选'}</span>
          <span className="grow" />
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" disabled={n === 0 || busy} onClick={() => void add()}>
            {busy ? '正在添加…' : n ? `添加 ${n} 个` : '添加'}
          </Button>
        </>
      }
    >
      {assets.loading ? null : assets.error && assets.data.length === 0 ? (
        <div className="a2d-picker-empty">
          {assets.error}
          <Button onClick={() => void assets.refresh()}>重试</Button>
        </div>
      ) : assets.data.length === 0 ? (
        <div className="a2d-picker-empty">全局库里还没有 2D 资产</div>
      ) : list.length === 0 ? (
        <div className="a2d-picker-empty">没有找到「{q.trim()}」</div>
      ) : (
        <div className="a2d-pick-grid">
          {list.map((a) => {
            const added = existing.has(a.id)
            const on = added || picked.includes(a.id)
            return (
              <button
                key={a.id}
                type="button"
                className={cx('a2d-pick', on && 'on', added && 'added')}
                aria-pressed={on}
                disabled={added || busy}
                onClick={() =>
                  setPicked((cur) => (cur.includes(a.id) ? cur.filter((id) => id !== a.id) : [...cur, a.id]))
                }
              >
                <span className="frame a2d-frame checker">
                  <Preview asset={a} thumb={320} />
                  <span className="a2d-tick">{on && <Icon name="check" size={11} strokeWidth={3} />}</span>
                </span>
                <span className="cap">{a.name}</span>
                <span className="meta">{added ? '已在项目里' : cardMeta(a)}</span>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
