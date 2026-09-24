import './notes.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNotes, useProject } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import {
  Button,
  ConfirmSheet,
  EmptyState,
  IconButton,
  QuickLook,
  SearchField,
  Segmented,
  Toolbar,
  type SegmentedOption
} from '@renderer/ui'
import type { ImageRef, Note, NoteCategory } from '@shared/types'
import { useImageSource } from './images'
import { NoteEditor } from './NoteEditor'
import { NoteList } from './NoteList'
import {
  byUpdatedDesc,
  displayTitle,
  FILTER_CATEGORIES,
  groupNotes,
  isFilterCategory,
  matchesCategory,
  matchesQuery,
  replaceNote,
  type CategoryFilter
} from './noteUtil'
import { errorText, useNoteDraft } from './useNoteDraft'

const CATEGORY_OPTIONS: SegmentedOption<CategoryFilter>[] = [
  { value: 'all', label: '全部' },
  ...FILTER_CATEGORIES.map((c) => ({ value: c, label: c }))
]

/** 项目构思：笔记列表 + 编辑器（照备忘录） */
export default function ProjectNotesScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useProject(projectId)
  const notes = useNotes(projectId)
  const images = useImageSource(projectId)
  const { draft, edit, flush, enqueue, show } = useNoteDraft(projectId, notes)

  const [cat, setCat] = useState<CategoryFilter>('all')
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [newId, setNewId] = useState<string | null>(null)
  const [viewRef, setViewRef] = useState<ImageRef | null>(null)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const query = q.trim().toLowerCase()

  // 列表：缓存里的笔记换上正在编辑的草稿，按修改时间从新到旧
  const sorted = useMemo(
    () => (draft ? replaceNote(notes.data, draft) : [...notes.data]).sort(byUpdatedDesc),
    [notes.data, draft]
  )
  // 正在编辑的那条即使改得不再匹配搜索词，也留在列表里
  const visible = sorted.filter((n) => matchesCategory(n, cat) && (n.id === selId || matchesQuery(n, query)))
  const curId = visible.some((n) => n.id === selId) ? selId : (visible[0]?.id ?? null)
  const cached = useMemo(() => notes.data.find((n) => n.id === curId) ?? null, [notes.data, curId])
  const cur = draft && draft.id === curId ? draft : cached

  useEffect(() => {
    if (curId !== null && curId !== selId) setSelId(curId)
  }, [curId, selId])

  // 换了一条就先保存上一条，再把这条载入编辑区
  useEffect(() => show(cached), [cached, show])

  const firstMatch = (c: CategoryFilter, qq: string): string | null =>
    sorted.find((n) => matchesCategory(n, c) && matchesQuery(n, qq))?.id ?? null

  const changeQuery = (value: string): void => {
    setQ(value)
    const nq = value.trim().toLowerCase()
    if (!cur || !matchesQuery(cur, nq)) setSelId(firstMatch(cat, nq))
  }

  const changeCategoryFilter = (c: CategoryFilter): void => {
    setCat(c)
    if (!cur || !matchesCategory(cur, c) || !matchesQuery(cur, query)) setSelId(firstMatch(c, query))
  }

  const move = (delta: 1 | -1): void => {
    const i = visible.findIndex((n) => n.id === curId)
    const next = visible[Math.min(visible.length - 1, Math.max(0, i + delta))]
    if (next) setSelId(next.id)
  }

  const create = async (): Promise<void> => {
    flush()
    const category: NoteCategory = cat === 'all' ? '玩法' : cat
    try {
      const n = await enqueue(() => window.gp.projects.createNote(projectId, { category }))
      notes.mutate((list) => [n, ...list.filter((x) => x.id !== n.id)])
      setQ('')
      setNewId(n.id)
      setSelId(n.id)
    } catch (err) {
      hud.show(`新建笔记失败：${errorText(err)}`)
    }
  }

  const toggleDone = (n: Note): void => {
    if (draft && n.id === draft.id) {
      edit((x) => ({ ...x, done: !x.done }))
      flush()
      return
    }
    const next = { ...n, done: !n.done }
    notes.mutate((list) => replaceNote(list, next))
    enqueue(() => window.gp.projects.saveNote(projectId, next)).then(
      (saved) => notes.mutate((list) => replaceNote(list, saved)),
      (err: unknown) => {
        notes.mutate((list) => replaceNote(list, n))
        hud.show(`保存失败：${errorText(err)}`)
      }
    )
  }

  const changeCategory = (c: NoteCategory): void => {
    edit((x) => ({ ...x, category: c }))
    // 正在按分类筛选时跟过去，免得这条从列表里消失
    if (cat !== 'all' && c !== cat) setCat(isFilterCategory(c) ? c : 'all')
  }

  const remove = async (n: Note): Promise<void> => {
    flush()
    const i = visible.findIndex((x) => x.id === n.id)
    const next = visible[i + 1] ?? visible[i - 1] ?? null
    try {
      await enqueue(() => window.gp.projects.deleteNote(projectId, n.id))
      notes.mutate((list) => list.filter((x) => x.id !== n.id))
      setSelId(next?.id ?? null)
      hud.show(`已把「${displayTitle(n)}」移到废纸篓`, { ok: true })
    } catch (err) {
      hud.show(`删除失败：${errorText(err)}`)
    }
    setDeleting(null)
  }

  const onTitleSelected = useCallback(() => setNewId(null), [])

  const viewing = viewRef ? images.lookup(viewRef) : null
  const setViewingTags = (tags: string[]): void => {
    if (!viewing) return
    const r = viewing.ref
    const task = r.scope === 'library' ? window.gp.library.updateImage(r.id, { tags }) : window.gp.projects.updateAsset(projectId, r.id, { tags })
    task.catch((err: unknown) => hud.show(`标签保存失败：${errorText(err)}`))
  }

  const loaded = !notes.loading
  const empty = loaded && notes.data.length === 0

  let body: React.JSX.Element
  if (notes.error !== null && notes.data.length === 0) {
    body = (
      <main className="screen-main">
        <EmptyState icon="info" title="读不到笔记" hint={notes.error}>
          <Button onClick={() => void notes.refresh()}>重试</Button>
        </EmptyState>
      </main>
    )
  } else if (empty) {
    body = (
      <main className="screen-main">
        <EmptyState icon="bulb" title="还没有笔记" hint="玩法、故事、关卡的点子，随手记下来">
          <Button variant="primary" icon="compose" onClick={() => void create()}>
            新建笔记
          </Button>
        </EmptyState>
      </main>
    )
  } else {
    body = (
      <>
        <NoteList
          groups={groupNotes(visible)}
          curId={curId}
          emptyText={loaded ? (query ? `没有匹配“${q.trim()}”的笔记` : '这个分类还没有笔记') : null}
          onPick={setSelId}
          onToggle={toggleDone}
          onMove={move}
        />
        <main className="pn-editor">
          {cur ? (
            <NoteEditor
              key={cur.id}
              projectId={projectId}
              note={cur}
              images={images}
              selectTitle={cur.id === newId}
              onTitleSelected={onTitleSelected}
              edit={edit}
              onCategory={changeCategory}
              onToggleDone={() => toggleDone(cur)}
              onDelete={() => setDeleting(cur)}
              onView={setViewRef}
            />
          ) : (
            loaded && (
              <div className="pn-nosel">
                <span>没有选中的笔记</span>
                <Button onClick={() => void create()}>新建笔记</Button>
              </div>
            )
          )}
        </main>
      </>
    )
  }

  return (
    <div className="screen">
      <Toolbar title={project.data?.name ?? ''} subtitle={loaded ? `构思 · ${notes.data.length} 条笔记` : '构思'}>
        <Segmented ariaLabel="按分类显示" value={cat} onChange={changeCategoryFilter} options={CATEGORY_OPTIONS} />
        <SearchField value={q} onChange={changeQuery} placeholder="搜索" ariaLabel="搜索笔记" width={200} />
        <IconButton icon="compose" label="新建笔记" iconSize={18} onClick={() => void create()} />
      </Toolbar>
      <div className="screen-body">{body}</div>

      <QuickLook
        image={viewing?.look ?? null}
        onClose={() => setViewRef(null)}
        onTagsChange={setViewingTags}
        extraRows={viewing ? [{ label: '来源', value: viewing.source }] : undefined}
      />
      <ConfirmSheet
        open={deleting !== null}
        title={deleting ? `把「${displayTitle(deleting)}」移到废纸篓？` : ''}
        message="可以在访达的废纸篓里找回。"
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
    </div>
  )
}
