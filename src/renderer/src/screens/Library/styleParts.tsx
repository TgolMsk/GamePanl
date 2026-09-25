// 风格卡片和详情 sheet 共用：样张 / 色板条、复制风格提示词、可编辑的色板。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { copyText } from '@renderer/app/clipboard'
import { hud } from '@renderer/app/hud'
import { Icon } from '@renderer/ui'
import { imageUrl } from '@shared/api'
import type { Style } from '@shared/types'

/** 新建风格的默认色板（中性灰阶）；选了样张后如果还是这套就自动换成从样张提取的 */
export const DEFAULT_PALETTE = ['#1D1F24', '#44474F', '#7C808A', '#C4C7CE', '#F2F3F5']

export function isDefaultPalette(palette: ReadonlyArray<string>): boolean {
  return (
    palette.length === DEFAULT_PALETTE.length &&
    palette.every((hex, i) => hex.toUpperCase() === DEFAULT_PALETTE[i])
  )
}

/** 复制风格提示词；返回是否复制成功 */
export async function copyStylePrompt(prompt: string): Promise<boolean> {
  if (!prompt.trim()) {
    hud.show('这个风格还没有提示词')
    return false
  }
  return copyText(prompt, '风格提示词')
}

/** 样张图；没有样张（或读不到）时画成 5 色色板条 */
export function StyleVisual({
  style,
  thumb
}: {
  style: Pick<Style, 'name' | 'palette' | 'sampleImageId'>
  thumb: number
}): React.JSX.Element {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const src = style.sampleImageId ? imageUrl({ scope: 'library', id: style.sampleImageId }, thumb) : null
  if (src !== null && brokenSrc !== src) {
    return (
      <img
        className="lib-vis"
        src={src}
        alt={`${style.name || '未命名风格'}的样张`}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setBrokenSrc(src)}
      />
    )
  }
  return (
    <span className="lib-vis lib-strip">
      {style.palette.map((hex, i) => (
        <span key={i} style={{ background: hex }} />
      ))}
    </span>
  )
}

/** #abc、abc、#aabbcc → #AABBCC；不是色值返回 null */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${h.toUpperCase()}`
}

/** 色板：点色块复制色值，下面的色值可以直接改（回车或离开输入框时保存） */
export function PaletteEditor({
  palette,
  onChange
}: {
  palette: string[]
  onChange: (palette: string[]) => void
}): React.JSX.Element {
  return (
    <div className="lib-pal">
      {palette.map((hex, i) => (
        <PaletteSwatch
          key={i}
          index={i}
          hex={hex}
          onCommit={(next) => onChange(palette.map((x, j) => (j === i ? next : x)))}
        />
      ))}
    </div>
  )
}

function PaletteSwatch({
  hex,
  index,
  onCommit
}: {
  hex: string
  index: number
  onCommit: (hex: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async (): Promise<void> => {
    if (!(await copyText(hex, `色值 ${hex}`))) return
    clearTimeout(timer.current)
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  const commit = (): void => {
    if (draft === null) return
    const next = normalizeHex(draft)
    setDraft(null)
    if (next === null) hud.show('色值要写成 #RRGGBB，比如 #1B1F2E')
    else if (next !== hex) onCommit(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape' && draft !== null) {
      // 只撤销这次修改，不关 sheet
      e.preventDefault()
      e.stopPropagation()
      setDraft(null)
    }
  }

  // 输入中的色值合法时，色块先跟着变
  const preview = (draft !== null && normalizeHex(draft)) || hex

  return (
    <div className="lib-swcol">
      <button type="button" className="lib-swc" style={{ background: preview }} aria-label={`复制色值 ${hex}`} onClick={copy}>
        {copied && (
          <span className="done">
            <Icon name="check" size={11} strokeWidth={2.4} />
            已复制
          </span>
        )}
      </button>
      <input
        className="lib-hex"
        value={draft ?? hex}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        aria-label={`第 ${index + 1} 个颜色的色值`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
