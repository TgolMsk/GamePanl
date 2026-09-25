import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { copyImage, useCopiedFlag } from '@renderer/app/clipboard'
import { useCommand } from '@renderer/app/commands'
import { isSelectModifier, menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useLibImages, useProjects, useStyles } from '@renderer/app/data'
import { useFileDrop, usePasteImage } from '@renderer/app/drop'
import { formatDate, formatSize } from '@renderer/app/format'
import { hud } from '@renderer/app/hud'
import { useMultiSelect, type MultiSelect } from '@renderer/app/selection'
import {
  Button,
  ConfirmSheet,
  cx,
  EmptyState,
  Icon,
  IconButton,
  ImageCard,
  Segmented,
  Tag,
  type SegmentedOption
} from '@renderer/ui'
import { imageUrl } from '@shared/api'
import { IMAGE_CATEGORIES, type ImageCategory, type ImageRef, type LibImage, type MenuItemSpec } from '@shared/types'
import { AddImagesSheet } from './AddImagesSheet'
import { LibraryToolbar, LoadError } from './common'
import { ImageQuickLook } from './ImageQuickLook'
import { importToLibrary, type ImportSource } from './importImages'
import { isCmdKey, isPlainKey, useMainKeys } from './keys'
import { matches, showError } from './shared'

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

const VIEW_LABEL = '查看和编辑'

const fieldsOf = (img: LibImage): string[] => [img.name, img.category, ...img.tags]
const refOf = (img: LibImage): ImageRef => ({ scope: 'library', id: img.id })

export interface ImagesTabProps {
  q: string
  onQ: (q: string) => void
  cat: ImageFilter
  onCat: (cat: ImageFilter) => void
  view: ImageView
  onView: (view: ImageView) => void
}

/**
 * 全局库 · 图片素材：照片式网格 / 列表，拖入、⌘V、加号（⌘I）添加。
 * 单击复制；⌘ / ⇧ 单击多选；双击或 Enter 打开查看和编辑；右键菜单；Delete 移到废纸篓；⌘C 复制；⌘A 全选；Esc 取消选择。
 */
