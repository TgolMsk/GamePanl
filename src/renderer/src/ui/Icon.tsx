// 描边图标（24×24 画布，类似 SF Symbols）。前半部分来自 SHELL.md，原样照抄。
import type { CSSProperties, ReactNode } from 'react'

const ICONS = {
  // —— SHELL.md ——
  photo: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M4 18l5-5 4 4 3-3 4 4" />
    </>
  ),
  text: <path d="M5 6.5h14M5 11.5h14M5 16.5h9" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7s-.6-1.3-.6-2.1c0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.7-4-8.6-9-8.6z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="10" cy="7" r="1" />
      <circle cx="14.5" cy="7" r="1" />
    </>
  ),
  controller: (
    <>
      <rect x="2.5" y="7.5" width="19" height="10" rx="5" />
      <path d="M8 10.5v4M6 12.5h4" />
      <circle cx="15.5" cy="11.5" r=".9" />
      <circle cx="17.5" cy="13.5" r=".9" />
    </>
  ),
  slider: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  bulb: (
    <path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z" />
  ),
  stack: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2.5" />
      <path d="M7 5.2h10M9.5 2.6h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="5" cy="6.5" r=".9" />
      <circle cx="5" cy="12" r=".9" />
      <circle cx="5" cy="17.5" r=".9" />
    </>
  ),
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  xmark: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron.down': <path d="M6 9.5l6 6 6-6" />,
  square: <rect x="4.5" y="4.5" width="15" height="15" rx="4" />,
  'checkmark.square': (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="4" />
      <path d="M8.5 12.2l2.5 2.5 4.5-5" />
    </>
  ),
  // —— 原型里用到的 ——
  'chevron.up.down': <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />,
  minus: <path d="M5 12h14" />,
  checklist: (
    <>
      <path d="M11 7h9M11 12.5h9M11 18h9" />
      <path d="M3.8 7l1.7 1.7 2.8-2.9M3.8 12.5l1.7 1.7 2.8-2.9M3.8 18l1.7 1.7 2.8-2.9" />
    </>
  ),
  compose: (
    <>
      <path d="M11 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4" />
      <path d="M17.6 3.9a1.7 1.7 0 0 1 2.5 2.5l-7.4 7.4-3.2.8.8-3.2z" />
    </>
  ),
  // —— 补充 ——
  'chevron.left': <path d="M14.5 6l-6 6 6 6" />,
  'chevron.right': <path d="M9.5 6l6 6-6 6" />,
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  pencil: (
    <>
      <path d="M14.5 6.5l3 3" />
      <path d="M5 19l1-4 9.8-9.8a2.1 2.1 0 0 1 3 3L9 18z" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12V5.5a2 2 0 0 1 2-2H12a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.5 6.5a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3.5 12z" />
      <circle cx="8.2" cy="8.2" r="1.3" />
    </>
  ),
  star: <path d="M12 4l2.41 5.28 5.77.66-4.28 3.93 1.15 5.69L12 16.7l-5.05 2.86 1.15-5.69-4.28-3.93 5.77-.66z" />,
  'star.fill': (
    <path
      fill="currentColor"
      d="M12 4l2.41 5.28 5.77.66-4.28 3.93 1.15 5.69L12 16.7l-5.05 2.86 1.15-5.69-4.28-3.93 5.77-.66z"
    />
  ),
  undo: (
    <>
      <path d="M9 14L4.5 9.5 9 5" />
      <path d="M4.5 9.5H15a5 5 0 0 1 0 10h-3" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
    </>
  ),
  doc: (
    <>
      <path d="M13.5 3.5h-6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  'tray.down': (
    <>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M4.5 14.5V17A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-2.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.9v.1" />
    </>
  )
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

export interface IconProps {
  name: IconName
  /** 像素，默认 16 */
  size?: number
  /** 描边粗细，默认 1.7 */
  strokeWidth?: number
  className?: string
  style?: CSSProperties
  /** 给了就作为读屏文字；不给则对读屏隐藏（多数图标旁边已有文字） */
  title?: string
}

export function Icon({ name, size = 16, strokeWidth = 1.7, className, style, title }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {ICONS[name]}
    </svg>
  )
}
