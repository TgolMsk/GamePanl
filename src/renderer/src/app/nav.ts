// 导航：当前显示哪个界面。记住上次的位置（localStorage），下次启动回到那里。
import { create } from 'zustand'
import type { ID } from '@shared/types'

export type LibraryTab = 'images' | 'prompts' | 'styles'
export type ProjectTab = 'config' | 'notes' | 'assets'

export type Route =
  | { view: 'library'; tab: LibraryTab }
  | { view: 'project'; projectId: ID; tab: ProjectTab }
  | { view: 'welcome' }

/** window.__gpDev.go 接受的路由：tab 可省略；project 的 projectId 省略时取第一个项目 */
export type DevRoute =
  | { view: 'library'; tab?: LibraryTab }
  | { view: 'project'; projectId?: ID; tab?: ProjectTab }
  | { view: 'welcome' }

declare global {
  interface Window {
    /** 开发和测试用：直接跳到某个界面 */
    __gpDev: { go(route: DevRoute): Promise<Route> }
  }
}

interface NavState {
  route: Route
  /** 最近打开的项目：在全局库时侧栏仍展开它 */
  lastProjectId: ID | null
  go: (route: Route) => void
}

export const HOME_ROUTE: Route = { view: 'library', tab: 'images' }

const STORAGE_KEY = 'gamepanl.nav'
const LIBRARY_TABS: readonly string[] = ['images', 'prompts', 'styles']
const PROJECT_TABS: readonly string[] = ['config', 'notes', 'assets']

function parseRoute(value: unknown): Route | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  if (r.view === 'library' && typeof r.tab === 'string' && LIBRARY_TABS.includes(r.tab)) {
    return { view: 'library', tab: r.tab as LibraryTab }
  }
  if (
    r.view === 'project' &&
    typeof r.projectId === 'string' &&
    r.projectId !== '' &&
    typeof r.tab === 'string' &&
    PROJECT_TABS.includes(r.tab)
  ) {
    return { view: 'project', projectId: r.projectId, tab: r.tab as ProjectTab }
  }
  return null
}

function restore(): Pick<NavState, 'route' | 'lastProjectId'> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as {
      route?: unknown
      lastProjectId?: unknown
    } | null
    const route = parseRoute(saved?.route) ?? HOME_ROUTE
    const last = typeof saved?.lastProjectId === 'string' ? saved.lastProjectId : null
    return { route, lastProjectId: route.view === 'project' ? route.projectId : last }
  } catch {
    return { route: HOME_ROUTE, lastProjectId: null }
  }
}

function persist({ route, lastProjectId }: NavState): void {
  // 欢迎页只在首次启动时出现，不记住
  if (route.view === 'welcome') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ route, lastProjectId }))
  } catch {
    // 存不了只是下次不能回到这里，不影响使用
  }
}

export const useNav = create<NavState>((set, get) => ({
  ...restore(),
  go: (route) => {
    set({ route, lastProjectId: route.view === 'project' ? route.projectId : get().lastProjectId })
    persist(get())
  }
}))

/** 跳到某个界面（组件外也能用） */
export function go(route: Route): void {
  useNav.getState().go(route)
}

/** 当前路由（组件里用） */
export function useRoute(): Route {
  return useNav((s) => s.route)
}

async function resolveDevRoute(r: DevRoute): Promise<Route> {
  if (r.view === 'library') return { view: 'library', tab: r.tab ?? 'images' }
  if (r.view === 'welcome') return { view: 'welcome' }
  let projectId = r.projectId
  if (!projectId) {
    const list = await window.gp.projects.list()
    if (list.length === 0) throw new Error('还没有项目')
    projectId = list[0].id
  }
  return { view: 'project', projectId, tab: r.tab ?? 'config' }
}

export function installDevHooks(): void {
  window.__gpDev = {
    async go(r) {
      const route = await resolveDevRoute(r)
      go(route)
      return route
    }
  }
}
