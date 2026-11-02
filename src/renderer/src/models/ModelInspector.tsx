import '@renderer/screens/ProjectAssets/assets.css'
import './models.css'
import { useId, useRef, useState, type ReactNode } from 'react'
import { formatBytes, formatDate } from '@renderer/app/format'
import { Button, GroupList, GroupRow, Icon, Select, Tag, TagEditor, TextField } from '@renderer/ui'
import { modelPreviewUrl, type LibModelPatch } from '@shared/api'
import { MODEL_CATEGORIES, type LibModel, type ModelCategory } from '@shared/types'
import { copyForAI, copyModelPath, copyModelTo, dragModelOut, revealModel } from './actions'
import { formatCount, formatDims, formatSeconds } from './format'
import { hasPreview } from './ModelCard'

export interface ModelInspectorProps {
  /** 当前选中的模型（没有明确选中时是列表第一个）；null 时显示 emptyText */
  model: LibModel | null
  /** 选中的全部模型；≥ 2 个时显示批量面板 */
  selection: LibModel[]
  /** 全局库里可以改名称、分类、标签；项目里只读 */
  editable: boolean
  onPatch?: (id: string, patch: LibModelPatch) => void
  /** 打开 3D 预览；给了 clip 就播放这个动作 */
  onView: (clip?: string) => void
  /** 全局库：移到废纸篓；项目：从项目移除（作用对象由调用方按当前选中决定） */
  onRemove: () => void
  removeLabel: string
  /** 多选时统一改分类（只在 editable 时有） */
  onBatchCategory?: (category: ModelCategory) => void
  onClearSelection: () => void
  /** 追加在信息分组末尾的行，如「用于项目」 */
  extraRows?: ReactNode
  emptyText: string
}

