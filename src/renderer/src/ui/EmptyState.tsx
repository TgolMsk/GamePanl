import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export interface EmptyStateProps {
  icon?: IconName
  title: ReactNode
  hint?: ReactNode
  /** 下方的按钮 */
  children?: ReactNode
  className?: string
}

/** 空状态：在父容器里上下左右居中（父容器要有高度） */
export function EmptyState({ icon, title, hint, children, className }: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cx('empty', className)}>
      {icon && (
        <span className="ic">
          <Icon name={icon} size={40} strokeWidth={1.4} />
        </span>
      )}
      <div className="et">{title}</div>
      {hint != null && <div className="eh">{hint}</div>}
      {children != null && <div className="ea">{children}</div>}
    </div>
  )
}
