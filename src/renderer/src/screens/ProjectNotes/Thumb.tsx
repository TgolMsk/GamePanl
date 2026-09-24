import { useState } from 'react'
import { Icon } from '@renderer/ui'
import { imageUrl } from '@shared/api'
import type { ImageRef } from '@shared/types'

/** 小缩略图：填满父元素（object-fit: cover），读不到时显示占位图标 */
export function Thumb({ image, size, alt = '' }: { image: ImageRef; size: number; alt?: string }): React.JSX.Element {
  const src = imageUrl(image, size)
  const [broken, setBroken] = useState<string | null>(null)
  return broken === src ? (
    <span className="ph">
      <Icon name="photo" size={14} />
    </span>
  ) : (
    <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setBroken(src)} />
  )
}
