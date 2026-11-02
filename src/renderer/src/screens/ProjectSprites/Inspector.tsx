// 右栏：质检（点警告跳到对应帧）、输出设置（整个角色共用）、调色板、动作参数（默认折叠，可应用到全部动作）。
import { useEffect, useState } from 'react'
import type { CharacterOutput, ActionOutput } from '@renderer/sprites/engine'
import type { QcItem } from '@renderer/sprites/core/qc'
import { Button, GroupList, GroupRow, Icon, NumberField, Segmented, Select, cx } from '@renderer/ui'
import {
  DEFAULT_SPRITE_PARAMS,
  type SpriteAction,
  type SpriteActionParams,
  type SpriteCharacter,
  type SpriteSettings
} from '@shared/sprites'
import { hex } from './draw'

/** 小数输入框：回车或失焦提交，乱填恢复 */
function DecimalField({
  value,
  onChange,
  min,
  max,
  digits = 2,
  ariaLabel
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  digits?: number
  ariaLabel: string
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const n = Number(draft.trim())
    setDraft(null)
    if (draft.trim() === '' || !Number.isFinite(n)) return
    const v = Math.min(max, Math.max(min, n))
    if (v !== value) onChange(v)
  }
  return (
    <input
      className="fld num sp-dec"
      aria-label={ariaLabel}
      value={draft ?? String(Number(value.toFixed(digits)))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') {
          e.stopPropagation()
          setDraft(null)
        }
      }}
    />
  )
}

function Disclosure({
  title,
  sub,
  open,
  onToggle,
  children
}: {
  title: string
  sub?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="gsec">
      <button type="button" className={cx('sp-disc', !open && 'closed')} onClick={onToggle} aria-expanded={open}>
        <Icon name="chevron.down" size={12} strokeWidth={2.2} />
        {title}
        {sub && <span className="sub">{sub}</span>}
      </button>
      {open && children}
    </div>
  )
}

function QcRow({ q, onJump }: { q: QcItem; onJump: (frame: number) => void }): React.JSX.Element {
  const link = q.frame !== undefined
  const icon = q.status === 'ok' ? 'check' : q.status === 'warn' ? 'info' : 'info'
  return (
    <button type="button" className={cx('sp-qi', q.status, link && 'link')} onClick={() => link && onJump(q.frame as number)} disabled={!link && !q.message}>
      <span className="ic">
        <Icon name={icon} size={14} strokeWidth={q.status === 'ok' ? 2.4 : 1.9} />
      </span>
      <span className="bd">
        <span className="row">
          <span>{q.label}</span>
          <span className="val">{q.value}</span>
        </span>
        {q.message && q.status !== 'ok' && <span className="why">{q.message}</span>}
        {link && q.status === 'warn' && <span className="why">点击查看第 {q.frame} 帧</span>}
      </span>
    </button>
  )
}

const OPEN_KEY = 'gamepanl.sprites.open'

function useOpen(): [Record<string, boolean>, (k: string) => void] {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open))
    } catch {
      // 记不住只是下次回到默认
    }
  }, [open])
  return [open, (k) => setOpen((o) => ({ ...o, [k]: !o[k] }))]
}

export interface InspectorProps {
  ch: SpriteCharacter
  action: SpriteAction | null
  output: CharacterOutput | null
  out: ActionOutput | undefined
  projectHeight: number | null
  onSettings: (patch: Partial<SpriteSettings>) => void
  onParams: (patch: Partial<SpriteActionParams>) => void
  onApplyAll: () => void
  onPickWatermark: () => void
  onJump: (frame: number) => void
}

