import { useEffect, useState } from 'react'
import { useAppInfoSync } from './app/appInfo'
import { focusSearch, useCommand, useCommandSync } from './app/commands'
import { useLibImages, useProjects, usePrompts, useStyles } from './app/data'
import { go, HOME_ROUTE, useNav, useRoute, type Route } from './app/nav'
import { useUpdateSync } from './app/update'
import LibraryScreen from './screens/Library'
import ProjectAssetsScreen from './screens/ProjectAssets'
import ProjectConfigScreen from './screens/ProjectConfig'
import ProjectNotesScreen from './screens/ProjectNotes'
import { DropOverlay } from './shell/DropOverlay'
import { NewProjectSheet, openNewProject } from './shell/NewProjectSheet'
import { Sidebar } from './shell/Sidebar'
import { UpdateSheet } from './shell/UpdateSheet'
import { Welcome } from './shell/Welcome'
import { Hud } from './ui/Hud'

/**
 * 启动：等全局库和项目列表第一次读完再显示界面；
 * 全局库为空且没有项目（首次启动）时显示欢迎页。
 */
function useBoot(): boolean {
  const images = useLibImages()
  const prompts = usePrompts()
  const styles = useStyles()
  const projects = useProjects()
  const [booted, setBooted] = useState(false)
  const ready = !images.loading && !prompts.loading && !styles.loading && !projects.loading
  const firstRun = [images, prompts, styles, projects].every((r) => r.error === null && r.data.length === 0)

  useEffect(() => {
    if (booted || !ready) return
    if (firstRun) go({ view: 'welcome' })
    setBooted(true)
  }, [booted, ready, firstRun])

  return booted
}

/**
 * 当前项目不存在了（被删掉、或记住的是旧项目）就回到全局库。
 * 返回 true 表示当前项目不在列表里：这时先不显示项目界面，免得去读一个不存在的项目。
 */
function useProjectGuard(route: Route): boolean {
  const projects = useProjects()
  const projectId = route.view === 'project' ? route.projectId : null
  const missing =
    projectId !== null &&
    !projects.loading &&
    projects.error === null &&
    !projects.data.some((p) => p.id === projectId)
  const refreshProjects = projects.refresh

  useEffect(() => {
    if (!missing || projectId === null) return
    let cancelled = false
    // 缓存可能还没跟上（刚创建的项目），先向主进程确认一次
    window.gp.projects.list().then(
      (list) => {
        if (cancelled) return
        if (list.some((p) => p.id === projectId)) {
          void refreshProjects()
          return
        }
        const cur = useNav.getState().route
        if (cur.view === 'project' && cur.projectId === projectId) go(HOME_ROUTE)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [missing, projectId, refreshProjects])

  return missing
}

function Screen({ route }: { route: Route }): React.JSX.Element {
  switch (route.view) {
    case 'welcome':
      return <Welcome />
    case 'library':
      return <LibraryScreen tab={route.tab} />
    case 'project':
      // 换项目时整个界面重建，各界面不用自己处理 projectId 变化
      switch (route.tab) {
        case 'config':
          return <ProjectConfigScreen key={route.projectId} projectId={route.projectId} />
        case 'notes':
          return <ProjectNotesScreen key={route.projectId} projectId={route.projectId} />
        case 'assets':
          return <ProjectAssetsScreen key={route.projectId} projectId={route.projectId} />
      }
  }
}

export default function App(): React.JSX.Element {
  useAppInfoSync()
  useUpdateSync()
  useCommandSync()
  // 全局命令：⌘N 新建项目、⌘F 聚焦搜索框；新建笔记、添加图片由当前界面自己接
  useCommand('new-project', openNewProject)
  useCommand('find', () => void focusSearch())
  const route = useRoute()
  const booted = useBoot()
  const projectMissing = useProjectGuard(route)

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        {booted && !projectMissing ? <Screen route={route} /> : <div className="drag-strip" />}
        <DropOverlay />
      </div>
      <NewProjectSheet />
      <UpdateSheet />
      <Hud />
    </div>
  )
}
