import { useId, type KeyboardEvent, type Ref } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  /** 默认「搜索」 */
  placeholder?: string
  /** 读屏名称，默认同 placeholder */
  ariaLabel?: string
  /** 默认 220 */
  width?: number | string
  autoFocus?: boolean
  ref?: Ref<HTMLInputElement>
  className?: string
}

/** 受控搜索框：有内容时显示清除按钮；Esc 清空（已经是空的就失去焦点） */
export function SearchField({
  value,
  onChange,
  placeholder = '搜索',
  ariaLabel,
  width,
  autoFocus,
  ref,
  className
}: SearchFieldProps): React.JSX.Element {
  const id = useId()
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
    if (value) {
      // 只清空，不让外层的 sheet 跟着关掉
      e.preventDefault()
      e.stopPropagation()
      onChange('')
    } else {
      e.currentTarget.blur()
    }
  }
  return (
    <div className={cx('search', className)} style={width !== undefined ? { width } : undefined}>
      <label htmlFor={id}>
        <Icon name="search" size={14} />
      </label>
      <input
        id={id}
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value !== '' && (
        <button
          type="button"
          className="clr"
          aria-label="清除搜索"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
        >
          <Icon name="xmark" size={9} strokeWidth={3} />
        </button>
      )}
    </div>
  )
}
