import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useCommand } from '@renderer/app/commands'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useLibAssets2D, useProject, useProjectAssets2D } from '@renderer/app/data'
import { useFileDrop } from '@renderer/app/drop'
import { hud } from '@renderer/app/hud'
import { useMultiSelect } from '@renderer/app/selection'
import {
  Asset2DCard,
  Asset2DCategoryFilter,
  Asset2DInspector,
  Asset2DPickerSheet,
  Asset2DViewerSheet,
  asset2dMenuItems,
  handleAsset2DMenu,
  asset2dFields as fieldsOf,
  type Asset2DFilter
} from '@renderer/screens/Library/Asset2DComponents'
import '@renderer/screens/Library/assets2d.css'
import { isCmdKey, isPlainKey, useMainKeys } from '@renderer/screens/Library/keys'
import { reportAsset2DImport } from '@renderer/screens/Library/Assets2DTab'
import { matches, showError } from '@renderer/screens/Library/shared'
import { Button, EmptyState, SearchField, Toolbar } from '@renderer/ui'
import { type ID, type LibAsset2D, type ProjectAsset2D } from '@shared/types'

/**
 * 项目 · 2D 资产：只引用全局库里的资产（不复制文件）。从全局库添加，或把资产拖进来（先进全局库再加到项目）。
 * 单击选中；双击、空格打开预览；Delete 从项目移除（全局库里的不动）。
 */
