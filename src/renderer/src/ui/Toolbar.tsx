import type { ReactNode } from 'react'
import { cx } from './cx'

export interface ToolbarProps {
  title: ReactNode
  subtitle?: ReactNode
  /** 右侧的控件：分段控件、搜索框、图标按钮等 */
  children?: ReactNode
  className?: string
}

/**
 * 统一工具栏（高 52）：左边标题 + 副标题，右边放控件。
 * 整条可以拖动窗口；按钮、输入框、分段控件等交互元素自动排除在拖动区外。
 */
export function Toolbar({ title, subtitle, children, className }: ToolbarProps): React.JSX.Element {
  return (
    <header className={cx('toolbar', className)}>
      <div className="toolbar-title">
        <div className="tt">{title}</div>
        {subtitle != null && subtitle !== '' && <div className="ts">{subtitle}</div>}
      </div>
      <div className="toolbar-spacer" />
      {children}
    </header>
  )
}
