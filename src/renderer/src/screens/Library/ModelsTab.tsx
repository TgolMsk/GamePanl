import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useCommand } from '@renderer/app/commands'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useLibModels, useProjects } from '@renderer/app/data'
import { useFileDrop } from '@renderer/app/drop'
import { hud } from '@renderer/app/hud'
import { useMultiSelect } from '@renderer/app/selection'
import { copyForAI, handleModelMenu, modelMenuItems } from '@renderer/models/actions'
import { ModelCard } from '@renderer/models/ModelCard'
import { ModelInspector } from '@renderer/models/ModelInspector'
import { ModelViewerSheet } from '@renderer/models/ModelViewerSheet'
import { GenerateSheet } from '@renderer/models/GenerateSheet'
import { ensurePreviews } from '@renderer/models/previews'
import { Button, ConfirmSheet, EmptyState, GroupRow, IconButton, Segmented, type SegmentedOption } from '@renderer/ui'
import type { LibModelPatch } from '@shared/api'
import { MODEL_CATEGORIES, type LibModel, type MenuItemSpec, type ModelCategory, type ModelImportResult } from '@shared/types'
import { LibraryToolbar, LoadError, ProjectLinks } from './common'
import { isCmdKey, isPlainKey, useMainKeys } from './keys'
import { matches, showError, useProjectsWhere } from './shared'

export type ModelFilter = 'all' | ModelCategory

const FILTERS: ReadonlyArray<SegmentedOption<ModelFilter>> = [
  { value: 'all', label: '全部' },
  ...MODEL_CATEGORIES.map((c) => ({ value: c, label: c }))
]

const fieldsOf = (m: LibModel): string[] => [m.name, m.id, m.category, m.version, ...m.tags, ...m.animations.map((a) => a.name)]

/** 导入结果的提示：已加入 N 个 · M 个已存在 · K 个没能导入（只有一个失败时说原因） */
export function reportImport(r: ModelImportResult): void {
  const n = r.added.length
  const e = r.existing.length
  const s = r.skipped.length
  if (n === 0 && e === 0) {
    if (s > 0) hud.show(s === 1 ? `没能导入：${r.skipped[0].reason}` : `${s} 个都没能导入：${r.skipped[0].reason}`)
    return
  }
  if (n === 0) {
    const msg = e === 1 ? `「${r.existing[0].name}」已经在库里了` : `这 ${e} 个模型都已经在库里了`
    hud.show(s > 0 ? `${msg} · ${s} 个没能导入` : msg)
    return
  }
  const parts = [n === 1 ? `已加入「${r.added[0].name}」` : `已加入 ${n} 个模型`]
  if (e > 0) parts.push(`${e} 个已存在`)
  if (s > 0) parts.push(s === 1 ? `1 个没能导入：${r.skipped[0].reason}` : `${s} 个没能导入`)
  hud.show(parts.join(' · '), { ok: s === 0 })
}

export interface ModelsTabProps {
  q: string
  onQ: (q: string) => void
  cat: ModelFilter
  onCat: (cat: ModelFilter) => void
}

/**
 * 全局库 · 3D 模型：照片式网格 + 右侧检查器。拖入 .glb / .gltf 或资产文件夹、加号（⌘I）添加。
 * 单击选中（⌘ / ⇧ 多选）；双击、空格或 Enter 打开 3D 预览；⌘C 复制给 AI；右键菜单；Delete 移到废纸篓；可把文件夹拖出去。
 */
