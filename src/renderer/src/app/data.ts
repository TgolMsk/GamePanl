// 数据钩子：通过 window.gp 读取数据，缓存在 zustand 里，同一份数据多处使用只请求一次。
// 主进程广播 onDataChanged 后按 kind 自动重新读取（正在显示的立即读，没在显示的等下次用到再读）。
import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import type { SpriteCharacter, SpriteOwner } from '@shared/sprites'
import type {
  DataChange,
  ID,
  LibImage,
  LibModel,
  LibAsset2D,
  Note,
  Project,
  ProjectAsset,
  ProjectModel,
  ProjectAsset2D,
  ProjectSummary,
  Prompt,
  Style
} from '@shared/types'

export interface Resource<T> {
  /** 数据；列表在第一次读到之前是空数组，单个对象是 undefined */
  data: T
  /** 第一次读取中（之后的自动刷新不会再变成 true，旧数据照常显示） */
  loading: boolean
  /** 最近一次读取失败的原因；成功后清空 */
  error: string | null
  /** 立即重新读取 */
  refresh: () => Promise<void>
  /** 直接改本地缓存（乐观更新）：接口返回新对象后写进来，界面不用等下一次刷新 */
  mutate: (next: T | ((prev: T) => T)) => void
}

interface Entry {
  data: unknown
  error: string | null
  stale: boolean
}

const useCache = create<Record<string, Entry>>(() => ({}))

const fetchers = new Map<string, () => Promise<unknown>>()
const watchers = new Map<string, number>()
const inflight = new Map<string, Promise<void>>()
const rerun = new Set<string>()

const EMPTY_ENTRY: Entry = { data: undefined, error: null, stale: false }

function patch(key: string, p: Partial<Entry>): void {
  useCache.setState((s) => ({ [key]: { ...(s[key] ?? EMPTY_ENTRY), ...p } }))
}

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // ipcRenderer.invoke 的报错带着 "Error invoking remote method 'x': Error: " 前缀，只留原因
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

function load(key: string): Promise<void> {
  const running = inflight.get(key)
  if (running) {
    // 读取中又有变化：读完后再读一次，拿到最新的
    rerun.add(key)
    return running
  }
  const fetcher = fetchers.get(key)
  if (!fetcher) return Promise.resolve()
  const task = (async () => {
    try {
      const data = await fetcher()
      patch(key, { data, error: null, stale: false })
    } catch (err) {
      patch(key, { error: errorText(err), stale: false })
    } finally {
      inflight.delete(key)
    }
    if (rerun.delete(key)) await load(key)
  })()
  inflight.set(key, task)
  return task
}

function invalidate(key: string): void {
  if (!useCache.getState()[key] && !inflight.has(key)) return
  if ((watchers.get(key) ?? 0) > 0) void load(key)
  else patch(key, { stale: true })
}

function useResource<T>(key: string, fetcher: () => Promise<T>, fallback: T): Resource<T> {
  const entry = useCache((s) => s[key])

  useEffect(() => {
    fetchers.set(key, fetcher)
    watchers.set(key, (watchers.get(key) ?? 0) + 1)
    const cur = useCache.getState()[key]
    if (!cur || cur.stale || cur.error !== null) void load(key)
    return () => {
      const n = (watchers.get(key) ?? 1) - 1
      if (n > 0) watchers.set(key, n)
      else watchers.delete(key)
    }
    // fetcher 由 key 唯一决定，key 不变就不用换
  }, [key])

  const refresh = useCallback(() => load(key), [key])
  const mutate = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = (useCache.getState()[key]?.data as T | undefined) ?? fallback
      const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      patch(key, { data: value })
    },
    // fallback 是模块级常量或 undefined，不会变
    [key]
  )

  return {
    data: (entry?.data as T | undefined) ?? fallback,
    loading: !entry || (entry.data === undefined && entry.error === null),
    error: entry?.error ?? null,
    refresh,
    mutate
  }
}

const NONE: never[] = []