export function ImagesTab({ q, onQ, cat, onCat, view, onView }: ImagesTabProps): React.JSX.Element {
  const images = useLibImages()
  const styles = useStyles()
  const projects = useProjects()
  const [viewId, setViewId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  /** 等待确认移到废纸篓的那些图 */
  const [trashing, setTrashing] = useState<LibImage[] | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  const all = images.data
  const shown = useMemo(
    () => all.filter((x) => (cat === 'all' || x.category === cat) && matches(q, fieldsOf(x))),
    [all, cat, q]
  )
  const shownIds = useMemo(() => shown.map((x) => x.id), [shown])
  const sel = useMultiSelect(shownIds)
  const { retain } = sel
  useEffect(() => {
    retain(shownIds)
  }, [retain, shownIds])
  /** 选中的图，按显示顺序 */
  const selected = useMemo(() => shown.filter((x) => sel.has(x.id)), [shown, sel])
  const viewing = all.find((x) => x.id === viewId) ?? null

  useCommand('import-images', () => setAdding(true))

  const runImport = async (source: ImportSource): Promise<boolean> => {
    const added = await importToLibrary(source, cat === 'all' ? null : cat)
    if (added.length === 0) return false
    // 新图片排在最前面：先放进缓存让它们立刻看得见（等广播刷新会把选中项当成不存在而清掉），并选中第一张
    const ids = new Set(added.map((x) => x.id))
    images.mutate((list) => [...added, ...list.filter((x) => !ids.has(x.id))])
    if (!added.some((x) => matches(q, fieldsOf(x)))) onQ('')
    sel.set(added[0].id)
    mainRef.current?.scrollTo({ top: 0 })
    return true
  }

  useFileDrop((paths) => void runImport({ kind: 'files', paths }), {
    label: '松手添加到全局库',
    hint: '原图会存进工作台，所有项目共用'
  })
  usePasteImage((p) => void runImport(p.kind === 'files' ? { kind: 'files', paths: p.paths } : { kind: 'clipboard' }))

  // ---------- 打开、复制、访达 ----------
  /** 打开查看和编辑：没选中的先选中它（已在多选里的不动） */
  const openView = (id: string): void => {
    if (!sel.has(id)) sel.set(id)
    setViewId(id)
  }

  const reveal = (img: LibImage): void => {
    window.gp.shell.revealImage(refOf(img)).catch(() => hud.show('找不到原文件'))
  }
  const openExternal = (img: LibImage): void => {
    window.gp.shell.openImage(refOf(img)).catch((err: unknown) => showError(`没能打开「${img.name}」`, err))
  }

  // ---------- 批量改分类、添加到项目、移到废纸篓 ----------
  const setCategory = async (group: LibImage[], category: ImageCategory): Promise<void> => {
    const todo = group.filter((x) => x.category !== category)
    if (todo.length === 0) return
    const ids = new Set(todo.map((x) => x.id))
    images.mutate((list) => list.map((x) => (ids.has(x.id) ? { ...x, category } : x)))
    let failed = 0
    let lastErr: unknown = null
    for (const img of todo) {
      try {
        const next = await window.gp.library.updateImage(img.id, { category })
        images.mutate((list) => list.map((x) => (x.id === next.id ? next : x)))
      } catch (err) {
        failed++
        lastErr = err
      }
    }
    const ok = todo.length - failed
    if (failed === 0) hud.show(ok === 1 ? `已移到「${category}」` : `已把 ${ok} 张移到「${category}」`, { ok: true })
    else if (ok > 0) hud.show(`已把 ${ok} 张移到「${category}」· ${failed} 张没能保存`)
    else showError(`没能移到「${category}」`, lastErr)
    if (failed > 0) void images.refresh()
  }

  const addToProject = async (group: LibImage[], projectId: string, projectName: string): Promise<void> => {
    let added: number
    try {
      // 接口只返回新加进去的；已经在资料里的不会再加一份
      added = (await window.gp.projects.addAssetsFromLibrary(projectId, group.map((x) => x.id))).length
    } catch (err) {
      showError(`没能添加到「${projectName}」`, err)
      return
    }
    const existing = group.length - added
    if (added === 0) hud.show(group.length === 1 ? `已经在「${projectName}」的资料里了` : `这些图片已经在「${projectName}」的资料里了`)
    else if (existing > 0) hud.show(`已添加 ${added} 张到「${projectName}」· ${existing} 张已经在里面`, { ok: true })
    else hud.show(`已添加 ${added} 张到「${projectName}」`, { ok: true })
  }

  const confirmTrash = async (): Promise<void> => {
    const group = trashing
    if (!group) return
    const gone = new Set<string>()
    let failed = 0
    let lastErr: unknown = null
    for (const img of group) {
      try {
        await window.gp.library.deleteImage(img.id)
        gone.add(img.id)
      } catch (err) {
        failed++
        lastErr = err
      }
    }
    if (gone.size > 0) images.mutate((list) => list.filter((x) => !gone.has(x.id)))
    if (viewId !== null && gone.has(viewId)) setViewId(null)
    setTrashing(null)
    if (failed === 0) hud.show(gone.size === 1 ? '已移到废纸篓' : `已把 ${gone.size} 张移到废纸篓`, { ok: true })
    else if (gone.size > 0) hud.show(`已把 ${gone.size} 张移到废纸篓 · ${failed} 张失败`)
    else showError('没能移到废纸篓', lastErr)
  }

  // ---------- 右键菜单 ----------
  /** 右键没选中的图：只对它；右键已选中的图：对整组选中项 */
  const onContextMenu = async (e: ReactMouseEvent, img: LibImage): Promise<void> => {
    const group = sel.has(img.id) ? selected : [img]
    if (!sel.has(img.id)) sel.set(img.id)
    const single = group.length === 1
    const projectList = projects.data
    const items: MenuItemSpec[] = [
      { id: 'view', label: `${VIEW_LABEL}…` },
      { id: 'copy', label: '复制', enabled: single },
      { id: 'reveal', label: '在访达中显示', enabled: single },
      { id: 'open', label: '用默认应用打开', enabled: single },
      {
        id: 'cat',
        label: '分类',
        submenu: IMAGE_CATEGORIES.map((c) => ({ id: `cat:${c}`, label: c, checked: group.every((x) => x.category === c) }))
      },
      {
        id: 'add',
        label: '添加到项目',
        enabled: projectList.length > 0,
        submenu: projectList.map((p) => ({ id: `prj:${p.id}`, label: p.name }))
      },
      menuSeparator,
      { id: 'trash', label: single ? '移到废纸篓' : `移到废纸篓 ${group.length} 张`, destructive: true }
    ]
    const picked = await showContextMenu(e, items)
    if (picked === null) return
    if (picked === 'view') setViewId(img.id)
    else if (picked === 'copy') void copyImage(refOf(img), img.name)
    else if (picked === 'reveal') reveal(img)
    else if (picked === 'open') openExternal(img)
    else if (picked === 'trash') setTrashing(group)
    else if (picked.startsWith('cat:')) {
      const c = IMAGE_CATEGORIES.find((x) => picked === `cat:${x}`)
      if (c) void setCategory(group, c)
    } else if (picked.startsWith('prj:')) {
      const p = projectList.find((x) => picked === `prj:${x.id}`)
      if (p) void addToProject(group, p.id, p.name)
    }
  }

  // ---------- 键盘 ----------
  useMainKeys(mainRef, (e) => {
    if (isPlainKey(e, 'Backspace', 'Delete')) {
      if (selected.length === 0) return
      e.preventDefault()
      setTrashing(selected)
    } else if (isPlainKey(e, 'Enter')) {
      const first = selected[0]
      if (!first) return
      e.preventDefault()
      setViewId(first.id)
    } else if (isCmdKey(e, 'c')) {
      if (selected.length !== 1) return
      e.preventDefault()
      void copyImage(refOf(selected[0]), selected[0].name)
    } else if (isCmdKey(e, 'a')) {
      if (shownIds.length === 0) return
      e.preventDefault()
      sel.setMany(shownIds)
    } else if (isPlainKey(e, 'Escape')) {
      if (sel.count === 0) return
      e.preventDefault()
      sel.clear()
    }
  })

  // ---------- 确认移到废纸篓的文案 ----------
  const trashIds = new Set((trashing ?? []).map((x) => x.id))
  const samples = styles.data.filter((s) => s.sampleImageId !== null && trashIds.has(s.sampleImageId))
  const trashTitle =
    trashing && trashing.length === 1 ? `把「${trashing[0].name}」移到废纸篓？` : `把 ${trashing?.length ?? 0} 张图片移到废纸篓？`
  const trashMessage =
    samples.length > 0
      ? `可以在访达的废纸篓里找回。风格${samples.map((s) => `「${s.name || '未命名风格'}」`).join('')}会改为不显示样张。`
      : '可以在访达的废纸篓里找回。'

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
            image={refOf(img)}
            name={img.name}
            meta={`${formatSize(img.width, img.height)} · ${img.format}`}
            aspect={4 / 3}
            thumb={640}
            selected={sel.has(img.id)}
            onClick={(e) => sel.click(img.id, e)}
            onDoubleClick={() => openView(img.id)}
            onContextMenu={(e) => void onContextMenu(e, img)}
            onView={() => openView(img.id)}
            viewLabel={VIEW_LABEL}
            dataId={img.id}
          />
        ))}
      </div>
    )
  } else {
    content = <ImageList items={shown} sel={sel} onOpen={openView} onContextMenu={(e, img) => void onContextMenu(e, img)} />
  }

  const subtitle = images.loading
    ? '所有项目共用'
    : `所有项目共用 · ${all.length} 张图片${sel.count > 1 ? ` · 已选 ${sel.count} 张` : ''}`

  return (
    <div className="screen">
      <LibraryToolbar
        subtitle={subtitle}
        q={q}
        onQ={onQ}
        placeholder="搜索图片"
        segment={<Segmented className="lib-cats" ariaLabel="按分类显示" value={cat} onChange={onCat} options={FILTERS} />}
      >
        <Segmented ariaLabel="显示方式" value={view} onChange={onView} options={VIEWS} />
        <IconButton icon="plus" label="添加图片" onClick={() => setAdding(true)} />
      </LibraryToolbar>
      <div className="screen-body">
        <main ref={mainRef} className="screen-main" tabIndex={0} aria-label="图片素材">
          {content}
        </main>
      </div>
      <AddImagesSheet open={adding} onClose={() => setAdding(false)} onImport={runImport} />
      <ImageQuickLook image={viewing} onClose={() => setViewId(null)} />
      <ConfirmSheet
        open={trashing !== null}
        title={trashTitle}
        message={trashMessage}
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setTrashing(null)}
        onConfirm={confirmTrash}
      />
    </div>
  )
}

