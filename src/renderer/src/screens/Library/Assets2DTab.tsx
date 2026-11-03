import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useCommand } from '@renderer/app/commands'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useLibAssets2D, useProjects } from '@renderer/app/data'
import { useFileDrop } from '@renderer/app/drop'
import { hud } from '@renderer/app/hud'
import { useMultiSelect } from '@renderer/app/selection'
import { Button, ConfirmSheet, EmptyState, GroupRow, IconButton } from '@renderer/ui'
import type { LibAsset2DPatch } from '@shared/api'
import {
  ASSET2D_CATEGORIES,
  type LibAsset2D,
  type MenuItemSpec,
  type Asset2DCategory,
  type Asset2DImportResult
} from '@shared/types'
import {
  Asset2DCard,
  Asset2DCategoryFilter,
  Asset2DInspector,
  Asset2DViewerSheet,
  asset2dMenuItems,
  handleAsset2DMenu,
  asset2dFields as fieldsOf,
  type Asset2DFilter
} from './Asset2DComponents'
import { LibraryToolbar, LoadError, ProjectLinks } from './common'
import './assets2d.css'
import { isCmdKey, isPlainKey, useMainKeys } from './keys'
import { matches, showError, useProjectsWhere } from './shared'

export type { Asset2DFilter } from './Asset2DComponents'

/** 导入结果的提示：已加入 N 个 · M 个已存在 · K 个没能导入（只有一个失败时说原因） */
export function reportAsset2DImport(r: Asset2DImportResult): void {
  const n = r.added.length
  const e = r.existing.length
  const s = r.skipped.length
  if (n === 0 && e === 0) {
    if (s > 0) hud.show(s === 1 ? `没能导入：${r.skipped[0].reason}` : `${s} 个都没能导入：${r.skipped[0].reason}`)
    return
  }
  if (n === 0) {
    const msg = e === 1 ? `「${r.existing[0].name}」已经在库里了` : `这 ${e} 个资产都已经在库里了`
    hud.show(s > 0 ? `${msg} · ${s} 个没能导入` : msg)
    return
  }
  const parts = [n === 1 ? `已加入「${r.added[0].name}」` : `已加入 ${n} 个资产`]
  if (e > 0) parts.push(`${e} 个已存在`)
  if (s > 0) parts.push(s === 1 ? `1 个没能导入：${r.skipped[0].reason}` : `${s} 个没能导入`)
  hud.show(parts.join(' · '), { ok: s === 0 })
}

export interface Assets2DTabProps {
  q: string
  onQ: (q: string) => void
  cat: Asset2DFilter
  onCat: (cat: Asset2DFilter) => void
}

/**
 * 全局库 · 2D 资产：照片式网格 + 右侧检查器。拖入图片、图集或资产文件夹，加号（⌘I）添加。
 * 单击选中（⌘ / ⇧ 多选）；双击、空格或 Enter 打开预览；右键菜单；Delete 移到废纸篓；可把文件夹拖出去。
 */