export default function ProjectAssets2DScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useProject(projectId)
  const refs = useProjectAssets2D(projectId)
  const lib = useLibAssets2D()
  const name = project.data?.name ?? ''

  const [filter, setFilter] = useState<Asset2DFilter>('all')
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const [viewing, setViewing] = useState<ID | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  /** 本项目的资产（按加入顺序，新的在前） */
  const all = useMemo(() => {
    const byId = new Map(lib.data.map((m) => [m.id, m] as const))
    return refs.data.flatMap((r) => byId.get(r.asset2dId) ?? [])
  }, [refs.data, lib.data])
  const existing = useMemo(() => new Set(refs.data.map((r) => r.asset2dId)), [refs.data])
  const shown = useMemo(
    () => all.filter((m) => (filter === 'all' || m.category === filter) && matches(q, fieldsOf(m))),
    [all, filter, q]
  )
  const shownIds = useMemo(() => shown.map((m) => m.id), [shown])
  const sel = useMultiSelect(shownIds)
  const { retain } = sel
  useEffect(() => retain(shownIds), [retain, shownIds])
  const selected = useMemo(() => shown.filter((m) => sel.has(m.id)), [shown, sel])
  const single: LibAsset2D | null =
    selected.length === 1 ? selected[0] : selected.length === 0 ? (shown[0] ?? null) : null
  const targets: LibAsset2D[] = selected.length > 0 ? selected : single ? [single] : []
  const viewAsset = all.find((m) => m.id === viewing) ?? null

  const openView = (id: ID): void => {
    if (!sel.has(id)) sel.set(id)
    setViewing(id)
  }

  /** 加进项目并选中第一个；返回是否成功 */
  const addAssets2D = async (ids: ID[]): Promise<boolean> => {
    if (ids.length === 0) return false
    let added: ProjectAsset2D[]
    try {
      added = await window.gp.projects.addAssets2D(projectId, ids)
    } catch (err) {
      showError('添加失败', err)
      return false
    }
    // 先放进缓存，选中项才不会因为还没刷新而被清掉
    const fresh = new Set(added.map((r) => r.asset2dId))
    refs.mutate((list) => [...added, ...list.filter((r) => !fresh.has(r.asset2dId))])
    if (added.length > 0) hud.show(`已添加 ${added.length} 个到「${name}」`, { ok: true })
    else hud.show(ids.length === 1 ? '这个资产已经在项目里了' : '这些资产已经在项目里了')
    if (filter !== 'all') setFilter('all')
    setQ('')
    sel.set(ids[0])
    return true
  }

  // 拖进来的资产：先存进全局库，再引用到本项目
  const importAndAdd = async (paths?: string[]): Promise<void> => {
    try {
      const r = await window.gp.library.importAssets2D(paths)
      const ids = [...r.added, ...r.existing].map((m) => m.id)
      const fresh = new Set(r.added.map((m) => m.id))
      if (fresh.size > 0) lib.mutate((list) => [...r.added, ...list.filter((m) => !fresh.has(m.id))])
      if (ids.length === 0) {
        reportAsset2DImport(r)
        return
      }
      await addAssets2D(ids)
    } catch (err) {
      showError('添加失败', err)
    }
  }

  useFileDrop((paths) => void importAndAdd(paths), {
    label: name ? `松手添加到「${name}」` : '松手添加',
    hint: '资产会先存进全局库，项目里只记引用',
    accept: () => true
  })
  useCommand('import-images', () => setPicking(true))

  const remove = async (group: LibAsset2D[]): Promise<void> => {
    if (group.length === 0) return
    try {
      await window.gp.projects.removeAssets2D(
        projectId,
        group.map((m) => m.id)
      )
    } catch (err) {
      showError('没能移除', err)
      return
    }
    const gone = new Set(group.map((m) => m.id))
    refs.mutate((list) => list.filter((r) => !gone.has(r.asset2dId)))
    if (viewing && gone.has(viewing)) setViewing(null)
    sel.clear()
    hud.show(
      group.length === 1 ? `已从「${name}」移除「${group[0].name}」` : `已从「${name}」移除 ${group.length} 个`,
      {
        ok: true
      }
    )
  }

  const onContextMenu = async (e: ReactMouseEvent, m: LibAsset2D): Promise<void> => {
    const group = sel.has(m.id) && selected.length > 1 ? selected : [m]
    if (group.length === 1) sel.set(m.id)
    const picked = await showContextMenu(e, [
      ...asset2dMenuItems(group.length === 1, m),
      menuSeparator,
      { id: 'remove', label: group.length === 1 ? '从项目移除' : `从项目移除 ${group.length} 个` }
    ])
    if (picked === null || handleAsset2DMenu(picked, m, () => openView(m.id), projectId)) return
    if (picked === 'remove') void remove(group)
  }

  useMainKeys(mainRef, (e) => {
    if (isPlainKey(e, 'Backspace', 'Delete')) {
      if (selected.length === 0) return
      e.preventDefault()
      void remove(selected)
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

  let content: React.ReactNode = null
  if (refs.loading || lib.loading) {
    // 第一次读取中什么都不画，避免闪一下空状态
  } else if (refs.error !== null && refs.data.length === 0) {
    content = (
      <EmptyState icon="grid" title="读不到资产" hint={refs.error}>
        <Button onClick={() => void refs.refresh()}>重试</Button>
      </EmptyState>
    )
  } else if (lib.error !== null && lib.data.length === 0) {
    content = (
      <EmptyState icon="grid" title="读不到全局库" hint={lib.error}>
        <Button onClick={() => void lib.refresh()}>重试</Button>
      </EmptyState>
    )
  } else if (all.length === 0) {
    content = (
      <EmptyState icon="grid" title="还没有 2D 资产" hint="从全局库添加，或把图片、图集 / 资产文件夹拖到这里">
        <Button onClick={() => setPicking(true)}>从全局库添加</Button>
      </EmptyState>
    )
  } else if (shown.length === 0) {
    content = q.trim() ? (
      <EmptyState icon="search" title="没有找到资产" hint={`没有和“${q.trim()}”匹配的资产`} />
    ) : (
      <EmptyState icon="grid" title={`没有「${filter}」类的资产`} />
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

  const subtitle = `2D 资产 · ${all.length} 个${selected.length > 1 ? ` · 已选 ${selected.length} 个` : ''}`

  return (
    <div className="screen a2d-screen">
      <Toolbar title={name} subtitle={subtitle}>
        <Asset2DCategoryFilter value={filter} onChange={setFilter} />
        <SearchField value={q} onChange={setQ} placeholder="搜索资产" />
        <Button onClick={() => setPicking(true)}>从全局库添加</Button>
      </Toolbar>
      <div className="screen-body">
        <main ref={mainRef} className="screen-main" tabIndex={0} aria-label="2D 资产">
          {content}
        </main>
        {all.length > 0 && (
          <Asset2DInspector
            owner={projectId}
            asset={single}
            selection={selected}
            editable={false}
            onRemove={() => void remove(targets)}
            removeLabel="从项目移除"
            onClearSelection={sel.clear}
            emptyText="没有符合条件的资产"
          />
        )}
      </div>
      <Asset2DViewerSheet asset={viewAsset} onClose={() => setViewing(null)} />
      <Asset2DPickerSheet
        open={picking}
        projectName={name}
        existing={existing}
        onClose={() => setPicking(false)}
        onAdd={async (ids) => {
          const ok = await addAssets2D(ids)
          if (ok) setPicking(false)
          return ok
        }}
      />
    </div>
  )
}
