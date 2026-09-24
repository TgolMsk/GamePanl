import type { ComponentPropsWithRef } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

export interface ChipProps extends ComponentPropsWithRef<'button'> {
  /** 选中：强调色实心 */
  selected?: boolean
  /** 选中时文字前显示对勾，默认 true */
  check?: boolean
}

/** 可选中的胶囊（多选：类型、平台等） */
export function Chip({
  selected = false,
  check = true,
  className,
  type = 'button',
  children,
  ...rest
}: ChipProps): React.JSX.Element {
  return (
    <button type={type} className={cx('chip', selected && 'on', className)} aria-pressed={selected} {...rest}>
      {selected && check && <Icon name="check" size={12} strokeWidth={2.2} />}
      {children}
    </button>
  )
}
