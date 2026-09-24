import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx'

export interface GroupListProps {
  /** 分组上方的小标题（13px 粗体），如「基本」「分辨率和尺寸」 */
  title?: ReactNode
  children: ReactNode
  className?: string
  style?: CSSProperties
}

/** 系统设置式分组：白色圆角容器，行之间细线 */
export function GroupList({ title, children, className, style }: GroupListProps): React.JSX.Element {
  const group = (
    <div className={cx('group', title == null && className)} style={title == null ? style : undefined}>
      {children}
    </div>
  )
  if (title == null) return group
  return (
    <section className={cx('gsec', className)} style={style}>
      <div className="gh">{title}</div>
      {group}
    </section>
  )
}

export interface GroupRowProps {
  /** 左侧标签 */
  label?: ReactNode
  /** 标签关联的输入框 id（点标签聚焦输入框） */
  htmlFor?: string
  /** 只读值：右对齐的灰字。给了 value 就不用 children */
  value?: ReactNode
  /** 右侧控件 */
  children?: ReactNode
  /** 控件从标签右边开始向右铺开（多行胶囊、文本框），默认靠右对齐 */
  fill?: boolean
  /** 顶部对齐：控件有多行时用 */
  top?: boolean
  /** 紧凑行（高 34）：检查器、Quick Look 里用 */
  compact?: boolean
  /** 标签宽度，默认 120；compact 行默认按文字宽度 */
  labelWidth?: number | 'auto'
  className?: string
}

/** 分组里的一行：左标签右控件 */
export function GroupRow({
  label,
  htmlFor,
  value,
  children,
  fill,
  top,
  compact,
  labelWidth,
  className
}: GroupRowProps): React.JSX.Element {
  const width = labelWidth ?? (compact ? 'auto' : undefined)
  const labelStyle = width !== undefined ? { width } : undefined
  return (
    <div className={cx('rowi', top && 'top', compact && 'cmp', className)}>
      {label != null &&
        (htmlFor ? (
          <label className="k" htmlFor={htmlFor} style={labelStyle}>
            {label}
          </label>
        ) : (
          <span className="k" style={labelStyle}>
            {label}
          </span>
        ))}
      {value != null ? <span className="v">{value}</span> : <div className={cx('ctl', fill && 'fill')}>{children}</div>}
    </div>
  )
}
