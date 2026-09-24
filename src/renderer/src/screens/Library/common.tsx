// 全局库各 tab 共用的界面片段：工具栏、读取失败、「用于项目」链接。
import type { ReactNode } from 'react'
import { go, type ProjectTab } from '@renderer/app/nav'
import { Button, EmptyState, Icon, SearchField, Toolbar } from '@renderer/ui'
import type { ProjectSummary } from '@shared/types'

export interface LibraryToolbarProps {
  subtitle: string
  q: string
  onQ: (q: string) => void
  placeholder: string
  /** 搜索框前面：本 tab 的分类分段控件 */
  segment?: ReactNode
  /** 搜索框后面：显示方式、加号 */
  children?: ReactNode
}

/** 全局库的工具栏：标题「全局库」+ 副标题，右边分类、搜索框和本 tab 的按钮 */
export function LibraryToolbar({ subtitle, q, onQ, placeholder, segment, children }: LibraryToolbarProps): React.JSX.Element {
  return (
    <Toolbar className="lib-toolbar" title="全局库" subtitle={subtitle}>
      {segment}
      <SearchField className="lib-search" value={q} onChange={onQ} placeholder={placeholder} />
      {children}
    </Toolbar>
  )
}

/** 第一次读取就失败时 */
export function LoadError({ error, onRetry }: { error: string; onRetry: () => void }): React.JSX.Element {
  return (
    <EmptyState icon="info" title="读取失败" hint={error}>
      <Button onClick={onRetry}>重试</Button>
    </EmptyState>
  )
}

/** 「用于项目」：项目名链接，点了跳到那个项目；还没查完时空着 */
export function ProjectLinks({
  projects,
  tab,
  none
}: {
  projects: ProjectSummary[] | null
  tab: ProjectTab
  none: string
}): React.JSX.Element | null {
  if (projects === null) return null
  if (projects.length === 0) return <>{none}</>
  return (
    <span className="lib-plinks">
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          className="lib-plink"
          onClick={() => go({ view: 'project', projectId: p.id, tab })}
        >
          <Icon name="controller" size={14} strokeWidth={1.8} />
          {p.name}
        </button>
      ))}
    </span>
  )
}
