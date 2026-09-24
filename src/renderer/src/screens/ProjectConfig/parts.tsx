import { useState } from 'react'
import { imageUrl } from '@shared/api'
import type { Style } from '@shared/types'
import { Icon } from '@renderer/ui'

/** 缩略图：没有地址或加载失败时显示占位图标 */
export function Thumb({ src, alt, iconSize = 18 }: { src: string | null; alt: string; iconSize?: number }): React.JSX.Element {
  const [broken, setBroken] = useState<string | null>(null)
  if (!src || broken === src) {
    return (
      <span className="ph">
        <Icon name="photo" size={iconSize} strokeWidth={1.5} />
      </span>
    )
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(src)} />
}

function Colors({ palette, className }: { palette: string[]; className: string }): React.JSX.Element {
  return (
    <span className={className}>
      {palette.map((hex, i) => (
        <span key={i} style={{ background: hex }} />
      ))}
    </span>
  )
}

export interface StyleVisualProps {
  style: Style
  /** 样张缩略图最长边 */
  thumb: number
  /** 有样张时在底部加一条色板 */
  strip?: boolean
}

/** 风格的视觉：有样张用样张，没有样张（或读不到）用 5 色色板条 */
export function StyleVisual({ style, thumb, strip = false }: StyleVisualProps): React.JSX.Element {
  const [broken, setBroken] = useState<string | null>(null)
  const src = style.sampleImageId ? imageUrl({ scope: 'library', id: style.sampleImageId }, thumb) : null
  if (src && broken !== src) {
    return (
      <>
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(src)} />
        {strip && style.palette.length > 0 && <Colors palette={style.palette} className="cf-strip" />}
      </>
    )
  }
  if (style.palette.length === 0) {
    return (
      <span className="ph">
        <Icon name="palette" size={18} strokeWidth={1.5} />
      </span>
    )
  }
  return <Colors palette={style.palette} className="cf-bars" />
}
