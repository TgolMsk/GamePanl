// 侧栏项目名那一行的右键菜单，以及「删除项目…」的二次确认。
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ProjectSummary } from '@shared/types'
import { dispatchCommand } from '../app/commands'
import { menuSeparator, showContextMenu } from '../app/contextMenu'
import { hud } from '../app/hud'
import { go, HOME_ROUTE, useNav } from '../app/nav'
import { ConfirmSheet } from '../ui/ConfirmSheet'

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

export function projectName(p: ProjectSummary): string {
  return p.name || '未命名项目'
}

/** 项目名右键：跳到三个页面 / 新建笔记 / 在访达中显示 / 删除（删除交给 askDelete 弹确认） */
export async function showProjectMenu(
  e: ReactMouseEvent,
  p: ProjectSummary,
  askDelete: (p: ProjectSummary) => void
): Promise<void> {
  const id = await showContextMenu(e, [
    { id: 'config', label: '配置' },
    { id: 'notes', label: '构思' },
    { id: 'assets', label: '资料' },
    menuSeparator,
    { id: 'new-note', label: '新建笔记' },
    { id: 'reveal', label: '在访达中显示项目文件夹' },
    menuSeparator,
    { id: 'remove', label: '删除项目…', destructive: true }
  ])
  if (id === null) return
  if (id === 'config' || id === 'notes' || id === 'assets') {
    go({ view: 'project', projectId: p.id, tab: id })
  } else if (id === 'new-note') {
    // 先到构思页，等界面挂载好再发「新建笔记」命令，由它新建并选中那条
    go({ view: 'project', projectId: p.id, tab: 'notes' })
    setTimeout(() => dispatchCommand('new-note'), 100)
  } else if (id === 'reveal') {
    try {
      await window.gp.projects.reveal(p.id)
    } catch (err) {
      hud.show(`打开失败：${errorText(err)}`)
    }
  } else if (id === 'remove') {
    askDelete(p)
  }
}

export interface DeleteProjectSheetProps {
  /** 要删的项目；null 时不显示 */
  project: ProjectSummary | null
  onClose: () => void
}

/** 「删除项目」确认：整个项目文件夹移到废纸篓；正看着这个项目时先回到全局库 */
export function DeleteProjectSheet({ project, onClose }: DeleteProjectSheetProps): React.JSX.Element {
  const remove = async (): Promise<void> => {
    if (!project) return
    const cur = useNav.getState().route
    if (cur.view === 'project' && cur.projectId === project.id) go(HOME_ROUTE)
    try {
      await window.gp.projects.remove(project.id)
      hud.show(`已把「${projectName(project)}」移到废纸篓`, { ok: true })
    } catch (err) {
      hud.show(`删除失败：${errorText(err)}`)
    }
    onClose()
  }

  return (
    <ConfirmSheet
      open={project !== null}
      title={project ? `删除项目「${projectName(project)}」？` : ''}
      message="整个项目文件夹会移到访达的废纸篓，可以找回。"
      confirmLabel="移到废纸篓"
      destructive
      onCancel={onClose}
      onConfirm={remove}
    />
  )
}