export function Assets2DTab({ q, onQ, cat, onCat }: Assets2DTabProps): React.JSX.Element {
  const assets = useLibAssets2D()
  const projects = useProjects()
  const [viewing, setViewing] = useState<string | null>(null)
  /** 等待确认移到废纸篓的那些资产 */
  const [trashing, setTrashing] = useState<LibAsset2D[] | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  const all = assets.data
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
  /** 选中的资产，按显示顺序 */
  const selected = useMemo(() => shown.filter((x) => sel.has(x.id)), [shown, sel])
  /** 检查器显示的那一个：单选时是它；什么都没选时默认第一个；多选时 null */
  const single: LibAsset2D | null =
    selected.length === 1 ? selected[0] : selected.length === 0 ? (shown[0] ?? null) : null
  /** 键盘、检查器按钮作用的对象 */
  const targets: LibAsset2D[] = selected.length > 0 ? selected : single ? [single] : []
  const viewAsset = all.find((x) => x.id === viewing) ?? null

  const usedIn = useProjectsWhere(single?.id ?? null, async (projectId) =>
    (await window.gp.projects.listAssets2D(projectId)).some((r) => r.asset2dId === single?.id)
  )

  // ---------- 导入：拖入、加号、⌘I；有资产落地返回 true ----------
  const runImport = async (paths?: string[]): Promise<boolean> => {
    let r: Asset2DImportResult
    try {
      r = await window.gp.library.importAssets2D(paths)
    } catch (err) {
      showError('添加失败', err)
      return false
    }
    reportAsset2DImport(r)
    let added = r.added
    const first = added[0] ?? r.existing[0]
    if (!first) return false
    // 正在看某个分类时，猜不出分类（其他）的新资产归到这个分类
    if (cat !== 'all') {
      added = await Promise.all(
        added.map((m) =>
          m.category === '其他' ? window.gp.library.updateAsset2D(m.id, { category: cat }).catch(() => m) : m
        )
      )
    }
    // 先放进缓存让新资产立刻看得见（等广播刷新会把选中项当成不存在而清掉）
    const ids = new Set(added.map((x) => x.id))
    if (ids.size > 0) assets.mutate((list) => [...added, ...list.filter((x) => !ids.has(x.id))])
    const target = added[0] ?? first
    if (cat !== 'all' && target.category !== cat) onCat('all')
    if (!matches(q, fieldsOf(target))) onQ('')
    sel.set(target.id)
    if (added.length > 0) mainRef.current?.scrollTo({ top: 0 })
    return true
  }

  useFileDrop((paths) => void runImport(paths), {
    label: '松手添加到 2D 资产库',
    hint: '图片、JSON 图集，或整个资产文件夹（含 asset.json 的 export 文件夹）',
    accept: () => true
  })
  useCommand('import-images', () => void runImport())

  // ---------- 打开、修改 ----------
  /** 打开预览：没选中的先选中它（已在多选里的不动） */
  const openView = (id: string): void => {
    if (!sel.has(id)) sel.set(id)
    setViewing(id)
  }

  const patchAsset2D = async (id: string, patch: LibAsset2DPatch): Promise<void> => {
    assets.mutate((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    if (patch.category && cat !== 'all' && patch.category !== cat) hud.show(`已移到「${patch.category}」`)
    try {
      const next = await window.gp.library.updateAsset2D(id, patch)
      assets.mutate((list) => list.map((x) => (x.id === next.id ? next : x)))
    } catch (err) {
      showError('没能保存', err)
      void assets.refresh()
    }
  }

  const setCategory = async (group: LibAsset2D[], category: Asset2DCategory): Promise<void> => {
    const todo = group.filter((x) => x.category !== category)
    if (todo.length === 0) return
    const ids = new Set(todo.map((x) => x.id))
    assets.mutate((list) => list.map((x) => (ids.has(x.id) ? { ...x, category } : x)))
    let failed = 0
    let lastErr: unknown = null
    for (const m of todo) {
      try {
        const next = await window.gp.library.updateAsset2D(m.id, { category })
        assets.mutate((list) => list.map((x) => (x.id === next.id ? next : x)))
      } catch (err) {
        failed++
        lastErr = err
      }
    }
    const ok = todo.length - failed
    if (failed === 0) hud.show(ok === 1 ? `已移到「${category}」` : `已把 ${ok} 个移到「${category}」`, { ok: true })
    else if (ok > 0) hud.show(`已把 ${ok} 个移到「${category}」· ${failed} 个没能保存`)
    else showError(`没能移到「${category}」`, lastErr)
    if (failed > 0) void assets.refresh()
  }

  const addToProject = async (group: LibAsset2D[], projectId: string, projectName: string): Promise<void> => {
    let added: number
    try {
      added = (
        await window.gp.projects.addAssets2D(
          projectId,
          group.map((x) => x.id)
        )
      ).length
    } catch (err) {
      showError(`没能添加到「${projectName}」`, err)
      return
    }
    const existing = group.length - added
    if (added === 0)
      hud.show(group.length === 1 ? `已经在「${projectName}」里了` : `这些资产已经在「${projectName}」里了`)
    else if (existing > 0) hud.show(`已添加 ${added} 个到「${projectName}」· ${existing} 个已经在里面`, { ok: true })
    else hud.show(`已添加 ${added} 个到「${projectName}」`, { ok: true })
  }

  const confirmTrash = async (): Promise<void> => {
    const group = trashing
    if (!group) return
    const gone = new Set<string>()
    let failed = 0
    let lastErr: unknown = null
    for (const m of group) {
      try {
        await window.gp.library.deleteAsset2D(m.id)
        gone.add(m.id)
      } catch (err) {
        failed++
        lastErr = err
      }
    }
    if (gone.size > 0) assets.mutate((list) => list.filter((x) => !gone.has(x.id)))
    if (viewing && gone.has(viewing)) setViewing(null)
    setTrashing(null)
    if (failed === 0) hud.show(gone.size === 1 ? '已移到废纸篓' : `已把 ${gone.size} 个移到废纸篓`, { ok: true })
    else if (gone.size > 0) hud.show(`已把 ${gone.size} 个移到废纸篓 · ${failed} 个失败`)
    else showError('没能移到废纸篓', lastErr)
  }

  // ---------- 右键菜单 ----------
  /** 右键没选中的资产：只对它；右键已选中的：对整组选中项 */
  const onContextMenu = async (e: ReactMouseEvent, m: LibAsset2D): Promise<void> => {
    const group = sel.has(m.id) ? selected : [m]
    if (!sel.has(m.id)) sel.set(m.id)
    const single = group.length === 1
    const projectList = projects.data
    const items: MenuItemSpec[] = [
      ...asset2dMenuItems(single, m),
      menuSeparator,
      {
        id: 'cat',
        label: '分类',
        submenu: ASSET2D_CATEGORIES.map((c) => ({
          id: `cat:${c}`,
          label: c,
          checked: group.every((x) => x.category === c)
        }))
      },
      {
        id: 'add',
        label: '添加到项目',
        enabled: projectList.length > 0,
        submenu: projectList.map((p) => ({ id: `prj:${p.id}`, label: p.name }))
      },
      menuSeparator,
      { id: 'trash', label: single ? '移到废纸篓' : `移到废纸篓 ${group.length} 个`, destructive: true }
    ]
    const picked = await showContextMenu(e, items)
    if (picked === null) return
    if (handleAsset2DMenu(picked, m, () => openView(m.id))) return
    if (picked === 'trash') setTrashing(group)
    else if (picked.startsWith('cat:')) {
      const c = ASSET2D_CATEGORIES.find((x) => picked === `cat:${x}`)
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
    } else if (isPlainKey(e, ' ', 'Enter')) {
      const first = targets[0]
      if (!first || e.shiftKey) return
      e.preventDefault()
      openView(first.id)
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

  let content: React.JSX.Element | null = null
  if (assets.error !== null && all.length === 0) {
    content = <LoadError error={assets.error} onRetry={() => void assets.refresh()} />
  } else if (assets.loading) {
    content = null
  } else if (all.length === 0) {
    content = (
      <EmptyState
        icon="grid"
        title="这里还没有 2D 资产"
        hint="把图片、JSON 图集或整个资产文件夹拖到这里。所有项目都能用。"
      >
        <Button icon="plus" onClick={() => void runImport()}>
          添加资产…
        </Button>
      </EmptyState>
    )
  } else if (shown.length === 0) {
    content = q.trim() ? (
      <EmptyState icon="search" title="没有找到资产" hint={`没有和“${q.trim()}”匹配的资产`} />
    ) : (
      <EmptyState icon="grid" title={`「${cat}」里还没有资产`} hint="在这个分类下添加的资产会归到这里">
        <Button icon="plus" onClick={() => void runImport()}>
          添加资产…
        </Button>
      </EmptyState>
    )
  } else {
    content = (
      <div className="a2d-grid">
        {shown.map((m) => (
          <Asset2DCard
            key={m.id}
            asset={m}
            selected={selected.length > 0 ? sel.has(m.id) : m.id === single?.id}
            onClick={(e) => sel.click(m.id, e)}
            onDoubleClick={() => openView(m.id)}
            onContextMenu={(e) => void onContextMenu(e, m)}
            onView={() => openView(m.id)}
          />
        ))}
      </div>
    )
  }

  const subtitle = assets.loading
    ? '所有项目共用'
    : `所有项目共用 · ${all.length} 个资产${sel.count > 1 ? ` · 已选 ${sel.count} 个` : ''}`

  return (
    <div className="screen a2d-screen">
      <LibraryToolbar
        subtitle={subtitle}
        q={q}
        onQ={onQ}
        placeholder="搜索资产、标签、动作"
        segment={<Asset2DCategoryFilter value={cat} onChange={onCat} />}
      >
        <IconButton icon="plus" label="添加 2D 资产" onClick={() => void runImport()} />
      </LibraryToolbar>
      <div className="screen-body">
        <main ref={mainRef} className="screen-main" tabIndex={0} aria-label="2D 资产">
          {content}
        </main>
        {all.length > 0 && (
          <Asset2DInspector
            asset={single}
            selection={selected}
            editable
            onPatch={(id, patch) => void patchAsset2D(id, patch)}
            onRemove={() => targets.length > 0 && setTrashing(targets)}
            removeLabel="移到废纸篓"
            onBatchCategory={(c) => void setCategory(selected, c)}
            onClearSelection={sel.clear}
            emptyText="没有符合条件的资产"
            extraRows={
              <GroupRow
                compact
                label="用于项目"
                value={<ProjectLinks projects={usedIn} tab="assets2d" none="还没用在项目里" />}
              />
            }
          />
        )}
      </div>
      <Asset2DViewerSheet asset={viewAsset} onClose={() => setViewing(null)} />
      <ConfirmSheet
        open={trashing !== null}
        title={
          trashing && trashing.length === 1
            ? `把「${trashing[0].name}」移到废纸篓？`
            : `把 ${trashing?.length ?? 0} 个资产移到废纸篓？`
        }
        message="整个资产文件夹会移到废纸篓，可以在访达里找回；用到它的项目会去掉这个资产。"
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setTrashing(null)}
        onConfirm={confirmTrash}
      />
    </div>
  )
}
