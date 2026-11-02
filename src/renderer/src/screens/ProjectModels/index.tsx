import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useCommand } from '@renderer/app/commands'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useLibModels, useProject, useProjectModels } from '@renderer/app/data'
import { useFileDrop } from '@renderer/app/drop'
import { hud } from '@renderer/app/hud'
import { useMultiSelect } from '@renderer/app/selection'
import { copyForAI, handleModelMenu, modelMenuItems } from '@renderer/models/actions'
import { ModelCard } from '@renderer/models/ModelCard'
import { ModelInspector } from '@renderer/models/ModelInspector'
import { ModelPickerSheet } from '@renderer/models/ModelPickerSheet'
import { ModelViewerSheet } from '@renderer/models/ModelViewerSheet'
import { ensurePreviews } from '@renderer/models/previews'
import { isCmdKey, isPlainKey, useMainKeys } from '@renderer/screens/Library/keys'
import { reportImport, type ModelFilter } from '@renderer/screens/Library/ModelsTab'
import { matches, showError } from '@renderer/screens/Library/shared'
import { Button, EmptyState, SearchField, Segmented, Toolbar, type SegmentedOption } from '@renderer/ui'
import { MODEL_CATEGORIES, type ID, type LibModel, type ProjectModel } from '@shared/types'

const FILTERS: ReadonlyArray<SegmentedOption<ModelFilter>> = [
  { value: 'all', label: '全部' },
  ...MODEL_CATEGORIES.map((c) => ({ value: c, label: c }))
]

const fieldsOf = (m: LibModel): string[] => [m.name, m.id, m.category, ...m.tags, ...m.animations.map((a) => a.name)]

/**
 * 项目 · 3D 模型：只引用全局库里的模型（不复制文件）。从全局库添加，或把模型拖进来（先进全局库再加到项目）。
 * 单击选中；双击、空格打开 3D 预览；⌘C 复制给 AI；Delete 从项目移除（全局库里的不动）。
 */
