import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

export interface TagProps {
  children: ReactNode
  /** 给了就在右侧显示 × 按钮 */
  onRemove?: () => void
  /** 读屏用的名称，默认取 children 文字 */
  label?: string
  size?: 'sm' | 'xs'
  className?: string
}

/** 灰色胶囊标签 */
export function Tag({ children, onRemove, label, size = 'sm', className }: TagProps): React.JSX.Element {
  const name = label ?? (typeof children === 'string' ? children : '')
  return (
    <span className={cx('tag', size === 'xs' && 'xs', className)}>
      {children}
      {onRemove && (
        <button type="button" className="x" aria-label={`移除标签「${name}」`} onClick={onRemove}>
          <Icon name="xmark" size={10} strokeWidth={2.2} />
        </button>
      )}
    </span>
  )
}

export interface TagEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
  /** 默认「添加标签」 */
  placeholder?: string
  className?: string
}

/** 标签编辑：回车添加（重复的忽略），× 或在空输入框里按删除键移除最后一个；输入法组词时不响应回车 */
export function TagEditor({ tags, onChange, placeholder = '添加标签', className }: TagEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') {
      e.preventDefault()
      const v = draft.trim()
      if (!v) return
      if (!tags.includes(v)) onChange([...tags, v])
      setDraft('')
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }
  return (
    <div className={cx('tok', className)} onClick={() => inputRef.current?.focus()}>
      {tags.map((t) => (
        <Tag key={t} onRemove={() => onChange(tags.filter((x) => x !== t))}>
          {t}
        </Tag>
      ))}
      <input
        ref={inputRef}
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
