import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent
} from 'react'
import { imageUrl } from '@shared/api'
import type { ImageRef } from '@shared/types'
import { copyImage } from '../app/clipboard'
import { isSelectModifier } from '../app/contextMenu'
import { cx } from './cx'
import { Icon } from './Icon'

export interface ImageCardProps {
  image: ImageRef
  /** 名称：显示在图下方，也用作图片 alt */
  name: string
  /** 名称下一行的小字，如「1536×1024 · PNG」 */
  meta?: ReactNode
  /** 是否显示名称和 meta，默认 true */
  caption?: boolean
  /** 图片区宽高比（宽 / 高），默认 1 */
  aspect?: number
  /** 固定图片区高度（给了就不按宽高比） */
  frameHeight?: number | string
  /** 图片区撑满卡片剩余高度（卡片放在固定行高的网格里时用） */
  fill?: boolean
  /** 选中：图片外 3px 强调色描边；选中的卡片一直显示「查看」按钮 */
  selected?: boolean
  /** 缩略图最长边像素，默认 480 */
  thumb?: number
  /** 单击时先做的事（如选中这张）；之后照常复制。按着 ⌘ / ⇧ 单击只选中，不复制 */
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  /** 双击：一般是打开查看 / 编辑 */
  onDoubleClick?: () => void
  /** 右键：一般用 showContextMenu 弹原生菜单 */
  onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void
  /** 替换默认的复制（默认 copyImage(image, name)）；返回 true 才显示「已复制」角标 */
  copy?: () => Promise<boolean>
  /** 给了才显示右上角的「查看」按钮 */
  onView?: () => void
  /** 「查看」按钮的文字，默认「查看」 */
  viewLabel?: string
  /** 按钮的读屏名称，默认「复制「名称」」 */
  ariaLabel?: string
  className?: string
  style?: CSSProperties
  /** 写到外层 data-id，方便用方向键在网格里移动焦点时查找 */
  dataId?: string
}

/**
 * 图片卡片：单击复制原图（按着 ⌘ / ⇧ 只选中），双击打开，右键菜单，可以直接拖出到其他应用，
 * 悬停出现「点击复制」胶囊和右上角「查看」按钮，复制成功后左上角显示「✓ 已复制」2 秒。
 */
export function ImageCard({
  image,
  name,
  meta,
  caption = true,
  aspect = 1,
  frameHeight,
  fill,
  selected,
  thumb = 480,
  onClick,
  onDoubleClick,
  onContextMenu,
  copy,
  onView,
  viewLabel = '查看',
  ariaLabel,
  className,
  style,
  dataId
}: ImageCardProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  // 记下是哪个地址加载失败 / 需要像素化，换了图片自动失效
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const [pixelSrc, setPixelSrc] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const src = imageUrl(image, thumb)

  const handleClick = async (e: ReactMouseEvent<HTMLButtonElement>): Promise<void> => {
    onClick?.(e)
    // 双击的第二下、带修饰键的多选都不再复制
    if (e.detail > 1 || isSelectModifier(e)) return
    const ok = await (copy ? copy() : copyImage(image, name))
    if (!ok) return
    clearTimeout(timer.current)
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  // 像素图（原图比显示尺寸小很多）放大时保持锐利
  const onLoad = (e: SyntheticEvent<HTMLImageElement>): void => {
    const img = e.currentTarget
    setPixelSrc(img.naturalWidth > 0 && img.naturalWidth * 2 <= img.clientWidth ? src : null)
  }

  const frameStyle: CSSProperties = fill
    ? {}
    : frameHeight !== undefined
      ? { height: frameHeight }
      : { aspectRatio: String(aspect) }

  return (
    <div
      className={cx('card', selected && 'sel', fill && 'fill', className)}
      style={style}
      data-id={dataId}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className={cx('hit', fill && 'fill')}
        aria-label={ariaLabel ?? `复制「${name}」`}
        onClick={handleClick}
        onDoubleClick={onDoubleClick}
        draggable
        onDragStart={(e) => {
          // 交给系统原生拖拽：可以直接拖进访达、ChatGPT、Photoshop
          e.preventDefault()
          void window.gp.shell.dragImage(image).catch(() => undefined)
        }}
      >
        <span className="frame" style={frameStyle}>
          {brokenSrc === src ? (
            <span className="ph">
              <Icon name="photo" size={22} strokeWidth={1.5} />
            </span>
          ) : (
            <img
              src={src}
              alt={name}
              loading="lazy"
              decoding="async"
              draggable={false}
              className={cx(pixelSrc === src && 'px')}
              onLoad={onLoad}
              onError={() => setBrokenSrc(src)}
            />
          )}
          <span className="pill">
            <Icon name="copy" size={12} strokeWidth={2} />
            点击复制
          </span>
          {copied && (
            <span className="done">
              <Icon name="check" size={11} strokeWidth={2.4} />
              已复制
            </span>
          )}
        </span>
        {caption && (
          <>
            <span className="cap">{name}</span>
            {meta != null && <span className="meta">{meta}</span>}
          </>
        )}
      </button>
      {onView && (
        <button type="button" className="eye" aria-label={viewLabel} title={viewLabel} onClick={onView}>
          <Icon name="eye" size={15} />
        </button>
      )}
    </div>
  )
}
