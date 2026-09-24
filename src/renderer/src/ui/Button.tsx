import type { ComponentPropsWithRef } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'default' | 'primary' | 'plain' | 'danger'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** default 白底描边；primary 强调色实心；plain 无底强调色文字；danger 红色实心（确认删除） */
  variant?: ButtonVariant
  /** sm 高 24、字号 12；默认高 28 */
  size?: 'sm' | 'md'
  /** 文字前的图标 */
  icon?: IconName
}

const VARIANT_CLASS: Record<ButtonVariant, string | null> = {
  default: null,
  primary: 'pri',
  plain: 'plain',
  danger: 'danger'
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button type={type} className={cx('btn', VARIANT_CLASS[variant], size === 'sm' && 'sm', className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 14} />}
      {children}
    </button>
  )
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  icon: IconName
  /** 读屏文字和悬停提示，必填 */
  label: string
  /** 开关型按钮的按下状态（给了才有 aria-pressed） */
  active?: boolean
  iconSize?: number
}

/** 工具栏里的无边框图标按钮（30×28） */
export function IconButton({
  icon,
  label,
  active,
  iconSize = 16,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={cx('tbtn', active && 'on', className)}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )
}