interface ImageListProps {
  items: LibImage[]
  sel: MultiSelect
  /** 双击行、点行尾的按钮：打开查看和编辑 */
  onOpen: (id: string) => void
  onContextMenu: (e: ReactMouseEvent, img: LibImage) => void
}

/** 访达式列表：缩略图、名称、分类、尺寸、标签、添加日期；单击行复制，⌘ / ⇧ 多选，双击打开，右键菜单，可拖出 */
function ImageList({ items, sel, onOpen, onContextMenu }: ImageListProps): React.JSX.Element {
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
        const ref = refOf(img)
        const click = async (e: ReactMouseEvent<HTMLButtonElement>): Promise<void> => {
          sel.click(img.id, e)
          // 双击的第二下、带修饰键的多选都不再复制
          if (e.detail > 1 || isSelectModifier(e)) return
          if (await copyImage(ref, img.name)) markCopied(img.id)
        }
        return (
          <div
            key={img.id}
            className={cx('lib-lr', i % 2 === 1 && 'alt', sel.has(img.id) && 'sel')}
            data-id={img.id}
            onContextMenu={(e) => onContextMenu(e, img)}
          >
            <button
              type="button"
              className="lib-lb lib-lc"
              aria-label={`复制「${img.name}」`}
              onClick={(e) => void click(e)}
              onDoubleClick={() => onOpen(img.id)}
              draggable
              onDragStart={(e) => {
                // 交给系统原生拖拽：可以直接拖进访达、ChatGPT、Photoshop
                e.preventDefault()
                void window.gp.shell.dragImage(ref).catch(() => undefined)
              }}
            >
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
            <IconButton className="lib-le" icon="eye" label={VIEW_LABEL} onClick={() => onOpen(img.id)} />
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
