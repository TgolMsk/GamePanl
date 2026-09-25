import { useId, useRef, useState } from 'react'
import type { AssetPatch } from '@shared/api'
import {
  ASSET_CATEGORIES,
  type AssetCategory,
  type ID,
  type ImageRef,
  type Note,
  type ProjectAsset
} from '@shared/types'
import { copyImage } from '@renderer/app/clipboard'
import { formatBytes, formatDate, formatSize } from '@renderer/app/format'
import { go } from '@renderer/app/nav'
import { Button, GroupList, GroupRow, Icon, ImageCard, Select, TagEditor, TextField } from '@renderer/ui'
import { openImage, revealImage } from './util'

export interface InspectorProps {
  projectId: ID
  /** 当前选中的图片（没有明确选中时是列表第一张）；null 时显示「没有选中的图片」 */
  asset: ProjectAsset | null
  /** 选中的全部图片（屏幕顺序）；≥ 2 张时显示批量面板 */
  selection: ProjectAsset[]
  /** asset 是不是项目封面 */
  isCover: boolean
  notes: Note[]
  onPatch: (id: ID, patch: AssetPatch) => void
  onView: () => void
  /** 单选：移这一张；多选：移整组（由调用方按当前选中决定） */
  onTrash: () => void
  /** 多选：把选中的全部改成这个分类 */
  onBatchCategory: (category: AssetCategory) => void
  /** 多选：取消选择 */
  onClearSelection: () => void
}

// 预览区 268×180（检查器宽 300 减去左右边距）
const PREVIEW_W = 268
const PREVIEW_H = 180

function fitPreview(w: number, h: number): { width: number; height: number } {
  if (!(w > 0 && h > 0)) return { width: PREVIEW_W, height: PREVIEW_H }
  const r = Math.min(PREVIEW_W / w, PREVIEW_H / h)
  return { width: Math.round(w * r), height: Math.round(h * r) }
}

function usesImage(note: Note, id: ID): boolean {
  return note.blocks.some((b) => b.type === 'image' && b.image.scope === 'project' && b.image.id === id)
}

/** 右侧检查器：大缩略图、名称、信息、分类、标签、被哪些笔记用到、复制 / 打开 / 在访达中显示 / 移到废纸篓；多选时是批量面板 */
export function Inspector({
  projectId,
  asset,
  selection,
  isCover,
  notes,
  onPatch,
  onView,
  onTrash,
  onBatchCategory,
  onClearSelection
}: InspectorProps): React.JSX.Element {
  const catId = useId()

  if (selection.length > 1) {
    return (
      <BatchPanel
        selection={selection}
        catId={catId}
        onCategory={onBatchCategory}
        onTrash={onTrash}
        onClear={onClearSelection}
      />
    )
  }

  if (!asset) {
    return (
      <aside className="inspector as-insp" aria-label="检查器">
        <div className="as-nosel">没有选中的图片</div>
      </aside>
    )
  }

  const ref: ImageRef = { scope: 'project', projectId, id: asset.id }
  const fit = fitPreview(asset.width, asset.height)
  const usedBy = notes.filter((n) => usesImage(n, asset.id))

  return (
    <aside className="inspector as-insp" aria-label="检查器">
      <div className="as-prev">
        <ImageCard
          key={asset.id}
          image={ref}
          name={asset.name}
          caption={false}
          frameHeight={fit.height}
          style={{ width: fit.width }}
          thumb={640}
          viewLabel="查看"
          onView={onView}
          onDoubleClick={onView}
        />
      </div>

      <div className="as-head">
        <NameField key={asset.id} name={asset.name} onSave={(name) => onPatch(asset.id, { name })} />
        {isCover && (
          <div className="as-cover">
            <Icon name="star.fill" size={11} />
            当前封面
          </div>
        )}
      </div>

      <GroupList>
        <GroupRow compact label="尺寸" value={formatSize(asset.width, asset.height)} />
        <GroupRow compact label="格式" value={asset.format} />
        <GroupRow compact label="大小" value={formatBytes(asset.bytes)} />
        <GroupRow compact label="添加时间" value={formatDate(asset.addedAt, { time: true })} />
        <GroupRow compact label="分类" htmlFor={catId}>
          <Select
            id={catId}
            value={asset.category}
            options={ASSET_CATEGORIES}
            onChange={(category) => onPatch(asset.id, { category })}
          />
        </GroupRow>
      </GroupList>

      <section className="gsec">
        <div className="gh">标签</div>
        <TagEditor tags={asset.tags} onChange={(tags) => onPatch(asset.id, { tags })} />
      </section>

      <section className="gsec">
        <div className="gh">被这些笔记用到</div>
        {usedBy.length > 0 ? (
          <div className="group">
            {usedBy.map((n) => (
              <button
                key={n.id}
                type="button"
                className="as-lnk"
                onClick={() => go({ view: 'project', projectId, tab: 'notes' })}
              >
                <span className="ic">
                  <Icon name="bulb" size={15} />
                </span>
                <span className="t">{n.title.trim() || '未命名笔记'}</span>
                <span className="go">
                  <Icon name="chevron.right" size={12} strokeWidth={2.2} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="lbl as-pad">还没有笔记用到这张图</div>
        )}
      </section>

      <div className="as-spacer" />

      <div className="as-acts">
        <Button variant="primary" icon="copy" onClick={() => void copyImage(ref, asset.name)}>
          复制图片
        </Button>
        <div className="as-acts-row">
          <Button onClick={() => void openImage(ref)}>用默认应用打开</Button>
          <Button onClick={() => void revealImage(ref)}>在访达中显示</Button>
        </div>
        <Button onClick={onTrash}>移到废纸篓</Button>
      </div>
    </aside>
  )
}

/** 多选时的批量面板：已选 N 张、统一改分类、移到废纸篓、取消选择 */
function BatchPanel({
  selection,
  catId,
  onCategory,
  onTrash,
  onClear
}: {
  selection: ProjectAsset[]
  catId: string
  onCategory: (category: AssetCategory) => void
  onTrash: () => void
  onClear: () => void
}): React.JSX.Element {
  const n = selection.length
  const first = selection[0].category
  const common: AssetCategory | '' = selection.every((a) => a.category === first) ? first : ''
  return (
    <aside className="inspector as-insp" aria-label="检查器">
      <div className="as-multi">
        <div className="as-multi-n">已选 {n} 张</div>
        <div className="lbl">⌘ 点击加选，⇧ 点击连选，Esc 取消选择</div>
      </div>

      <GroupList>
        <GroupRow compact label="分类" htmlFor={catId}>
          <Select<AssetCategory | ''>
            id={catId}
            value={common}
            options={ASSET_CATEGORIES}
            placeholder="多种"
            onChange={(category) => category && onCategory(category)}
          />
        </GroupRow>
      </GroupList>

      <div className="as-spacer" />

      <div className="as-acts">
        <Button onClick={onTrash}>移到废纸篓 {n} 张</Button>
        <Button onClick={onClear}>取消选择</Button>
      </div>
    </aside>
  )
}

/** 名称：失去焦点或回车时保存，Esc 放弃修改；清空了就恢复原名 */
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
      className="as-ttl"
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
