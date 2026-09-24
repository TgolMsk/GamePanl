import { useRef, useState } from 'react'
import { copyImage, useCopiedFlag } from '@renderer/app/clipboard'
import { useLibImages } from '@renderer/app/data'
import { useFileDrop, usePasteImage } from '@renderer/app/drop'
import { formatDate, formatSize } from '@renderer/app/format'
import { Button, cx, EmptyState, Icon, IconButton, ImageCard, Segmented, Tag, type SegmentedOption } from '@renderer/ui'
import { imageUrl } from '@shared/api'
import { IMAGE_CATEGORIES, type ImageCategory, type LibImage } from '@shared/types'
import { AddImagesSheet } from './AddImagesSheet'
import { LibraryToolbar, LoadError } from './common'
import { ImageQuickLook } from './ImageQuickLook'
import { importToLibrary, type ImportSource } from './importImages'
import { matches } from './shared'

export type ImageFilter = 'all' | ImageCategory
export type ImageView = 'grid' | 'list'

const FILTERS: ReadonlyArray<SegmentedOption<ImageFilter>> = [
  { value: 'all', label: '全部' },
  ...IMAGE_CATEGORIES.map((c) => ({ value: c, label: c }))
]

const VIEWS: ReadonlyArray<SegmentedOption<ImageView>> = [
  { value: 'grid', icon: 'grid', title: '网格' },
  { value: 'list', icon: 'list', title: '列表' }
]

const fieldsOf = (img: LibImage): string[] => [img.name, img.category, ...img.tags]

export interface ImagesTabProps {
  q: string
  onQ: (q: string) => void
  cat: ImageFilter
  onCat: (cat: ImageFilter) => void
  view: ImageView
  onView: (view: ImageView) => void
}

/** 全局库 · 图片素材：照片式网格 / 列表，拖入、⌘V、加号添加 */
export function ImagesTab({ q, onQ, cat, onCat, view, onView }: ImagesTabProps): React.JSX.Element {
  const images = useLibImages()
  const [selId, setSelId] = useState<string | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  const all = images.data
  const shown = all.filter((x) => (cat === 'all' || x.category === cat) && matches(q, fieldsOf(x)))
  const viewing = all.find((x) => x.id === viewId) ?? null

  const runImport = async (source: ImportSource): Promise<boolean> => {
    const added = await importToLibrary(source, cat === 'all' ? null : cat)
    if (added.length === 0) return false
    // 新图片排在最前面：让它们看得见，并选中第一张
    if (!added.some((x) => matches(q, fieldsOf(x)))) onQ('')
    setSelId(added[0].id)
    mainRef.current?.scrollTo({ top: 0 })
    return true
  }

  useFileDrop((paths) => void runImport({ kind: 'files', paths }), {
    label: '松手添加到全局库',
    hint: '原图会存进工作台，所有项目共用'
  })
  usePasteImage((p) => void runImport(p.kind === 'files' ? { kind: 'files', paths: p.paths } : { kind: 'clipboard' }))

  const openView = (id: string): void => {
    setSelId(id)
    setViewId(id)
  }

  let content: React.JSX.Element | null = null
  if (images.error !== null && all.length === 0) {
    content = <LoadError error={images.error} onRetry={() => void images.refresh()} />
  } else if (images.loading) {
    content = null
  } else if (all.length === 0) {
    content = (
      <EmptyState icon="photo" title="这里还没有图片素材" hint="把图片拖到这里，或 ⌘V 粘贴。所有项目都能用。">
        <Button icon="plus" onClick={() => setAdding(true)}>
          添加图片…
        </Button>
      </EmptyState>
    )
  } else if (shown.length === 0) {
    content = q.trim() ? (
      <EmptyState icon="search" title="没有找到图片" hint={`没有和“${q.trim()}”匹配的图片`} />
    ) : (
      <EmptyState icon="photo" title={`「${cat}」里还没有图片`} hint="在这个分类下添加的图片会归到这里">
        <Button icon="plus" onClick={() => setAdding(true)}>
          添加图片…
        </Button>
      </EmptyState>
    )
  } else if (view === 'grid') {
    content = (
      <div className="lib-igrid">
        {shown.map((img) => (
          <ImageCard
            key={img.id}
            image={{ scope: 'library', id: img.id }}
            name={img.name}
            meta={`${formatSize(img.width, img.height)} · ${img.format}`}
            aspect={4 / 3}
            thumb={640}
            selected={selId === img.id}
            onClick={() => setSelId(img.id)}
            onView={() => openView(img.id)}
            dataId={img.id}
          />
        ))}
      </div>
    )
  } else {
    content = <ImageList items={shown} selId={selId} onSelect={setSelId} onView={openView} />
  }

  return (
    <div className="screen">
      <LibraryToolbar
        subtitle={images.loading ? '所有项目共用' : `所有项目共用 · ${all.length} 张图片`}
        q={q}
        onQ={onQ}
        placeholder="搜索图片"
        segment={<Segmented className="lib-cats" ariaLabel="按分类显示" value={cat} onChange={onCat} options={FILTERS} />}
      >
        <Segmented ariaLabel="显示方式" value={view} onChange={onView} options={VIEWS} />
        <IconButton icon="plus" label="添加图片" onClick={() => setAdding(true)} />
      </LibraryToolbar>
      <div className="screen-body">
        <main ref={mainRef} className="screen-main">
          {content}
        </main>
      </div>
      <AddImagesSheet open={adding} onClose={() => setAdding(false)} onImport={runImport} />
      <ImageQuickLook image={viewing} onClose={() => setViewId(null)} />
    </div>
  )
}

