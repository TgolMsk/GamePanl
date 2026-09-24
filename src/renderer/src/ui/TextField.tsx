import { useState, type ComponentPropsWithRef, type KeyboardEvent } from 'react'
import { cx } from './cx'

export type TextFieldProps = ComponentPropsWithRef<'input'>

/** 单行输入框（.fld）：聚焦时强调色描边 + 聚焦环。其余属性原样传给 input */
export function TextField({ className, type = 'text', ...rest }: TextFieldProps): React.JSX.Element {
  return <input type={type} className={cx('fld', className)} autoComplete="off" {...rest} />
}

export interface TextAreaProps extends ComponentPropsWithRef<'textarea'> {
  /** 最少显示几行，默认 2 */
  minRows?: number
  /** 最多长到几行，超出后滚动；不给则一直长 */
  maxRows?: number
}

const LINE = 19.5 // 13px × 1.5
const PAD = 13 // 上下 padding 6 + 描边

/** 多行输入框，随内容自动增高 */
export function TextArea({ minRows = 2, maxRows, className, style, ...rest }: TextAreaProps): React.JSX.Element {
  return (
    <textarea
      className={cx('fld', className)}
      style={{
        minHeight: minRows * LINE + PAD,
        maxHeight: maxRows ? maxRows * LINE + PAD : undefined,
        ...style
      }}
      {...rest}
    />
  )
}

export interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  /** 方向键上下的步长，默认 1 */
  step?: number
  id?: string
  ariaLabel?: string
  className?: string
}

/** 整数输入框（50 宽，等宽字体）：回车或失去焦点时提交，超出范围自动夹紧，乱填恢复原值；↑↓ 加减 */
export function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  id,
  ariaLabel,
  className
}: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)))
  const commit = (): void => {
    if (draft === null) return
    const n = Number(draft.trim())
    setDraft(null)
    if (draft.trim() !== '' && Number.isFinite(n) && clamp(n) !== value) onChange(clamp(n))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      commit()
    } else if (e.key === 'Escape' && draft !== null) {
      e.stopPropagation()
      setDraft(null)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setDraft(null)
      const next = clamp(value + (e.key === 'ArrowUp' ? step : -step))
      if (next !== value) onChange(next)
    }
  }
  return (
    <input
      id={id}
      className={cx('fld num', className)}
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}