export function Inspector(p: InspectorProps): React.JSX.Element {
  const { ch, action, out, output } = p
  const s = ch.settings
  const [open, toggle] = useOpen()
  const qc = [...(out?.qc ?? []), ...(output?.qc ?? [])]
  const warns = qc.filter((q) => q.status === 'warn')
  // 警告排在前面
  const sorted = [...warns, ...qc.filter((q) => q.status !== 'warn')]

  return (
    <aside className="inspector sp-insp">
      <div className="gsec">
        <div className="gh">
          质检
          <span className="lbl" style={{ fontWeight: 400, marginLeft: 6 }}>
            {out ? (warns.length ? `${warns.length} 个警告` : '没有问题') : ''}
          </span>
        </div>
        <div className="group sp-qc">
          {out ? sorted.map((q) => <QcRow key={q.id} q={q} onJump={p.onJump} />) : <div className="sp-qi">处理完后显示</div>}
        </div>
      </div>

      <Disclosure title="输出" sub={`${s.height} px 高 · ${s.colors} 色`} open={!!open.out} onToggle={() => toggle('out')}>
        <GroupList>
          <GroupRow compact label="像素身高">
            {p.projectHeight !== null && p.projectHeight !== s.height && (
              <Button size="sm" variant="plain" onClick={() => p.onSettings({ height: p.projectHeight as number })}>
                用项目尺寸 {p.projectHeight}
              </Button>
            )}
            <NumberField value={s.height} min={8} max={512} onChange={(height) => p.onSettings({ height })} ariaLabel="像素身高" />
          </GroupRow>
          <GroupRow compact label="颜色数">
            <NumberField value={s.colors} min={2} max={64} onChange={(colors) => p.onSettings({ colors })} ariaLabel="颜色数" />
          </GroupRow>
          <GroupRow compact label="描边">
            <Segmented
              ariaLabel="描边"
              value={s.outline ? 'on' : 'off'}
              onChange={(v) => p.onSettings({ outline: v === 'on' })}
              options={[
                { value: 'on', label: '开' },
                { value: 'off', label: '关' }
              ]}
            />
          </GroupRow>
          <GroupRow compact label="缩小方式">
            <Segmented
              ariaLabel="缩小方式"
              value={s.resample}
              onChange={(resample) => p.onSettings({ resample })}
              options={[
                { value: 'mode', label: '众数' },
                { value: 'box', label: '平均' }
              ]}
            />
          </GroupRow>
          <GroupRow compact label="四周留白">
            <NumberField value={s.pad} min={0} max={16} onChange={(pad) => p.onSettings({ pad })} ariaLabel="四周留白" />
          </GroupRow>
          <GroupRow compact label="各动作同尺寸">
            <Segmented
              ariaLabel="各动作同尺寸"
              value={s.unifiedCanvas ? 'on' : 'off'}
              onChange={(v) => p.onSettings({ unifiedCanvas: v === 'on' })}
              options={[
                { value: 'off', label: '各自裁切' },
                { value: 'on', label: '统一' }
              ]}
            />
          </GroupRow>
          <GroupRow compact label="Sheet 列数">
            <Select
              value={s.cols === null ? 'row' : String(s.cols)}
              options={[{ value: 'row', label: '一行' }, ...[2, 3, 4, 5, 6, 8, 10, 12].map((c) => ({ value: String(c), label: `${c} 列` }))]}
              onChange={(v) => p.onSettings({ cols: v === 'row' ? null : Number(v) })}
            />
          </GroupRow>
        </GroupList>
        {output && output.actions.length > 1 && (
          <div className="sp-note" style={{ marginTop: 6 }}>
            {output.layout.h0Inconsistent
              ? '各动作首帧身高差得较多，已按各自身高缩放（见质检）。'
              : `${output.actions.length} 个动作共用一个缩放比和落脚点，换动作时角色不会跳。`}
          </div>
        )}
      </Disclosure>

      {output && (
        <div className="gsec">
          <div className="gh">
            调色板 <span className="lbl" style={{ fontWeight: 400 }}>{output.palette.length} 色 · 全部动作共用</span>
          </div>
          <div className="group sp-pal">
            {output.palette.map((c, k) => (
              <span key={k} style={{ background: hex(c) }} title={hex(c)} />
            ))}
          </div>
        </div>
      )}

      {action && <ActionParams {...p} action={action} open={!!open.params} onToggle={() => toggle('params')} />}
    </aside>
  )
}

