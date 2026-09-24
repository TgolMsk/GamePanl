import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export interface SegmentedOption<T extends string> {
  value: T
  label?: ReactNode
  /** 只有图标没有文字时，title 必填（读屏和悬停提示） */
  icon?: IconName
  title?: string
}

export interface SegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  /** 整组的读屏名称，如「分类」「显示方式」 */
  ariaLabel: string
  className?: string
}

/** macOS 分段控件：灰底胶囊 + 白色选中块 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className
}: SegmentedProps<T>): React.JSX.Element {
  return (
    <div className={cx('seg', className)} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const iconOnly = !!o.icon && o.label == null
        return (
          <button
            key={o.value}
            type="button"
            className={cx(iconOnly && 'ico', o.value === value && 'on')}
            aria-pressed={o.value === value}
            aria-label={iconOnly ? o.title : undefined}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} size={15} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