export default function ProjectModelsScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useProject(projectId)
  const refs = useProjectModels(projectId)
  const lib = useLibModels()
  const name = project.data?.name ?? ''

  const [filter, setFilter] = useState<ModelFilter>('all')
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const [viewing, setViewing] = useState<{ id: ID; clip: string | null } | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  /** 本项目的模型（按加入顺序，新的在前） */
  const all = useMemo(() => {
    const byId = new Map(lib.data.map((m) => [m.id, m] as const))
    return refs.data.flatMap((r) => byId.get(r.modelId) ?? [])
  }, [refs.data, lib.data])
  useEffect(() => ensurePreviews(all), [all])
  const existing = useMemo(() => new Set(refs.data.map((r) => r.modelId)), [refs.data])
  const shown = useMemo(
    () => all.filter((m) => (filter === 'all' || m.category === filter) && matches(q, fieldsOf(m))),
    [all, filter, q]
  )
  const shownIds = useMemo(() => shown.map((m) => m.id), [shown])
  const sel = useMultiSelect(shownIds)
  const { retain } = sel
  useEffect(() => retain(shownIds), [retain, shownIds])
  const selected = useMemo(() => shown.filter((m) => sel.has(m.id)), [shown, sel])
  const single: LibModel | null = selected.length === 1 ? selected[0] : selected.length === 0 ? (shown[0] ?? null) : null
  const targets: LibModel[] = selected.length > 0 ? selected : single ? [single] : []
  const viewModel = all.find((m) => m.id === viewing?.id) ?? null

  const openView = (id: ID, clip: string | null = null): void => {
    if (!sel.has(id)) sel.set(id)
    setViewing({ id, clip })
  }

  /** 加进项目并选中第一个；返回是否成功 */
  const addModels = async (ids: ID[]): Promise<boolean> => {
    let added: ProjectModel[]
    try {
      added = await window.gp.projects.addModels(projectId, ids)
    } catch (err) {
      showError('添加失败', err)
      return false
    }
    // 先放进缓存，选中项才不会因为还没刷新而被清掉
    const fresh = new Set(added.map((r) => r.modelId))
    refs.mutate((list) => [...added, ...list.filter((r) => !fresh.has(r.modelId))])
    if (added.length > 0) hud.show(`已添加 ${added.length} 个到「${name}」`, { ok: true })
    else hud.show(ids.length === 1 ? '这个模型已经在项目里了' : '这些模型已经在项目里了')
    if (filter !== 'all') setFilter('all')
    setQ('')
    sel.set(ids[0])
    return true
  }

  // 拖进来的模型：先存进全局库，再引用到本项目
  const importAndAdd = async (paths?: string[]): Promise<void> => {
    try {
      const r = await window.gp.library.importModels(paths)
      const ids = [...r.added, ...r.existing].map((m) => m.id)
      const fresh = new Set(r.added.map((m) => m.id))
      if (fresh.size > 0) lib.mutate((list) => [...r.added, ...list.filter((m) => !fresh.has(m.id))])
      if (ids.length === 0) {
        reportImport(r)
        return
      }
      await addModels(ids)
    } catch (err) {
      showError('添加失败', err)
    }
  }

  useFileDrop((paths) => void importAndAdd(paths), {
    label: name ? `松手添加到「${name}」` : '松手添加',
    hint: '模型会先存进全局库，项目里只记引用',
    accept: () => true
  })
  useCommand('import-images', () => setPicking(true))

  const remove = async (group: LibModel[]): Promise<void> => {
    if (group.length === 0) return
    try {
      await window.gp.projects.removeModels(projectId, group.map((m) => m.id))
    } catch (err) {
      showError('没能移除', err)
      return
    }
    const gone = new Set(group.map((m) => m.id))
    refs.mutate((list) => list.filter((r) => !gone.has(r.modelId)))
    if (viewing && gone.has(viewing.id)) setViewing(null)
    sel.clear()
    hud.show(group.length === 1 ? `已从「${name}」移除「${group[0].name}」` : `已从「${name}」移除 ${group.length} 个`, {
      ok: true
    })
  }

  const onContextMenu = async (e: ReactMouseEvent, m: LibModel): Promise<void> => {
    const group = sel.has(m.id) && selected.length > 1 ? selected : [m]
    if (group.length === 1) sel.set(m.id)
    const picked = await showContextMenu(e, [
      ...modelMenuItems(group.length === 1),
      menuSeparator,
      { id: 'remove', label: group.length === 1 ? '从项目移除' : `从项目移除 ${group.length} 个` }
    ])
    if (picked === null || handleModelMenu(picked, m, () => openView(m.id))) return
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
    } else if (isCmdKey(e, 'c')) {
      if (targets.length !== 1 || document.getSelection()?.isCollapsed === false) return
      e.preventDefault()
      void copyForAI(targets[0])
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
      <EmptyState icon="cube" title="读不到模型" hint={refs.error}>
        <Button onClick={() => void refs.refresh()}>重试</Button>
      </EmptyState>
    )
  } else if (all.length === 0) {
    content = (
      <EmptyState icon="cube" title="还没有 3D 模型" hint="从全局库添加，或把 .glb / 资产文件夹拖到这里">
        <Button onClick={() => setPicking(true)}>从全局库添加</Button>
      </EmptyState>
    )
  } else if (shown.length === 0) {
    content = q.trim() ? (
      <EmptyState icon="search" title="没有找到模型" hint={`没有和“${q.trim()}”匹配的模型`} />
    ) : (
      <EmptyState icon="cube" title={`没有「${filter}」类的模型`} />
    )
  } else {
    content = (
      <div className="mdl-grid">
        {shown.map((m) => (
          <ModelCard
            key={m.id}
            model={m}
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

  const subtitle = `3D 模型 · ${all.length} 个${selected.length > 1 ? ` · 已选 ${selected.length} 个` : ''}`

  return (
    <div className="screen">
      <Toolbar title={name} subtitle={subtitle}>
        <Segmented ariaLabel="按分类显示" value={filter} onChange={setFilter} options={FILTERS} />
        <SearchField value={q} onChange={setQ} placeholder="搜索模型" />
        <Button onClick={() => setPicking(true)}>从全局库添加</Button>
      </Toolbar>
      <div className="screen-body">
        <main ref={mainRef} className="screen-main" tabIndex={0} aria-label="3D 模型">
          {content}
        </main>
        {all.length > 0 && (
          <ModelInspector
            model={single}
            selection={selected}
            editable={false}
            onView={(clip) => single && openView(single.id, clip ?? null)}
            onRemove={() => void remove(targets)}
            removeLabel="从项目移除"
            onClearSelection={sel.clear}
            emptyText="没有符合条件的模型"
          />
        )}
      </div>
      <ModelViewerSheet model={viewModel} clip={viewing?.clip} onClose={() => setViewing(null)} />
      <ModelPickerSheet
        open={picking}
        projectName={name}
        existing={existing}
        onClose={() => setPicking(false)}
        onAdd={async (ids) => {
          const ok = await addModels(ids)
          if (ok) setPicking(false)
          return ok
        }}
      />
    </div>
  )
}