/** 右侧检查器：预览图、名称、尺寸 / 面数 / 骨骼 / 版本、动作表、挂点、标签、来源，以及取用按钮；多选时是批量面板 */
export function ModelInspector(props: ModelInspectorProps): React.JSX.Element {
  const { model, selection, editable, onPatch, onView, onRemove, removeLabel, extraRows, emptyText } = props
  const catId = useId()

  if (selection.length > 1) return <BatchPanel {...props} catId={catId} />
  if (!model) {
    return (
      <aside className="inspector as-insp" aria-label="检查器">
        <div className="as-nosel">{emptyText}</div>
      </aside>
    )
  }

  const m = model
  return (
    <aside className="inspector as-insp mdl-insp" aria-label="检查器">
      <button
        type="button"
        className="mdl-prev"
        title="3D 预览（空格）· 可以拖到访达或游戏项目里"
        onClick={() => onView()}
        draggable
        onDragStart={(e) => dragModelOut(e, m)}
      >
        <InspectorPreview model={m} />
        <span className="mdl-prev-btn">
          <Icon name="cube" size={13} strokeWidth={2} />
          3D 预览
        </span>
      </button>

      <div className="as-head">
        {editable && onPatch ? (
          <NameField key={m.id} name={m.name} onSave={(name) => onPatch(m.id, { name })} />
        ) : (
          <div className="mdl-ttl">{m.name}</div>
        )}
        <div className="mdl-sub">
          {m.id}
          {m.version && ` · v${m.version}`} · {m.format}
        </div>
      </div>

      <GroupList>
        <GroupRow compact label="分类" htmlFor={editable ? catId : undefined} value={editable ? undefined : m.category}>
          {editable && onPatch ? (
            <Select id={catId} value={m.category} options={MODEL_CATEGORIES} onChange={(category) => onPatch(m.id, { category })} />
          ) : undefined}
        </GroupRow>
        <GroupRow compact label="尺寸" value={formatDims(m.size)} />
        <GroupRow compact label="面数" value={formatCount(m.triangles)} />
        <GroupRow compact label="顶点" value={formatCount(m.vertices)} />
        <GroupRow compact label="骨骼" value={m.bones > 0 ? m.bones : '无'} />
        <GroupRow compact label="版本" value={m.version || '—'} />
        <GroupRow compact label="大小" value={`${formatBytes(m.bytes)} · ${m.fileCount} 个文件`} />
        <GroupRow compact label="添加时间" value={formatDate(m.addedAt, { time: true })} />
        {extraRows}
      </GroupList>

      <section className="gsec">
        <div className="gh">
          动作 <span className="mdl-n">{m.animations.length > 0 ? m.animations.length : ''}</span>
        </div>
        {m.animations.length > 0 ? (
          <div className="group">
            {m.animations.map((a) => (
              <button
                key={a.clip + a.name}
                type="button"
                className="as-lnk mdl-anim"
                title={a.clip !== a.name ? `文件内名 ${a.clip} · 点按播放` : '点按播放'}
                onClick={() => onView(a.clip)}
              >
                <span className="ic">
                  <Icon name="play" size={11} strokeWidth={2.2} />
                </span>
                <span className="t">{a.name}</span>
                {a.loop && <span className="mdl-loop">循环</span>}
                <span className="go mdl-sec">{a.seconds > 0 ? formatSeconds(a.seconds) : ''}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="lbl as-pad">{m.bones > 0 ? '有骨骼，没有动作' : '静态模型，没有动作'}</div>
        )}
      </section>

      {m.sockets.length > 0 && (
        <section className="gsec">
          <div className="gh">挂点</div>
          <div className="tags as-pad">
            {m.sockets.map((s) => (
              <Tag key={s} size="xs">
                {s}
              </Tag>
            ))}
          </div>
        </section>
      )}

      <section className="gsec">
        <div className="gh">标签</div>
        {editable && onPatch ? (
          <TagEditor tags={m.tags} onChange={(tags) => onPatch(m.id, { tags })} />
        ) : m.tags.length > 0 ? (
          <div className="tags as-pad">
            {m.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        ) : (
          <div className="lbl as-pad">没有标签</div>
        )}
      </section>

      <section className="gsec">
        <div className="gh">来源</div>
        <div className="mdl-src">
          {m.source && <div>{m.source}</div>}
          <div className="path" title={m.importedFrom}>
            {m.importedFrom}
          </div>
          {!m.hasAssetJson && <div>没有 asset.json，信息从模型文件读出</div>}
        </div>
      </section>

      <div className="as-spacer" />

      <div className="as-acts">
        <Button variant="primary" icon="copy" onClick={() => void copyForAI(m)}>
          复制给 AI
        </Button>
        <div className="as-acts-row">
          <Button onClick={() => void revealModel(m)}>在访达中显示</Button>
          <Button onClick={() => void copyModelTo(m)}>拷贝文件夹到…</Button>
        </div>
        <div className="as-acts-row">
          <Button onClick={() => void copyModelPath(m)}>复制路径</Button>
          <Button onClick={onRemove}>{removeLabel}</Button>
        </div>
      </div>
    </aside>
  )
}

function InspectorPreview({ model }: { model: LibModel }): React.JSX.Element {
  const src = modelPreviewUrl(model, 640)
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  if (!hasPreview(model) || brokenSrc === src) {
    return (
      <span className="ph">
        <Icon name="cube" size={40} strokeWidth={1.1} />
      </span>
    )
  }
  return <img src={src} alt={model.name} draggable={false} onError={() => setBrokenSrc(src)} />
}

/** 多选时的批量面板：已选 N 个、统一改分类、移到废纸篓 / 从项目移除、取消选择 */
function BatchPanel({
  selection,
  editable,
  onBatchCategory,
  onRemove,
  removeLabel,
  onClearSelection,
  catId
}: ModelInspectorProps & { catId: string }): React.JSX.Element {
  const n = selection.length
  const first = selection[0].category
  const common: ModelCategory | '' = selection.every((m) => m.category === first) ? first : ''
  return (
    <aside className="inspector as-insp" aria-label="检查器">
      <div className="as-multi">
        <div className="as-multi-n">已选 {n} 个模型</div>
        <div className="lbl">⌘ 点击加选，⇧ 点击连选，Esc 取消选择</div>
      </div>
      {editable && onBatchCategory && (
        <GroupList>
          <GroupRow compact label="分类" htmlFor={catId}>
            <Select<ModelCategory | ''>
              id={catId}
              value={common}
              options={MODEL_CATEGORIES}
              placeholder="多种"
              onChange={(category) => category && onBatchCategory(category)}
            />
          </GroupRow>
        </GroupList>
      )}
      <div className="as-spacer" />
      <div className="as-acts">
        <Button onClick={onRemove}>
          {removeLabel} {n} 个
        </Button>
        <Button onClick={onClearSelection}>取消选择</Button>
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
