import './assets.css'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { AssetPatch } from '@shared/api'
import { ASSET_CATEGORIES, type AssetCategory, type ID, type ImageRef, type ProjectAsset } from '@shared/types'
import { copyImage } from '@renderer/app/clipboard'
import { useCommand } from '@renderer/app/commands'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useAssets, useNotes, useProject } from '@renderer/app/data'
import { useFileDrop, usePasteImage } from '@renderer/app/drop'
import { formatSize } from '@renderer/app/format'
import { hud } from '@renderer/app/hud'
import { useMultiSelect } from '@renderer/app/selection'
import { openSheetCount } from '@renderer/app/sheetStack'
import {
  Button,
  ConfirmSheet,
  EmptyState,
  Icon,
  IconButton,
  ImageCard,
  QuickLook,
  Segmented,
  Toolbar
} from '@renderer/ui'
import { AddImagesSheet } from './AddImagesSheet'
import { groupByDate } from './grouping'
import { Inspector } from './Inspector'
import { LibraryPickerSheet } from './LibraryPickerSheet'
import { loadZoom, openImage, revealImage, saveZoom, showError, ZOOM_MAX, ZOOM_MIN } from './util'

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: '概念图', label: '概念图' },
  { value: '角色', label: '角色' },
  { value: '场景', label: '场景' },
  { value: '截图', label: '截图' },
  { value: '参考', label: '参考' },
  { value: 'UI', label: 'UI' }
] as const satisfies ReadonlyArray<{ value: 'all' | AssetCategory; label: string }>

type Filter = (typeof FILTERS)[number]['value']

const EMPTY_TITLE: Record<Filter, string> = {
  all: '还没有资料',
  概念图: '没有概念图',
  角色: '没有角色图',
  场景: '没有场景图',
  截图: '没有截图',
  参考: '没有参考图',
  UI: '没有 UI 图'
}

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']

// 缩略图统一用一种尺寸（最大三列时也够清楚），拖动大小滑块时不用重新加载
const THUMB = 640

/** 导入的结果：added 有图片落地（新加的，或已经在资料里的那张）；empty 没有图片；error 出错了 */
type ImportResult = 'added' | 'empty' | 'error'

const alreadyIn = (n: number): string => (n === 1 ? '这张图片已经在资料里了' : '这些图片已经在资料里了')

function isEditable(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null
}

/** 焦点所在的卡片 id（焦点在卡片的按钮上时） */
function cardIdOf(el: EventTarget | null): ID | null {
  return el instanceof Element ? (el.closest<HTMLElement>('[data-id]')?.dataset.id ?? null) : null
}

