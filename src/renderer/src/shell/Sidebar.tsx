import { Fragment, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { ProjectSummary } from '@shared/types'
import { useLibImages, useLibAssets2D, useLibModels, useProjects, usePrompts, useSpriteCharacters, useStyles } from '../app/data'
import { go, useNav, type LibraryTab, type ProjectTab } from '../app/nav'
import { cx } from '../ui/cx'
import { Icon, type IconName } from '../ui/Icon'
import { openNewProject } from './NewProjectSheet'
import { DeleteProjectSheet, projectName, showProjectMenu } from './ProjectContextMenu'
import { UpdateBanner } from './UpdateBanner'

interface NavItemProps {
  icon: IconName
  label: string
  count?: number
  on?: boolean
  sub?: boolean
  onClick: () => void
  onContextMenu?: (e: ReactMouseEvent<HTMLButtonElement>) => void
}

function NavItem({ icon, label, count, on, sub, onClick, onContextMenu }: NavItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx('nv', sub && 'sub', on && 'on')}
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="ic">
        <Icon name={icon} />
      </span>
      <span className="t">{label}</span>
      {count !== undefined && <span className="n">{count}</span>}
    </button>
  )
}

/** 还没读到（或第一次就读失败）时不显示数字 */
function countOf(r: { loading: boolean; error: string | null; data: readonly unknown[] }): number | undefined {
  return r.loading || (r.error !== null && r.data.length === 0) ? undefined : r.data.length
}

const LIBRARY_ITEMS: ReadonlyArray<{ tab: LibraryTab; icon: IconName; label: string }> = [
  { tab: 'images', icon: 'photo', label: '图片素材' },
  { tab: 'models', icon: 'cube', label: '3D 模型' },
  { tab: 'assets2d', icon: 'grid', label: '2D 资产' },
  { tab: 'sprites', icon: 'film', label: '序列帧' },
  { tab: 'prompts', icon: 'text', label: '提示词' },
  { tab: 'styles', icon: 'palette', label: '风格' }
]

/** 访达式侧栏：全局库六项 + 项目列表（当前项目展开出配置 / 构思 / 资料 / 3D 模型 / 2D 资产 / 序列帧）+ 新建项目 */
export function Sidebar(): React.JSX.Element {
  const route = useNav((s) => s.route)
  const lastProjectId = useNav((s) => s.lastProjectId)
  const images = useLibImages()
  const models = useLibModels()
  const assets2d = useLibAssets2D()
  const sprites = useSpriteCharacters(null)
  const prompts = usePrompts()
  const styles = useStyles()
  const projects = useProjects()
  // 右键「删除项目…」正在确认的那个
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)

  const counts: Record<LibraryTab, number | undefined> = {
    images: countOf(images),
    models: countOf(models),
    assets2d: countOf(assets2d),
    sprites: countOf(sprites),
    prompts: countOf(prompts),
    styles: countOf(styles)
  }
  // 在全局库时仍展开最近打开的项目
  const openId = route.view === 'project' ? route.projectId : lastProjectId
  const isOn = (projectId: string, tab: ProjectTab): boolean =>
    route.view === 'project' && route.projectId === projectId && route.tab === tab
  const goProject = (projectId: string, tab: ProjectTab): void => go({ view: 'project', projectId, tab })

  return (
    <nav className="sidebar" aria-label="侧栏">
      <div className="sidebar-top" />
      <div className="sidebar-list">
        <div className="sec">全局库</div>
        {LIBRARY_ITEMS.map((it) => (
          <NavItem
            key={it.tab}
            icon={it.icon}
            label={it.label}
            count={counts[it.tab]}
            on={route.view === 'library' && route.tab === it.tab}
            onClick={() => go({ view: 'library', tab: it.tab })}
          />
        ))}

        <div className="sec">项目</div>
        {projects.data.map((p) => (
          <Fragment key={p.id}>
            <NavItem
              icon="controller"
              label={projectName(p)}
              onClick={() => goProject(p.id, 'config')}
              onContextMenu={(e) => void showProjectMenu(e, p, setDeleting)}
            />
            {p.id === openId && (
              <>
                <NavItem
                  sub
                  icon="slider"
                  label="配置"
                  on={isOn(p.id, 'config')}
                  onClick={() => goProject(p.id, 'config')}
                />
                <NavItem
                  sub
                  icon="bulb"
                  label="构思"
                  count={p.noteCount}
                  on={isOn(p.id, 'notes')}
                  onClick={() => goProject(p.id, 'notes')}
                />
                <NavItem
                  sub
                  icon="stack"
                  label="资料"
                  count={p.assetCount}
                  on={isOn(p.id, 'assets')}
                  onClick={() => goProject(p.id, 'assets')}
                />
                <NavItem
                  sub
                  icon="cube"
                  label="3D 模型"
                  count={p.modelCount}
                  on={isOn(p.id, 'models')}
                  onClick={() => goProject(p.id, 'models')}
                />
                <NavItem
                  sub
                  icon="grid"
                  label="2D 资产"
                  count={p.asset2dCount}
                  on={isOn(p.id, 'assets2d')}
                  onClick={() => goProject(p.id, 'assets2d')}
                />
                <NavItem
                  sub
                  icon="film"
                  label="序列帧"
                  count={p.spriteCount}
                  on={isOn(p.id, 'sprites')}
                  onClick={() => goProject(p.id, 'sprites')}
                />
              </>
            )}
          </Fragment>
        ))}
        {!projects.loading && projects.error === null && projects.data.length === 0 && (
          <div className="sidebar-hint">还没有项目</div>
        )}
      </div>
      <UpdateBanner />
      <button type="button" className="nv new" onClick={openNewProject}>
        <span className="ic">
          <Icon name="plus" />
        </span>
        新建项目
      </button>
      <DeleteProjectSheet project={deleting} onClose={() => setDeleting(null)} />
    </nav>
  )
}
