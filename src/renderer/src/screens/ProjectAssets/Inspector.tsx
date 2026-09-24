import { useId, useRef, useState } from 'react'
import type { AssetPatch } from '@shared/api'
import { ASSET_CATEGORIES, type ID, type ImageRef, type Note, type ProjectAsset } from '@shared/types'
import { copyImage } from '@renderer/app/clipboard'
import { formatBytes, formatDate, formatSize } from '@renderer/app/format'
import { hud } from '@renderer/app/hud'
import { go } from '@renderer/app/nav'
import { Button, GroupList, GroupRow, Icon, ImageCard, Select, TagEditor, TextField } from '@renderer/ui'

export interface InspectorProps {
  projectId: ID
  /** 当前选中的图片；null 时显示「没有选中的图片」 */
  asset: ProjectAsset | null
  notes: Note[]
  onPatch: (id: ID, patch: AssetPatch) => void
  onView: () => void
  onTrash: () => void
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

/** 右侧检查器：大缩略图、名称、信息、分类、标签、被哪些笔记用到、复制 / 在访达中显示 / 移到废纸篓 */
export function Inspector({ projectId, asset, notes, onPatch, onView, onTrash }: InspectorProps): React.JSX.Element {
  const catId = useId()

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

  const reveal = async (): Promise<void> => {
    try {
      await window.gp.shell.revealImage(ref)
    } catch {
      hud.show('找不到原文件')
    }
  }

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
          onView={onView}
        />
      </div>

      <NameField key={asset.id} name={asset.name} onSave={(name) => onPatch(asset.id, { name })} />

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
          <Button onClick={() => void reveal()}>在访达中显示</Button>
          <Button onClick={onTrash}>移到废纸篓</Button>
        </div>
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
