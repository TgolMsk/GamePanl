import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { cx, Icon } from '@renderer/ui'
import { modelPreviewUrl } from '@shared/api'
import type { LibModel } from '@shared/types'
import { dragModelOut } from './actions'
import { cardMeta } from './format'

/** 还没有预览图（等着渲染）时不去请求 */
export const hasPreview = (m: LibModel): boolean => m.preview !== null || m.rendered

export interface ModelCardProps {
  model: LibModel
  selected?: boolean
  /** 缩略图最长边像素，默认 640 */
  thumb?: number
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void
  /** 给了才显示右上角的「3D 预览」按钮 */
  onView?: () => void
}

/** 模型卡片：预览图 + 名称 + 面数 / 动作数；单击选中，双击 3D 预览，右键菜单，可以把整个文件夹拖出去 */
export function ModelCard({ model, selected, thumb = 640, onClick, onDoubleClick, onContextMenu, onView }: ModelCardProps): React.JSX.Element {
  const src = modelPreviewUrl(model, thumb)
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const anims = model.animations.length
  return (
    <div className={cx('card', 'mdl-card', selected && 'sel')} data-id={model.id} onContextMenu={onContextMenu}>
      <button
        type="button"
        className="hit"
        aria-label={model.name}
        title="双击或按空格 3D 预览 · 可以拖到访达或游戏项目里"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        draggable
        onDragStart={(e) => dragModelOut(e, model)}
      >
        <span className="frame mdl-frame" style={{ aspectRatio: '4 / 3' }}>
          {!hasPreview(model) || brokenSrc === src ? (
            <span className="ph">
              <Icon name="cube" size={30} strokeWidth={1.2} />
            </span>
          ) : (
            <img src={src} alt={model.name} loading="lazy" decoding="async" draggable={false} onError={() => setBrokenSrc(src)} />
          )}
          {anims > 0 && (
            <span className="mdl-badge" title={`${anims} 个动作`}>
              <Icon name="play" size={9} strokeWidth={2.4} />
              {anims}
            </span>
          )}
        </span>
        <span className="cap">{model.name}</span>
        <span className="meta">{cardMeta(model)}</span>
      </button>
      {onView && (
        <button type="button" className="eye" aria-label="3D 预览" title="3D 预览（空格）" onClick={onView}>
          <Icon name="cube" size={15} />
        </button>
      )}
    </div>
  )
}
