import { useState } from 'react'
import { useLibImages } from '@renderer/app/data'
import { Button, cx, EmptyState, Icon, SearchField, Sheet } from '@renderer/ui'
import { imageUrl } from '@shared/api'
import { matches } from './shared'

export interface SamplePickerProps {
  open: boolean
  /** 现在的样张 */
  current: string | null
  onClose: () => void
  onPick: (imageId: string) => void
}

/** 从全局库图片里选一张做风格样张 */
export function SamplePicker(props: SamplePickerProps): React.JSX.Element | null {
  // 每次打开都从空搜索开始
  return props.open ? <PickerSheet {...props} /> : null
}

function PickerSheet({ current, onClose, onPick }: SamplePickerProps): React.JSX.Element {
  const images = useLibImages()
  const [q, setQ] = useState('')
  const shown = images.data.filter((x) => matches(q, [x.name, x.category, ...x.tags]))

  return (
    <Sheet
      open
      onClose={onClose}
      title="选择样张"
      subtitle="从全局库的图片里选一张"
      width={760}
      height={560}
      accessory={<SearchField value={q} onChange={setQ} placeholder="搜索图片" width={200} autoFocus />}
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
        </>
      }
    >
      {images.data.length === 0 && !images.loading ? (
        <EmptyState icon="photo" title="全局库里还没有图片" hint="先在「图片素材」里添加图片，再回来选样张。" />
      ) : shown.length === 0 && !images.loading ? (
        <EmptyState icon="search" title="没有找到图片" hint={`没有和“${q.trim()}”匹配的图片`} />
      ) : (
        <div className="lib-picks">
          {shown.map((img) => (
            <button
              key={img.id}
              type="button"
              className={cx('lib-pick', current === img.id && 'on')}
              aria-pressed={current === img.id}
              onClick={() => onPick(img.id)}
            >
              <span className="lib-pick-f">
                <img
                  src={imageUrl({ scope: 'library', id: img.id }, 480)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
                {current === img.id && (
                  <span className="done">
                    <Icon name="check" size={11} strokeWidth={2.4} />
                    当前样张
                  </span>
                )}
              </span>
              <span className="cap">{img.name}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