function ActionParams(p: InspectorProps & { action: SpriteAction; open: boolean; onToggle: () => void }): React.JSX.Element {
  const a = p.action.params
  const an = p.out?.analysis
  const set = p.onParams
  const changed = (Object.keys(DEFAULT_SPRITE_PARAMS) as Array<keyof SpriteActionParams>).some(
    (k) => k !== 'start' && k !== 'end' && JSON.stringify(a[k]) !== JSON.stringify(DEFAULT_SPRITE_PARAMS[k])
  )
  const wmText = a.watermark === 'auto' ? '自动' : a.watermark === 'none' ? '不屏蔽' : '手动框选'
  return (
    <Disclosure title="动作参数" sub={p.action.name} open={p.open} onToggle={p.onToggle}>
      <GroupList>
        <GroupRow compact label="类型">
          <Segmented
            ariaLabel="循环或单次"
            value={a.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { value: 'auto', label: an ? `自动（${an.kind === 'loop' ? '循环' : '单次'}）` : '自动' },
              { value: 'loop', label: '循环' },
              { value: 'once', label: '单次' }
            ]}
          />
        </GroupRow>
        <GroupRow compact label="目标帧率">
          <DecimalField value={a.fps} min={1} max={60} digits={1} onChange={(fps) => set({ fps })} ariaLabel="目标帧率" />
        </GroupRow>
        <GroupRow compact label="帧数">
          <Select
            value={a.frames === null ? 'auto' : String(a.frames)}
            options={[
              { value: 'auto', label: an ? `按帧率（${an.picks.length + an.dropped.length}）` : '按帧率' },
              ...[4, 5, 6, 8, 10, 12, 16, 24].map((n) => ({ value: String(n), label: `${n} 帧` }))
            ]}
            onChange={(v) => set({ frames: v === 'auto' ? null : Number(v) })}
          />
        </GroupRow>
        <GroupRow compact label="周期范围（秒）">
          <DecimalField value={a.minPeriod} min={0.05} max={10} onChange={(minPeriod) => set({ minPeriod })} ariaLabel="最短周期" />
          <span className="lbl">–</span>
          <DecimalField value={a.maxPeriod} min={0.05} max={20} onChange={(maxPeriod) => set({ maxPeriod })} ariaLabel="最长周期" />
        </GroupRow>
        <GroupRow compact label="比例微调">
          <DecimalField value={a.scaleTweak} min={0.8} max={1.2} digits={3} onChange={(scaleTweak) => set({ scaleTweak })} ariaLabel="比例微调" />
        </GroupRow>
      </GroupList>

      <GroupList>
        <GroupRow compact label="抠图方式">
          <Segmented
            ariaLabel="抠图方式"
            value={a.key}
            onChange={(key) => set({ key })}
            options={[
              { value: 'auto', label: an ? `自动（${an.keyMode === 'hue' ? '色相' : '距离'}）` : '自动' },
              { value: 'hue', label: '色相' },
              { value: 'dist', label: '距离' }
            ]}
          />
        </GroupRow>
        {an && (
          <GroupRow compact label="背景色">
            <span className="lbl" style={{ fontFamily: 'var(--mono)' }}>{hex(an.bg)}</span>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: hex(an.bg) }} />
          </GroupRow>
        )}
        {(a.key === 'hue' || (a.key === 'auto' && an?.keyMode !== 'dist')) && (
          <>
            <GroupRow compact label="色相容差（度）">
              <DecimalField value={a.hueTol} min={1} max={180} digits={0} onChange={(hueTol) => set({ hueTol })} ariaLabel="色相容差" />
            </GroupRow>
            <GroupRow compact label="饱和度下限">
              <DecimalField value={a.satMin} min={0} max={1} onChange={(satMin) => set({ satMin })} ariaLabel="饱和度下限" />
            </GroupRow>
            <GroupRow compact label="亮度下限">
              <DecimalField value={a.valMin} min={0} max={1} onChange={(valMin) => set({ valMin })} ariaLabel="亮度下限" />
            </GroupRow>
          </>
        )}
        {(a.key === 'dist' || (a.key === 'auto' && an?.keyMode === 'dist')) && (
          <GroupRow compact label="颜色距离">
            <DecimalField value={a.distTol} min={0.01} max={1.8} onChange={(distTol) => set({ distTol })} ariaLabel="颜色距离" />
          </GroupRow>
        )}
        <GroupRow compact label="去噪点（开运算）">
          <NumberField value={a.open} min={0} max={5} onChange={(open) => set({ open })} ariaLabel="开运算" />
        </GroupRow>
        <GroupRow compact label="去绿边">
          <Segmented
            ariaLabel="去绿边"
            value={a.despill ? 'on' : 'off'}
            onChange={(v) => set({ despill: v === 'on' })}
            options={[
              { value: 'on', label: '开' },
              { value: 'off', label: '关' }
            ]}
          />
        </GroupRow>
        <GroupRow compact label="不透明阈值">
          <DecimalField value={a.alphaThreshold} min={0.05} max={0.95} onChange={(alphaThreshold) => set({ alphaThreshold })} ariaLabel="不透明阈值" />
        </GroupRow>
        <GroupRow compact label="水印">
          <span className="lbl">{wmText}</span>
          <Button size="sm" onClick={p.onPickWatermark}>
            框选…
          </Button>
        </GroupRow>
      </GroupList>

      <div className="sp-btns">
        <Button size="sm" onClick={p.onApplyAll}>
          应用到全部动作
        </Button>
        <Button
          size="sm"
          variant="plain"
          disabled={!changed}
          onClick={() => set({ ...DEFAULT_SPRITE_PARAMS, start: a.start, end: a.end })}
        >
          恢复默认
        </Button>
      </div>
      <div className="sp-note">「应用到全部动作」不改各动作的片段起止和循环 / 单次。</div>
    </Disclosure>
  )
}
