import { cx } from './cx'
import { Icon } from './Icon'

export interface SelectOption<T extends string> {
  value: T
  label?: string
}

export interface SelectProps<T extends string> {
  value: T
  /** 直接给字符串数组也行：['5–10 分钟', '20–40 分钟'] */
  options: ReadonlyArray<T | SelectOption<T>>
  onChange: (value: T) => void
  /** default 白底描边（高 24）；fill 灰底无边（高 26，系统设置里的弹出按钮） */
  variant?: 'default' | 'fill'
  /** 当前值不在选项里时显示的占位文字（如「未设置」） */
  placeholder?: string
  id?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

/** 系统样式弹出菜单：用原生 select，点开就是 macOS 菜单 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  variant = 'default',
  placeholder,
  id,
  ariaLabel,
  disabled,
  className
}: SelectProps<T>): React.JSX.Element {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value }))
  const known = items.some((o) => o.value === value)
  return (
    <span className={cx('popw', variant === 'fill' && 'fill', className)}>
      <select
        id={id}
        value={value}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {!known && (
          <option value={value} disabled>
            {placeholder ?? value}
          </option>
        )}
        {items.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron.up.down" size={12} strokeWidth={2} />
    </span>
  )
}
