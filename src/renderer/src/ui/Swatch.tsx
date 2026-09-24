import { useEffect, useRef, useState } from 'react'
import { copyText } from '../app/clipboard'
import { cx } from './cx'
import { Icon } from './Icon'

export interface SwatchProps {
  /** 十六进制色值，如 #1b1f3a */
  hex: string
  /** pill：圆点 + 色值的小胶囊（项目配置）；block：大色块 + 下方色值（风格详情） */
  variant?: 'pill' | 'block'
  className?: string
}

/** 色块：单击复制色值，复制后 2 秒内显示对勾 / 「已复制」 */
export function Swatch({ hex, variant = 'pill', className }: SwatchProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (): Promise<void> => {
    if (!(await copyText(hex, `色值 ${hex}`))) return
    clearTimeout(timer.current)
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }
  if (variant === 'block') {
    return (
      <button type="button" className={cx('swb', className)} aria-label={`复制色值 ${hex}`} onClick={copy}>
        <span className="c" style={{ background: hex }} />
        <span className="hx">{copied ? '已复制' : hex}</span>
      </button>
    )
  }
  return (
    <button type="button" className={cx('swt', className)} aria-label={`复制色值 ${hex}`} onClick={copy}>
      {copied ? (
        <span className="okc">
          <Icon name="check" size={11} strokeWidth={2.4} />
        </span>
      ) : (
        <span className="dot" style={{ background: hex }} />
      )}
      <span className="hx">{hex}</span>
    </button>
  )
}
