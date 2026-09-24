import { usePageDropOverlay } from '../app/drop'
import { Icon } from '../ui/Icon'

/** 文件拖进窗口、当前页面接收拖入时，盖在主区上的「松手添加」遮罩 */
export function DropOverlay(): React.JSX.Element | null {
  const overlay = usePageDropOverlay()
  if (!overlay) return null
  return (
    <div className="drop on drop-overlay" aria-hidden="true">
      <span className="ic">
        <Icon name="photo" size={40} strokeWidth={1.4} />
      </span>
      <div className="dt">{overlay.label}</div>
      <div className="lbl">{overlay.hint}</div>
    </div>
  )
}
