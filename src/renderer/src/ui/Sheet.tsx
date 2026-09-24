import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SheetDepthContext, isTopSheet, popSheet, pushSheet, useSheetDepth } from '../app/sheetStack'
import { IconButton } from './Button'
import { cx } from './cx'

export interface SheetProps {
  open: boolean
  /** 点遮罩、按 Esc、点右上角关闭按钮时调用 */
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  /** 默认 520 */
  width?: number | string
  /** 不给则按内容撑开（最高不超过窗口） */
  height?: number | string
  /** 标题栏右侧、关闭按钮前的内容（如搜索框） */
  accessory?: ReactNode
  /** 标题栏右上角的关闭按钮，默认显示 */
  closeButton?: boolean
  /** 底部按钮栏（高 60）；不给就没有 */
  footer?: ReactNode
  children?: ReactNode
  /** 内容区默认 padding 20、超出滚动；需要改就传 className / style */
  bodyClassName?: string
  bodyStyle?: CSSProperties
  /** 标题不是纯文字时，给读屏用的名称 */
  ariaLabel?: string
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * 居中的模态 sheet：标题栏 + 内容 + 底部按钮栏。点遮罩或按 Esc 关闭（多层时只关最上面一层）。
 * 打开时焦点移进来（内容里有 autoFocus 的元素优先），关闭后还给原来的元素；Tab 在 sheet 内循环。
 */
export function Sheet(props: SheetProps): React.JSX.Element | null {
  return props.open ? <OpenSheet {...props} /> : null
}

function OpenSheet({
  onClose,
  title,
  subtitle,
  width = 520,
  height,
  accessory,
  closeButton = true,
  footer,
  children,
  bodyClassName,
  bodyStyle,
  ariaLabel
}: SheetProps): React.JSX.Element {
  const depth = useSheetDepth() + 1
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  // 在渲染时记下打开前的焦点（effect 执行时 autoFocus 已经把焦点移走了）
  const [returnFocus] = useState(() => document.activeElement)

  useEffect(() => {
    const id = pushSheet()
    const el = sheetRef.current
    if (el && !el.contains(document.activeElement)) el.focus()
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || !isTopSheet(id)) return
      e.preventDefault()
      close.current()
    }
    // 焦点跑到页面上（比如按钮被禁用、元素被移除后按 Tab）时拉回来；
    // 移进另一个 sheet 不管（上面刚打开的一层 autoFocus 时还没登记进栈）
    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      if (el && isTopSheet(id) && !target?.closest('.sheet')) el.focus()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
      popSheet(id)
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus()
    }
  }, [returnFocus])

  const trapTab = (e: KeyboardEvent<HTMLDivElement>): void => {
    const el = sheetRef.current
    if (e.key !== 'Tab' || !el || !el.contains(e.target as Node)) return
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null)
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === el)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <SheetDepthContext.Provider value={depth}>
      <div className="sheet-layer" onKeyDown={trapTab}>
        <div className="scrim" onClick={() => close.current()} />
        <div
          ref={sheetRef}
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={ariaLabel ? undefined : titleId}
          aria-label={ariaLabel}
          tabIndex={-1}
          style={{ width, height }}
        >
          <div className="shead">
            <div className="shead-title">
              <div id={titleId} className="stt">
                {title}
              </div>
              {subtitle != null && subtitle !== '' && <div className="lbl">{subtitle}</div>}
            </div>
            {accessory}
            {closeButton && <IconButton icon="xmark" label="关闭" onClick={() => close.current()} />}
          </div>
          <div className={cx('sbody', bodyClassName)} style={bodyStyle}>
            {children}
          </div>
          {footer != null && <div className="sfoot">{footer}</div>}
        </div>
      </div>
    </SheetDepthContext.Provider>,
    document.body
  )
}