const KEY = {
  libImages: 'library:images',
  prompts: 'library:prompts',
  styles: 'library:styles',
  models: 'library:models',
  libAssets2D: 'library:assets2d',
  projects: 'projects',
  project: (id: ID) => `project:${id}`,
  notes: (id: ID) => `notes:${id}`,
  assets: (id: ID) => `assets:${id}`,
  projectModels: (id: ID) => `models:${id}`,
  assets2d: (id: ID) => `assets2d:${id}`,
  sprites: (owner: SpriteOwner) => (owner === null ? 'library:sprites' : `sprites:${owner}`)
}

/** 全局库 · 图片素材 */
export function useLibImages(): Resource<LibImage[]> {
  return useResource(KEY.libImages, () => window.gp.library.listImages(), NONE)
}

/** 全局库 · 提示词 */
export function usePrompts(): Resource<Prompt[]> {
  return useResource(KEY.prompts, () => window.gp.library.listPrompts(), NONE)
}

/** 全局库 · 风格 */
export function useStyles(): Resource<Style[]> {
  return useResource(KEY.styles, () => window.gp.library.listStyles(), NONE)
}

/** 全局库 · 3D 模型 */
export function useLibModels(): Resource<LibModel[]> {
  return useResource(KEY.models, () => window.gp.library.listModels(), NONE)
}

/** 全局库 · 2D 资产 */
export function useLibAssets2D(): Resource<LibAsset2D[]> {
  return useResource(KEY.libAssets2D, () => window.gp.library.listAssets2D(), NONE)
}

/** 项目列表（含笔记数、资料数） */
export function useProjects(): Resource<ProjectSummary[]> {
  return useResource(KEY.projects, () => window.gp.projects.list(), NONE)
}

/** 一个项目的完整配置 */
export function useProject(id: ID): Resource<Project | undefined> {
  return useResource<Project | undefined>(KEY.project(id), () => window.gp.projects.get(id), undefined)
}

/** 一个项目的全部笔记 */
export function useNotes(projectId: ID): Resource<Note[]> {
  return useResource(KEY.notes(projectId), () => window.gp.projects.listNotes(projectId), NONE)
}

/** 一个项目引用的全局库模型 */
export function useProjectModels(projectId: ID): Resource<ProjectModel[]> {
  return useResource(KEY.projectModels(projectId), () => window.gp.projects.listModels(projectId), NONE)
}

/** 一个项目引用的全局库 2D 资产 */
export function useProjectAssets2D(projectId: ID): Resource<ProjectAsset2D[]> {
  return useResource(KEY.assets2d(projectId), () => window.gp.projects.listAssets2D(projectId), NONE)
}

/** 一个项目的全部资料图片 */
export function useAssets(projectId: ID): Resource<ProjectAsset[]> {
  return useResource(KEY.assets(projectId), () => window.gp.projects.listAssets(projectId), NONE)
}

/** 一个项目的序列帧角色；owner 为 null 时是全局库的 */
export function useSpriteCharacters(owner: SpriteOwner): Resource<SpriteCharacter[]> {
  return useResource(KEY.sprites(owner), () => window.gp.sprites.list(owner), NONE)
}

function keysFor(change: DataChange): string[] {
  switch (change.kind) {
    case 'library-images':
      return [KEY.libImages]
    case 'library-prompts':
      return [KEY.prompts]
    case 'library-styles':
      return [KEY.styles]
    case 'library-models':
      return [KEY.models]
    case 'library-assets2d':
      return [KEY.libAssets2D]
    case 'projects':
      return [KEY.projects]
    // 项目列表里有名称、封面和笔记数、资料数，这几类变化也要刷新列表
    case 'project':
      return [KEY.project(change.projectId), KEY.projects]
    case 'notes':
      return [KEY.notes(change.projectId), KEY.projects]
    case 'assets':
      return [KEY.assets(change.projectId), KEY.projects]
    case 'models':
      return [KEY.projectModels(change.projectId), KEY.projects]
    case 'assets2d':
      return [KEY.assets2d(change.projectId), KEY.projects]
    case 'sprites':
      return [KEY.sprites(change.projectId)]
  }
}

if (window.gp) {
  const off = window.gp.onDataChanged((change) => keysFor(change).forEach(invalidate))
  import.meta.hot?.dispose(off)
}
