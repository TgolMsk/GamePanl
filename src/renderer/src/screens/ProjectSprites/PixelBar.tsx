// 预览上方的像素调节：像素身高、颜色数（滑杆 + 输入框 + 常用档位），作用于整个角色或只这个动作。
// 拖滑杆时先只改显示，停 150 ms（或松手）再保存，预览随之重算。
import { useEffect, useRef, useState } from 'react'
import { Chip, NumberField, Segmented } from '@renderer/ui'
import type { SpriteAction, SpriteActionParams, SpriteCharacter, SpriteSettings } from '@shared/sprites'

const HEIGHT_PRESETS = [16, 24, 32, 48, 64, 96, 128]
const SLIDER_MAX_HEIGHT = 256

/** 滑杆：拖动时只更新草稿，停顿或松手后提交 */
function useDraft(value: number, commit: (v: number) => void): [number, (v: number) => void, () => void] {
  const [draft, setDraft] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<number | null>(null)
  const flush = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const v = pending.current
    pending.current = null
    if (v !== null && v !== value) commit(v)
    setDraft(null)
  }
  const change = (v: number): void => {
    setDraft(v)
    pending.current = v
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 150)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return [draft ?? value, change, flush]
}

function Slider({
  value,
  min,
  max,
  onChange,
  onCommit,
  label
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  onCommit: () => void
  label: string
}): React.JSX.Element {
  return (
    <input
      type="range"
      className="sp-range"
      min={min}
      max={max}
      step={1}
      value={Math.min(max, Math.max(min, value))}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      onBlur={onCommit}
    />
  )
}

export interface PixelBarProps {
  ch: SpriteCharacter
  action: SpriteAction
  /** 项目设定的角色高度；全局库为 null */
  projectHeight: number | null
  onSettings: (patch: Partial<SpriteSettings>) => void
  onParams: (patch: Partial<SpriteActionParams>) => void
}

export function PixelBar(p: PixelBarProps): React.JSX.Element {
  const s = p.ch.settings
  const a = p.action.params
  const overridden = a.height !== null || a.colors !== null
  const single = p.ch.actions.length <= 1
  const [scope, setScope] = useState<'char' | 'action'>(overridden ? 'action' : 'char')
  useEffect(() => {
    setScope(overridden ? 'action' : 'char')
    // 只在换动作时按有没有单独设置重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.action.id])

  const mine = scope === 'action' && !single
  const height = mine ? (a.height ?? s.height) : s.height
  const colors = mine ? (a.colors ?? s.colors) : s.colors
  const setHeight = (v: number): void => (mine ? p.onParams({ height: v }) : p.onSettings({ height: v }))
  const setColors = (v: number): void => (mine ? p.onParams({ colors: v }) : p.onSettings({ colors: v }))
  const [h, dragH, commitH] = useDraft(height, setHeight)
  const [c, dragC, commitC] = useDraft(colors, setColors)

  const changeScope = (v: 'char' | 'action'): void => {
    setScope(v)
    // 回到「整个角色」：去掉这个动作的单独设置
    if (v === 'char' && overridden) p.onParams({ height: null, colors: null })
  }

  const presets = [...HEIGHT_PRESETS]
  const proj = p.projectHeight
  return (
    <div className="sp-pix" role="group" aria-label="像素调节">
      <div className="grp grow">
        <span className="lbl">像素身高</span>
        <Slider value={h} min={8} max={SLIDER_MAX_HEIGHT} onChange={dragH} onCommit={commitH} label="像素身高" />
        <NumberField value={h} min={8} max={512} onChange={setHeight} ariaLabel="像素身高（输入）" />
        <span className="lbl">px</span>
      </div>
      <div className="grp chips" aria-label="常用身高">
        {presets.map((v) => (
          <Chip key={v} check={false} selected={v === h} onClick={() => setHeight(v)}>
            {v}
          </Chip>
        ))}
        {proj !== null && !presets.includes(proj) && (
          <Chip check={false} selected={proj === h} onClick={() => setHeight(proj)} title="项目配置里的角色尺寸">
            项目 {proj}
          </Chip>
        )}
      </div>
      <div className="grp grow short">
        <span className="lbl">颜色</span>
        <Slider value={c} min={2} max={64} onChange={dragC} onCommit={commitC} label="颜色数" />
        <NumberField value={c} min={2} max={64} onChange={setColors} ariaLabel="颜色数（输入）" />
      </div>
      {!single && (
        <div className="grp">
          <Segmented
            ariaLabel="像素设置作用于"
            value={scope}
            onChange={changeScope}
            options={[
              { value: 'char', label: '整个角色' },
              { value: 'action', label: `仅「${p.action.name}」` }
            ]}
          />
        </div>
      )}
    </div>
  )
}