interface ImageListProps {
  items: LibImage[]
  selId: string | null
  onSelect: (id: string) => void
  onView: (id: string) => void
}

/** 访达式列表：缩略图、名称、分类、尺寸、标签、添加日期；单击行复制 */
function ImageList({ items, selId, onSelect, onView }: ImageListProps): React.JSX.Element {
  const [copiedId, markCopied] = useCopiedFlag()
  return (
    <div className="lib-list">
      <div className="lib-lc lib-lhd" aria-hidden="true">
        <span />
        <span>名称</span>
        <span>分类</span>
        <span>尺寸</span>
        <span>标签</span>
        <span>添加日期</span>
      </div>
      {items.map((img, i) => {
        const ref = { scope: 'library', id: img.id } as const
        const copy = async (): Promise<void> => {
          onSelect(img.id)
          if (await copyImage(ref, img.name)) markCopied(img.id)
        }
        return (
          <div key={img.id} className={cx('lib-lr', i % 2 === 1 && 'alt', selId === img.id && 'sel')} data-id={img.id}>
            <button type="button" className="lib-lb lib-lc" aria-label={`复制「${img.name}」`} onClick={copy}>
              <ListThumb src={imageUrl(ref, 96)} />
              <span className="lib-ln">
                <span className="nm">{img.name}</span>
                {copiedId === img.id && (
                  <span className="done">
                    <Icon name="check" size={11} strokeWidth={2.4} />
                    已复制
                  </span>
                )}
              </span>
              <span className="lib-lm">{img.category}</span>
              <span className="lib-lm">
                {formatSize(img.width, img.height)} · {img.format}
              </span>
              <span className="lib-lg">
                {img.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </span>
              <span className="lib-lm">{formatDate(img.addedAt)}</span>
            </button>
            <IconButton className="lib-le" icon="eye" label="查看" onClick={() => onView(img.id)} />
          </div>
        )
      })}
    </div>
  )
}

function ListThumb({ src }: { src: string }): React.JSX.Element {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  return (
    <span className="lib-lt">
      {brokenSrc === src ? (
        <span className="ph">
          <Icon name="photo" size={13} strokeWidth={2} />
        </span>
      ) : (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBrokenSrc(src)} />
      )}
    </span>
  )
}
