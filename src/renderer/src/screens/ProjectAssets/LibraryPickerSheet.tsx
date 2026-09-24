import { useState } from 'react'
import { imageUrl } from '@shared/api'
import type { ID, LibImage } from '@shared/types'
import { useLibImages } from '@renderer/app/data'
import { formatSize } from '@renderer/app/format'
import { Button, Icon, SearchField, Sheet, cx } from '@renderer/ui'

export interface LibraryPickerSheetProps {
  open: boolean
  projectName: string
  onClose: () => void
  /** 点「添加」：返回 true 表示已经处理完（sheet 由调用方关掉） */
  onAdd: (libraryIds: ID[]) => Promise<boolean>
}

/** 从全局库添加：全局库图片网格，可多选，「添加 N 张」 */
export function LibraryPickerSheet(props: LibraryPickerSheetProps): React.JSX.Element | null {
  // 每次打开都是新的选择和搜索
  return props.open ? <Picker {...props} /> : null
}

function matches(img: LibImage, q: string): boolean {
  if (!q) return true
  return (
    img.name.toLowerCase().includes(q) ||
    img.category.toLowerCase().includes(q) ||
    img.tags.some((t) => t.toLowerCase().includes(q))
  )
}

function Picker({ projectName, onClose, onAdd }: LibraryPickerSheetProps): React.JSX.Element {
  const images = useLibImages()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<ID[]>([])
  const [busy, setBusy] = useState(false)

  const query = q.trim().toLowerCase()
  const list = images.data.filter((img) => matches(img, query))
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
  if (images.loading) body = null
  else if (images.data.length === 0) body = <div className="as-none">全局库里还没有图片</div>
  else if (list.length === 0) body = <div className="as-none">没有找到「{q.trim()}」</div>
  else
    body = (
      <div className="as-pick-grid">
        {list.map((img) => (
          <PickItem key={img.id} img={img} on={picked.includes(img.id)} onToggle={() => toggle(img.id)} />
        ))}
      </div>
    )

  return (
    <Sheet
      open
      onClose={onClose}
      title="从全局库添加"
      subtitle={`选择要加入「${projectName}」资料的图片`}
      width={800}
      height={633}
      accessory={<SearchField value={q} onChange={setQ} placeholder="搜索图片素材" autoFocus />}
      closeButton={false}
      bodyStyle={{ padding: '16px 20px 20px' }}
      footer={
        <>
          <span className="lbl">{n > 0 ? `已选 ${n} 张` : '点按图片来选择，可多选'}</span>
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={n === 0} onClick={() => void add()}>
            {n > 0 ? `添加 ${n} 张` : '添加'}
          </Button>
        </>
      }
    >
      {body}
    </Sheet>
  )
}

function PickItem({ img, on, onToggle }: { img: LibImage; on: boolean; onToggle: () => void }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  return (
    <button type="button" className={cx('as-pk', on && 'on')} aria-pressed={on} onClick={onToggle}>
      <span className="frame">
        {broken ? (
          <span className="ph">
            <Icon name="photo" size={20} strokeWidth={1.5} />
          </span>
        ) : (
          <img
            src={imageUrl({ scope: 'library', id: img.id }, 320)}
            alt={img.name}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
          />
        )}
        <span className="as-tick">{on && <Icon name="check" size={11} strokeWidth={3} />}</span>
      </span>
      <span className="cap">{img.name}</span>
      <span className="meta">{formatSize(img.width, img.height)}</span>
    </button>
  )
}
