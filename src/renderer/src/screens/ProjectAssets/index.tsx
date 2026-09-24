import './assets.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetPatch } from '@shared/api'
import type { AssetCategory, ID, ProjectAsset } from '@shared/types'
import { useAssets, useNotes, useProject } from '@renderer/app/data'
import { useFileDrop, usePasteImage } from '@renderer/app/drop'
import { formatSize } from '@renderer/app/format'
import { hud } from '@renderer/app/hud'
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
import { loadZoom, saveZoom, showError, ZOOM_MAX, ZOOM_MIN } from './util'

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

/** 项目资料：本项目的图片，像「照片」一样按添加时间分组显示 */
export default function ProjectAssetsScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useProject(projectId)
  const assets = useAssets(projectId)
  const notes = useNotes(projectId)
  const name = project.data?.name ?? ''

  const [filter, setFilter] = useState<Filter>('all')
  const [zoom, setZoom] = useState(loadZoom)
  const [selId, setSelId] = useState<ID | null>(null)
  const [viewId, setViewId] = useState<ID | null>(null)
  const [adding, setAdding] = useState(false)
  const [picking, setPicking] = useState(false)
  const [trashing, setTrashing] = useState<ProjectAsset | null>(null)

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
  const selected = visible.find((a) => a.id === selId) ?? groups[0]?.items[0] ?? null

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

  const move = (key: string): void => {
    if (order.length === 0) return
    let next = order[0]
    const cur = selected?.id
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
    setSelId(next)
    focusCard(next)
  }
  const moveRef = useRef(move)
  useEffect(() => {
    moveRef.current = move
  })
  // 焦点在网格里或没有焦点时，方向键移动选中
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!ARROWS.includes(e.key) || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const main = mainRef.current
      const t = e.target
      if (!main || openSheetCount() > 0 || isEditable(t)) return
      if (t !== document.body && !(t instanceof Node && main.contains(t))) return
      e.preventDefault()
      moveRef.current(e.key)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const changeZoom = (z: number): void => {
    setZoom(z)
    saveZoom(z)
  }

  // ---------- 导入：拖入、粘贴、选择文件、从全局库添加 ----------
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
    setSelId(first.id)
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

  // ---------- 修改、删除 ----------
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

  const confirmTrash = async (): Promise<void> => {
    const a = trashing
    if (!a) return
    const i = order.indexOf(a.id)
    const next = i >= 0 ? (order[i + 1] ?? order[i - 1] ?? null) : null
    try {
      await window.gp.projects.deleteAsset(projectId, a.id)
    } catch (err) {
      setTrashing(null)
      showError('没能移到废纸篓', err)
      return
    }
    assets.mutate((list) => list.filter((x) => x.id !== a.id))
    setTrashing(null)
    if (viewId === a.id) setViewId(null)
    setSelId(next)
    if (next) focusCard(next)
    hud.show('已移到废纸篓', { ok: true })
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
              image={{ scope: 'project', projectId, id: a.id }}
              name={a.name}
              meta={formatSize(a.width, a.height)}
              aspect={4 / 3}
              thumb={THUMB}
              selected={a.id === selected?.id}
              onClick={() => setSelId(a.id)}
              onView={() => {
                setSelId(a.id)
                setViewId(a.id)
              }}
              dataId={a.id}
            />
          ))}
        </div>
      </section>
    ))
  }

  return (
    <div className="screen">
      <Toolbar title={name} subtitle={assets.loading ? '资料' : `资料 · ${assets.data.length} 张`}>
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
          asset={selected}
          notes={notes.data}
          onPatch={(id, patch) => void patchAsset(id, patch)}
          onView={() => selected && setViewId(selected.id)}
          onTrash={() => selected && setTrashing(selected)}
        />
      </div>

      <QuickLook
        image={viewing && { ...viewing, ref: { scope: 'project', projectId, id: viewing.id } }}
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
        title={`把「${trashing?.name ?? ''}」移到废纸篓？`}
        message="可以在访达的废纸篓里找回。"
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setTrashing(null)}
        onConfirm={confirmTrash}
      />
    </div>
  )
}
