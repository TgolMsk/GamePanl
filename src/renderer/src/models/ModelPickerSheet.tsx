import { useState } from 'react'
import { useLibModels } from '@renderer/app/data'
import { matches } from '@renderer/screens/Library/shared'
import { Button, cx, Icon, SearchField, Sheet } from '@renderer/ui'
import { modelPreviewUrl } from '@shared/api'
import type { ID, LibModel } from '@shared/types'
import { cardMeta } from './format'
import { hasPreview } from './ModelCard'

export interface ModelPickerSheetProps {
  open: boolean
  projectName: string
  /** 已经在项目里的（显示为已添加，不能再选） */
  existing: ReadonlySet<ID>
  onClose: () => void
  /** 点「添加」：返回 true 表示已经处理完（sheet 由调用方关掉） */
  onAdd: (modelIds: ID[]) => Promise<boolean>
}

/** 从全局库添加模型：模型网格，可多选，「添加 N 个」 */
export function ModelPickerSheet(props: ModelPickerSheetProps): React.JSX.Element | null {
  // 每次打开都是新的选择和搜索
  return props.open ? <Picker {...props} /> : null
}

const fieldsOf = (m: LibModel): string[] => [m.name, m.id, m.category, ...m.tags]

function Picker({ projectName, existing, onClose, onAdd }: ModelPickerSheetProps): React.JSX.Element {
  const models = useLibModels()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<ID[]>([])
  const [busy, setBusy] = useState(false)

  const list = models.data.filter((m) => matches(q, fieldsOf(m)))
  const n = picked.length

  const toggle = (id: ID): void =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const add = async (): Promise<void> => {
    if (n === 0 || busy) return
    setBusy(true)
    const done = await onAdd(picked)
    if (!done) setBusy(false)
  }

  let body: React.ReactNode
  if (models.loading) body = null
  else if (models.data.length === 0) body = <div className="as-none">全局库里还没有 3D 模型</div>
  else if (list.length === 0) body = <div className="as-none">没有找到「{q.trim()}」</div>
  else
    body = (
      <div className="mdl-pick-grid">
        {list.map((m) => {
          const added = existing.has(m.id)
          const on = added || picked.includes(m.id)
          return (
            <button
              key={m.id}
              type="button"
              className={cx('mdl-pk', on && 'on', added && 'added')}
              aria-pressed={on}
              disabled={added}
              onClick={() => toggle(m.id)}
            >
              <span className="frame">
                {hasPreview(m) ? (
                  <img src={modelPreviewUrl(m, 320)} alt={m.name} loading="lazy" decoding="async" draggable={false} />
                ) : (
                  <span className="ph">
                    <Icon name="cube" size={22} strokeWidth={1.3} />
                  </span>
                )}
                <span className="as-tick">{on && <Icon name="check" size={11} strokeWidth={3} />}</span>
              </span>
              <span className="cap">{m.name}</span>
              <span className="meta">{added ? '已在项目里' : cardMeta(m)}</span>
            </button>
          )
        })}
      </div>
    )

  return (
    <Sheet
      open
      onClose={onClose}
      title="从全局库添加 3D 模型"
      subtitle={`选择要加入「${projectName}」的模型，只记引用，不复制文件`}
      width={800}
      height={633}
      accessory={<SearchField value={q} onChange={setQ} placeholder="搜索 3D 模型" autoFocus />}
      closeButton={false}
      bodyStyle={{ padding: '16px 20px 20px' }}
      footer={
        <>
          <span className="lbl">{n > 0 ? `已选 ${n} 个` : '点按模型来选择，可多选'}</span>
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={n === 0} onClick={() => void add()}>
            {n > 0 ? `添加 ${n} 个` : '添加'}
          </Button>
        </>
      }
    >
      {body}
    </Sheet>
  )
}