export function ModelsTab({ q, onQ, cat, onCat }: ModelsTabProps): React.JSX.Element {
  const models = useLibModels()
  const projects = useProjects()
  const [viewing, setViewing] = useState<{ id: string; clip: string | null } | null>(null)
  /** 等待确认移到废纸篓的那些模型 */
  const [trashing, setTrashing] = useState<LibModel[] | null>(null)
  const [generating, setGenerating] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  const all = models.data
  useEffect(() => ensurePreviews(all), [all])
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
  /** 选中的模型，按显示顺序 */
  const selected = useMemo(() => shown.filter((x) => sel.has(x.id)), [shown, sel])
  /** 检查器显示的那一个：单选时是它；什么都没选时默认第一个；多选时 null */
  const single: LibModel | null = selected.length === 1 ? selected[0] : selected.length === 0 ? (shown[0] ?? null) : null
  /** 键盘、检查器按钮作用的对象 */
  const targets: LibModel[] = selected.length > 0 ? selected : single ? [single] : []
  const viewModel = all.find((x) => x.id === viewing?.id) ?? null

  const usedIn = useProjectsWhere(single?.id ?? null, async (projectId) =>
    (await window.gp.projects.listModels(projectId)).some((r) => r.modelId === single?.id)
  )

  // ---------- 导入：拖入、加号、⌘I、生成面板的「导入结果」；有模型落地返回 true ----------
  const runImport = async (paths?: string[]): Promise<boolean> => {
    let r: ModelImportResult
    try {
      r = await window.gp.library.importModels(paths)
    } catch (err) {
      showError('添加失败', err)
      return false
    }
    reportImport(r)
    let added = r.added
    const first = added[0] ?? r.existing[0]
    if (!first) return false
    // 正在看某个分类时，猜不出分类（其他）的新模型归到这个分类
    if (cat !== 'all') {
      added = await Promise.all(
        added.map((m) => (m.category === '其他' ? window.gp.library.updateModel(m.id, { category: cat }).catch(() => m) : m))
      )
    }
    // 先放进缓存让新模型立刻看得见（等广播刷新会把选中项当成不存在而清掉）
    const ids = new Set(added.map((x) => x.id))
    if (ids.size > 0) models.mutate((list) => [...added, ...list.filter((x) => !ids.has(x.id))])
    const target = added[0] ?? first
    if (cat !== 'all' && target.category !== cat) onCat('all')
    if (!matches(q, fieldsOf(target))) onQ('')
    sel.set(target.id)
    if (added.length > 0) mainRef.current?.scrollTo({ top: 0 })
    return true
  }

  useFileDrop((paths) => void runImport(paths), {
    label: '松手添加到 3D 模型库',
    hint: '.glb / .gltf，或整个资产文件夹（含 asset.json 的 export 文件夹）',
    accept: () => true
  })
  useCommand('import-images', () => void runImport())

  // ---------- 打开、修改 ----------
  /** 打开 3D 预览：没选中的先选中它（已在多选里的不动） */
  const openView = (id: string, clip: string | null = null): void => {
    if (!sel.has(id)) sel.set(id)
    setViewing({ id, clip })
  }

  const patchModel = async (id: string, patch: LibModelPatch): Promise<void> => {
    models.mutate((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    if (patch.category && cat !== 'all' && patch.category !== cat) hud.show(`已移到「${patch.category}」`)
    try {
      const next = await window.gp.library.updateModel(id, patch)
      models.mutate((list) => list.map((x) => (x.id === next.id ? next : x)))
    } catch (err) {
      showError('没能保存', err)
      void models.refresh()
    }
  }

  const setCategory = async (group: LibModel[], category: ModelCategory): Promise<void> => {
    const todo = group.filter((x) => x.category !== category)
    if (todo.length === 0) return
    const ids = new Set(todo.map((x) => x.id))
    models.mutate((list) => list.map((x) => (ids.has(x.id) ? { ...x, category } : x)))
    let failed = 0
    let lastErr: unknown = null
    for (const m of todo) {
      try {
        const next = await window.gp.library.updateModel(m.id, { category })
        models.mutate((list) => list.map((x) => (x.id === next.id ? next : x)))
      } catch (err) {
        failed++
        lastErr = err
      }
    }
    const ok = todo.length - failed
    if (failed === 0) hud.show(ok === 1 ? `已移到「${category}」` : `已把 ${ok} 个移到「${category}」`, { ok: true })
    else if (ok > 0) hud.show(`已把 ${ok} 个移到「${category}」· ${failed} 个没能保存`)
    else showError(`没能移到「${category}」`, lastErr)
    if (failed > 0) void models.refresh()
  }

  const addToProject = async (group: LibModel[], projectId: string, projectName: string): Promise<void> => {
    let added: number
    try {
      added = (await window.gp.projects.addModels(projectId, group.map((x) => x.id))).length
    } catch (err) {
      showError(`没能添加到「${projectName}」`, err)
      return
    }
    const existing = group.length - added
    if (added === 0) hud.show(group.length === 1 ? `已经在「${projectName}」里了` : `这些模型已经在「${projectName}」里了`)
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
        await window.gp.library.deleteModel(m.id)
        gone.add(m.id)
      } catch (err) {
        failed++
        lastErr = err
      }
    }
    if (gone.size > 0) models.mutate((list) => list.filter((x) => !gone.has(x.id)))
    if (viewing && gone.has(viewing.id)) setViewing(null)
    setTrashing(null)
    if (failed === 0) hud.show(gone.size === 1 ? '已移到废纸篓' : `已把 ${gone.size} 个移到废纸篓`, { ok: true })
    else if (gone.size > 0) hud.show(`已把 ${gone.size} 个移到废纸篓 · ${failed} 个失败`)
    else showError('没能移到废纸篓', lastErr)
  }

  // ---------- 右键菜单 ----------
  /** 右键没选中的模型：只对它；右键已选中的：对整组选中项 */
  const onContextMenu = async (e: ReactMouseEvent, m: LibModel): Promise<void> => {
    const group = sel.has(m.id) ? selected : [m]
    if (!sel.has(m.id)) sel.set(m.id)
    const single = group.length === 1
    const projectList = projects.data
    const items: MenuItemSpec[] = [
      ...modelMenuItems(single),
      menuSeparator,
      {
        id: 'cat',
        label: '分类',
        submenu: MODEL_CATEGORIES.map((c) => ({ id: `cat:${c}`, label: c, checked: group.every((x) => x.category === c) }))
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
    if (handleModelMenu(picked, m, () => openView(m.id))) return
    if (picked === 'trash') setTrashing(group)
    else if (picked.startsWith('cat:')) {
      const c = MODEL_CATEGORIES.find((x) => picked === `cat:${x}`)
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

  let content: React.JSX.Element | null = null
  if (models.error !== null && all.length === 0) {
    content = <LoadError error={models.error} onRetry={() => void models.refresh()} />
  } else if (models.loading) {
    content = null
  } else if (all.length === 0) {
    content = (
      <EmptyState
        icon="cube"
        title="这里还没有 3D 模型"
        hint="把 .glb / .gltf 或整个资产文件夹（含 asset.json）拖到这里。所有项目都能用。"
      >
        <Button icon="plus" onClick={() => void runImport()}>
          添加模型…
        </Button>
        <Button icon="sparkles" onClick={() => setGenerating(true)}>
          用 Claude Code 生成…
        </Button>
      </EmptyState>
    )
  } else if (shown.length === 0) {
    content = q.trim() ? (
      <EmptyState icon="search" title="没有找到模型" hint={`没有和“${q.trim()}”匹配的模型`} />
    ) : (
      <EmptyState icon="cube" title={`「${cat}」里还没有模型`} hint="在这个分类下添加的模型会归到这里">
        <Button icon="plus" onClick={() => void runImport()}>
          添加模型…
        </Button>
      </EmptyState>
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

  const subtitle = models.loading
    ? '所有项目共用'
    : `所有项目共用 · ${all.length} 个模型${sel.count > 1 ? ` · 已选 ${sel.count} 个` : ''}`

  return (
    <div className="screen">
      <LibraryToolbar
        subtitle={subtitle}
        q={q}
        onQ={onQ}
        placeholder="搜索模型、标签、动作"
        segment={<Segmented className="lib-cats" ariaLabel="按分类显示" value={cat} onChange={onCat} options={FILTERS} />}
      >
        <IconButton icon="sparkles" label="用 Claude Code 生成…" onClick={() => setGenerating(true)} />
        <IconButton icon="plus" label="添加 3D 模型" onClick={() => void runImport()} />
      </LibraryToolbar>
      <div className="screen-body">
        <main ref={mainRef} className="screen-main" tabIndex={0} aria-label="3D 模型">
          {content}
        </main>
        {all.length > 0 && (
          <ModelInspector
            model={single}
            selection={selected}
            editable
            onPatch={(id, patch) => void patchModel(id, patch)}
            onView={(clip) => single && openView(single.id, clip ?? null)}
            onRemove={() => targets.length > 0 && setTrashing(targets)}
            removeLabel="移到废纸篓"
            onBatchCategory={(c) => void setCategory(selected, c)}
            onClearSelection={sel.clear}
            emptyText="没有符合条件的模型"
            extraRows={
              <GroupRow compact label="用于项目" value={<ProjectLinks projects={usedIn} tab="models" none="还没用在项目里" />} />
            }
          />
        )}
      </div>
      <ModelViewerSheet model={viewModel} clip={viewing?.clip} onClose={() => setViewing(null)} />
      <GenerateSheet
        open={generating}
        onClose={() => setGenerating(false)}
        category={cat === 'all' ? '角色' : cat}
        onImport={runImport}
      />
      <ConfirmSheet
        open={trashing !== null}
        title={
          trashing && trashing.length === 1 ? `把「${trashing[0].name}」移到废纸篓？` : `把 ${trashing?.length ?? 0} 个模型移到废纸篓？`
        }
        message="整个模型文件夹会移到废纸篓，可以在访达里找回；用到它的项目会去掉这个模型。"
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setTrashing(null)}
        onConfirm={confirmTrash}
      />
    </div>
  )
}