/** 项目资料：本项目的图片，像「照片」一样按添加时间分组显示 */
export default function ProjectAssetsScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useProject(projectId)
  const assets = useAssets(projectId)
  const notes = useNotes(projectId)
  const name = project.data?.name ?? ''

  const [filter, setFilter] = useState<Filter>('all')
  const [zoom, setZoom] = useState(loadZoom)
  const [viewId, setViewId] = useState<ID | null>(null)
  const [adding, setAdding] = useState(false)
  const [picking, setPicking] = useState(false)
  /** 等待确认移到废纸篓的图片（一张或一组） */
  const [trashing, setTrashing] = useState<ProjectAsset[] | null>(null)

  const cols = 9 - zoom
  const visible = useMemo(
    () => (filter === 'all' ? assets.data : assets.data.filter((a) => a.category === filter)),
    [assets.data, filter]
  )
  const groups = useMemo(() => groupByDate(visible), [visible])
  // 屏幕上的行（每组各自换行），方向键上下按行移动
  const rows = useMemo(
    () =>
      groups.flatMap((g) => {
        const out: ID[][] = []
        for (let i = 0; i < g.items.length; i += cols) out.push(g.items.slice(i, i + cols).map((a) => a.id))
        return out
      }),
    [groups, cols]
  )
  const order = useMemo(() => rows.flat(), [rows])
  const byId = useMemo(() => new Map(visible.map((a) => [a.id, a] as const)), [visible])

  // ---------- 选中：单击选一张，⌘ 加选，⇧ 连选 ----------
  const sel = useMultiSelect(order)
  const { retain } = sel
  useEffect(() => retain(order), [order, retain])
  /** 选中的图片，按屏幕顺序 */
  const selectedAssets = useMemo(
    () => order.filter((id) => sel.has(id)).flatMap((id) => byId.get(id) ?? []),
    [order, sel, byId]
  )
  const explicit = selectedAssets.length > 0
  /** 检查器显示的那一张：单选时是它；什么都没选时默认第一张；多选时 null */
  const single: ProjectAsset | null =
    selectedAssets.length === 1 ? selectedAssets[0] : explicit ? null : (byId.get(order[0] ?? '') ?? null)
  /** 键盘、检查器按钮作用的对象 */
  const targets: ProjectAsset[] = explicit ? selectedAssets : single ? [single] : []
  const isSelected = (id: ID): boolean => (explicit ? sel.has(id) : id === single?.id)
  const refOf = (id: ID): ImageRef => ({ scope: 'project', projectId, id })

  // ---------- 键盘焦点：选中后把焦点和滚动带到那张卡片 ----------
  const mainRef = useRef<HTMLElement>(null)
  const focusReq = useRef<ID | null>(null)
  const applyFocus = (): void => {
    const id = focusReq.current
    const main = mainRef.current
    // sheet 关掉之后再移焦点（sheet 关闭时会把焦点还给打开它的按钮）
    if (!id || !main || openSheetCount() > 0) return
    const card = main.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
    if (!card) return
    focusReq.current = null
    card.querySelector<HTMLElement>('.hit')?.focus({ preventScroll: true })
    const top = card.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
    const bottom = top + card.offsetHeight
    if (top < main.scrollTop + 12) main.scrollTop = Math.max(0, top - 44)
    else if (bottom > main.scrollTop + main.clientHeight - 12) main.scrollTop = bottom - main.clientHeight + 24
  }
  useEffect(applyFocus)
  const focusCard = (id: ID): void => {
    focusReq.current = id
    applyFocus()
  }

  /** 方向键：从当前那张（多选时是最后点的那张）移动，移动后变成单选 */
  const move = (key: string): void => {
    if (order.length === 0) return
    let next = order[0]
    const cur = sel.anchor && byId.has(sel.anchor) ? sel.anchor : targets[0]?.id
    if (cur) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const i = order.indexOf(cur) + (key === 'ArrowRight' ? 1 : -1)
        next = order[Math.max(0, Math.min(order.length - 1, i))]
      } else {
        const r = rows.findIndex((row) => row.includes(cur))
        const c = rows[r].indexOf(cur)
        const target = rows[r + (key === 'ArrowDown' ? 1 : -1)]
        next = target ? target[Math.min(c, target.length - 1)] : cur
      }
    }
    sel.set(next)
    focusCard(next)
  }

  /** 打开 Quick Look；这张还没选中的话先选中它 */
  const openView = (id: ID): void => {
    if (!sel.has(id)) sel.set(id)
    setViewId(id)
  }

  // 焦点在网格里或没有焦点时（不在输入框里、没有 sheet 打开）：
  // 方向键移动，Delete 移到废纸篓，Enter 打开，⌘C 复制，⌘A 全选，Esc 取消多选
  const handleKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return
    const main = mainRef.current
    const t = e.target
    if (!main || openSheetCount() > 0 || isEditable(t)) return
    if (t !== document.body && !(t instanceof Node && main.contains(t))) return
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
    const cmd = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
    const key = e.key
    if (plain && ARROWS.includes(key)) {
      e.preventDefault()
      move(key)
    } else if (plain && (key === 'Backspace' || key === 'Delete')) {
      if (targets.length === 0) return
      e.preventDefault()
      setTrashing(targets)
    } else if (plain && key === 'Enter') {
      // 焦点在某张卡片上就打开它，否则打开选中的那张（也拦掉按钮默认的「回车 = 点击复制」）
      const id = cardIdOf(t) ?? targets[0]?.id
      if (!id) return
      e.preventDefault()
      openView(id)
    } else if (plain && key === 'Escape') {
      if (selectedAssets.length < 2) return
      e.preventDefault()
      sel.clear()
    } else if (cmd && key.toLowerCase() === 'a') {
      if (order.length === 0) return
      e.preventDefault()
      sel.setMany(order)
    } else if (cmd && key.toLowerCase() === 'c') {
      // 页面上有选中的文字时让系统照常复制文字
      if (targets.length !== 1 || document.getSelection()?.isCollapsed === false) return
      e.preventDefault()
      void copyImage(refOf(targets[0].id), targets[0].name)
    }
  }
  const keyRef = useRef(handleKey)
  useEffect(() => {
    keyRef.current = handleKey
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => keyRef.current(e)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const changeZoom = (z: number): void => {
    setZoom(z)
    saveZoom(z)
  }

  // ---------- 导入：拖入、粘贴、选择文件、从全局库添加、菜单 ⌘I ----------
  const assetsRef = useRef(assets.data)
  useEffect(() => {
    assetsRef.current = assets.data
  })

  /** 调用导入接口，把落地的图片选中并滚动到那里；empty 是什么都没加进来时的提示（null 不提示） */
  const runImport = async (
    task: () => Promise<ProjectAsset[] | ProjectAsset | null>,
    empty: string | null
  ): Promise<ImportResult> => {
    const before = new Set(assetsRef.current.map((a) => a.id))
    let result: ProjectAsset[] | ProjectAsset | null
    try {
      result = await task()
    } catch (err) {
      showError('添加失败', err)
      return 'error'
    }
    const items = result === null ? [] : Array.isArray(result) ? result : [result]
    if (items.length === 0) {
      if (empty) hud.show(empty)
      return 'empty'
    }
    const fresh = items.filter((a) => !before.has(a.id))
    if (fresh.length > 0) {
      const ids = new Set(fresh.map((a) => a.id))
      assets.mutate((list) => [...fresh, ...list.filter((a) => !ids.has(a.id))])
      hud.show(`已添加 ${fresh.length} 张到「${name}」`, { ok: true })
    } else {
      hud.show(alreadyIn(items.length))
    }
    const first = fresh[0] ?? items[0]
    if (filter !== 'all' && first.category !== filter) setFilter('all')
    sel.set(first.id)
    focusCard(first.id)
    return 'added'
  }

  const importFiles = (paths?: string[]): Promise<ImportResult> =>
    runImport(
      () => window.gp.projects.importAssets(projectId, paths),
      // 不给路径时是系统文件框：取消了就什么都不说
      paths ? alreadyIn(paths.length) : null
    )
  const importClipboard = (): Promise<ImportResult> =>
    runImport(() => window.gp.projects.importAssetFromClipboard(projectId), '剪贴板里没有图片')
  const addFromLibrary = async (ids: ID[]): Promise<boolean> => {
    const r = await runImport(
      () => window.gp.projects.addAssetsFromLibrary(projectId, ids),
      alreadyIn(ids.length)
    )
    if (r === 'error') return false
    setPicking(false)
    return true
  }

  useFileDrop((paths) => void importFiles(paths), { label: name ? `松手添加到「${name}」` : '松手添加' })
  usePasteImage((p) => void (p.kind === 'files' ? importFiles(p.paths) : importClipboard()))
  useCommand('import-images', () => setAdding(true))

  // ---------- 修改、删除、封面 ----------
  const patchAsset = async (id: ID, patch: AssetPatch): Promise<void> => {
    assets.mutate((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    if (patch.category && filter !== 'all' && patch.category !== filter) hud.show(`已移到「${patch.category}」`)
    try {
      const saved = await window.gp.projects.updateAsset(projectId, id, patch)
      assets.mutate((list) => list.map((a) => (a.id === id ? saved : a)))
    } catch (err) {
      showError('没能保存', err)
      void assets.refresh()
    }
  }

  /** 把一张或一组改成某个分类；多张时依次保存，完成后 HUD 报数 */
  const setCategory = async (group: ProjectAsset[], category: AssetCategory): Promise<void> => {
    const todo = group.filter((a) => a.category !== category)
    if (todo.length === 0) return
    if (group.length === 1) return patchAsset(todo[0].id, { category })
    const ids = new Set(todo.map((a) => a.id))
    assets.mutate((list) => list.map((a) => (ids.has(a.id) ? { ...a, category } : a)))
    let ok = 0
    let lastErr: unknown = null
    for (const a of todo) {
      try {
        const saved = await window.gp.projects.updateAsset(projectId, a.id, { category })
        assets.mutate((list) => list.map((x) => (x.id === a.id ? saved : x)))
        ok++
      } catch (err) {
        lastErr = err
      }
    }
    // 报数按选中的张数算（本来就在这个分类里的也算「已在」）
    const failed = todo.length - ok
    if (failed === 0) {
      hud.show(`已把 ${group.length} 张移到「${category}」`, { ok: true })
    } else {
      showError(ok === 0 ? '没能保存' : `已把 ${group.length - failed} 张移到「${category}」，${failed} 张没能保存`, lastErr)
      void assets.refresh()
    }
  }

  const isCover = (id: ID): boolean => project.data?.coverAssetId === id
  /** 设为 / 取消项目封面 */
  const toggleCover = async (a: ProjectAsset): Promise<void> => {
    const off = isCover(a.id)
    try {
      const p = await window.gp.projects.update(projectId, { coverAssetId: off ? null : a.id })
      project.mutate(p)
      hud.show(off ? `已取消「${name}」的封面` : `已设为「${name}」的封面`, { ok: true })
    } catch (err) {
      showError('没能设置封面', err)
    }
  }

  const confirmTrash = async (): Promise<void> => {
    const group = trashing
    if (!group || group.length === 0) return
    const ids = new Set(group.map((a) => a.id))
    // 删完选中下一张：最后一张被删的后面第一张还在的，没有就往前找
    const positions = order.flatMap((id, i) => (ids.has(id) ? [i] : []))
    let next: ID | null = null
    if (positions.length > 0) {
      for (let i = positions[positions.length - 1] + 1; i < order.length && !next; i++) {
        if (!ids.has(order[i])) next = order[i]
      }
      for (let i = positions[0] - 1; i >= 0 && !next; i--) {
        if (!ids.has(order[i])) next = order[i]
      }
    }
    const done = new Set<ID>()
    let lastErr: unknown = null
    for (const a of group) {
      try {
        await window.gp.projects.deleteAsset(projectId, a.id)
        done.add(a.id)
      } catch (err) {
        lastErr = err
      }
    }
    if (done.size > 0) assets.mutate((list) => list.filter((x) => !done.has(x.id)))
    setTrashing(null)
    if (viewId && done.has(viewId)) setViewId(null)
    const failed = group.filter((a) => !done.has(a.id))
    if (failed.length > 0) {
      sel.setMany(failed.map((a) => a.id))
    } else {
      sel.set(next)
      if (next) focusCard(next)
    }
    const n = group.length
    if (done.size === n) hud.show(n === 1 ? '已移到废纸篓' : `已把 ${n} 张移到废纸篓`, { ok: true })
    else if (done.size === 0) showError('没能移到废纸篓', lastErr)
    else hud.show(`已把 ${done.size} 张移到废纸篓，${failed.length} 张没能移动`)
  }

  // ---------- 右键菜单 ----------
  const showCardMenu = async (e: ReactMouseEvent, group: ProjectAsset[]): Promise<void> => {
    const many = group.length > 1
    const first = group[0]
    const common = group.every((a) => a.category === first.category) ? first.category : null
    const picked = await showContextMenu(e, [
      { id: 'view', label: '查看…', enabled: !many },
      { id: 'copy', label: '复制', enabled: !many },
      { id: 'open', label: '用默认应用打开', enabled: !many },
      { id: 'reveal', label: '在访达中显示', enabled: !many },
      {
        id: 'cat',
        label: '分类',
        submenu: ASSET_CATEGORIES.map((c) => ({ id: `cat:${c}`, label: c, checked: c === common }))
      },
      { id: 'cover', label: '设为项目封面', enabled: !many, checked: !many && isCover(first.id) },
      menuSeparator,
      { id: 'trash', label: many ? `移到废纸篓 ${group.length} 张` : '移到废纸篓', destructive: true }
    ])
    if (!picked) return
    const ref = refOf(first.id)
    if (picked === 'view') openView(first.id)
    else if (picked === 'copy') void copyImage(ref, first.name)
    else if (picked === 'open') void openImage(ref)
    else if (picked === 'reveal') void revealImage(ref)
    else if (picked === 'cover') void toggleCover(first)
    else if (picked === 'trash') setTrashing(group)
    else {
      const category = ASSET_CATEGORIES.find((c) => `cat:${c}` === picked)
      if (category) void setCategory(group, category)
    }
  }

  /** 右键没选中的图：先把它设为唯一选中项；右键已选中的图：作用在整组上 */
  const onCardMenu = (e: ReactMouseEvent, a: ProjectAsset): void => {
    let group: ProjectAsset[]
    if (sel.has(a.id) && selectedAssets.length > 1) {
      group = selectedAssets
    } else {
      sel.set(a.id)
      group = [a]
    }
    void showCardMenu(e, group)
  }

  const viewing = assets.data.find((a) => a.id === viewId) ?? null

  let content: React.ReactNode = null
  if (assets.loading) {
    // 第一次读取中什么都不画，避免闪一下空状态
  } else if (assets.error !== null && assets.data.length === 0) {
    content = (
      <EmptyState icon="photo" title="读不到资料" hint={assets.error}>
        <Button onClick={() => void assets.refresh()}>重试</Button>
      </EmptyState>
    )
  } else if (visible.length === 0) {
    content = (
      <EmptyState icon="photo" title={EMPTY_TITLE[filter]} hint="把图片拖到这里，或从全局库添加">
        <Button onClick={() => void importFiles()}>选择文件…</Button>
        <Button onClick={() => setPicking(true)}>从全局库添加</Button>
      </EmptyState>
    )
  } else {
    content = groups.map((g) => (
      <section key={g.key} className="as-grp" aria-label={g.title}>
        <div className="as-gh">
          <h2>{g.title}</h2>
          {g.date && <span className="meta">{g.date}</span>}
          <span className="grow" />
          <span className="meta">{g.items.length} 张</span>
        </div>
        <div className="as-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {g.items.map((a) => (
            <ImageCard
              key={a.id}
              image={refOf(a.id)}
              name={a.name}
              meta={formatSize(a.width, a.height)}
              aspect={4 / 3}
              thumb={THUMB}
              selected={isSelected(a.id)}
              viewLabel="查看"
              onClick={(e) => sel.click(a.id, e)}
              onDoubleClick={() => openView(a.id)}
              onContextMenu={(e) => onCardMenu(e, a)}
              onView={() => openView(a.id)}
              dataId={a.id}
            />
          ))}
        </div>
      </section>
    ))
  }

  const subtitle = assets.loading
    ? '资料'
    : `资料 · ${assets.data.length} 张${selectedAssets.length > 1 ? ` · 已选 ${selectedAssets.length} 张` : ''}`
  const trashMany = trashing !== null && trashing.length > 1

  return (
    <div className="screen">
      <Toolbar title={name} subtitle={subtitle}>
        <Segmented ariaLabel="按分类显示" value={filter} onChange={setFilter} options={FILTERS} />
        <div className="as-zoom">
          <Icon name="photo" size={12} strokeWidth={1.9} />
          <input
            className="as-rng"
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={1}
            value={zoom}
            aria-label="缩略图大小"
            onChange={(e) => changeZoom(Number(e.target.value))}
          />
          <Icon name="photo" size={17} />
        </div>
        <Button onClick={() => setPicking(true)}>从全局库添加</Button>
        <IconButton icon="plus" label="添加图片" onClick={() => setAdding(true)} />
      </Toolbar>

      <div className="screen-body">
        <main ref={mainRef} className="screen-main as-main" tabIndex={0} aria-label="资料">
          {content}
        </main>
        <Inspector
          projectId={projectId}
          asset={single}
          selection={selectedAssets}
          isCover={single !== null && isCover(single.id)}
          notes={notes.data}
          onPatch={(id, patch) => void patchAsset(id, patch)}
          onView={() => single && openView(single.id)}
          onTrash={() => targets.length > 0 && setTrashing(targets)}
          onBatchCategory={(category) => void setCategory(selectedAssets, category)}
          onClearSelection={sel.clear}
        />
      </div>

      <QuickLook
        image={viewing && { ...viewing, ref: refOf(viewing.id) }}
        onClose={() => setViewId(null)}
        onTagsChange={(tags) => viewing && void patchAsset(viewing.id, { tags })}
      />

      <LibraryPickerSheet
        open={picking}
        projectName={name}
        onClose={() => setPicking(false)}
        onAdd={addFromLibrary}
      />

      <AddImagesSheet
        open={adding}
        projectName={name}
        onClose={() => setAdding(false)}
        importFiles={async (paths) => (await importFiles(paths)) === 'added'}
        importClipboard={async () => (await importClipboard()) === 'added'}
      />

      <ConfirmSheet
        open={trashing !== null}
        title={
          trashMany ? `把 ${trashing.length} 张图片移到废纸篓？` : `把「${trashing?.[0]?.name ?? ''}」移到废纸篓？`
        }
        message="可以在访达的废纸篓里找回。"
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setTrashing(null)}
        onConfirm={confirmTrash}
      />
    </div>
  )
}
