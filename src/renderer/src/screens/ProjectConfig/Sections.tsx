// 配置页主区的各个分组。修改都通过 change() 写进草稿，由 useProjectDraft 防抖保存。
import type { KeyboardEvent } from 'react'
import { imageUrl } from '@shared/api'
import {
  GENRE_OPTIONS,
  PLATFORM_OPTIONS,
  RESOLUTION_OPTIONS,
  SESSION_OPTIONS,
  type ID,
  type Project,
  type ProjectAsset,
  type Prompt,
  type Size2,
  type Style
} from '@shared/types'
import {
  Button,
  Chip,
  GroupList,
  GroupRow,
  Icon,
  NumberField,
  Segmented,
  Select,
  Stepper,
  Swatch,
  Tag,
  TextArea
} from '@renderer/ui'
import { SCALING_OPTIONS, SIZE_ITEMS, computeScale, sizeLabel, type ScaleResult } from './onePager'
import { StyleVisual, Thumb } from './parts'
import type { ChangeProject } from './useProjectDraft'

interface SectionProps {
  project: Project
  change: ChangeProject
}

/** 单行输入框里按回车结束编辑（输入法组词时不算） */
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>): void {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
  e.preventDefault()
  e.currentTarget.blur()
}

/** 已复制时显示「✓ 已复制」，否则显示复制图标 */
export function CopyMark({ done }: { done: boolean }): React.JSX.Element {
  return done ? (
    <span className="cf-okt">
      <Icon name="check" size={12} strokeWidth={2.2} />
      已复制
    </span>
  ) : (
    <span className="cf-cpi">
      <Icon name="copy" size={14} />
    </span>
  )
}

// ---------- 项目头：封面、名称、一句话 ----------

export interface ProjectHeaderProps extends SectionProps {
  coverAsset: ProjectAsset | undefined
  /** 名称被清空后失焦时恢复成这个 */
  savedName: string
  onPickCover: () => void
}

export function ProjectHeader({
  project,
  change,
  coverAsset,
  savedName,
  onPickCover
}: ProjectHeaderProps): React.JSX.Element {
  const coverSrc = coverAsset ? imageUrl({ scope: 'project', projectId: project.id, id: coverAsset.id }, 160) : null
  const endName = (): void => {
    const v = project.name.trim()
    if (!v) change({ name: savedName.trim() || '未命名项目' })
    else if (v !== project.name) change({ name: v })
  }
  const endPitch = (): void => {
    const v = project.pitch.trim()
    if (v !== project.pitch) change({ pitch: v })
  }
  return (
    <div className="group cf-head">
      <button
        type="button"
        className="cf-cover"
        aria-label={coverAsset ? '更换封面' : '选择封面'}
        title={coverAsset ? '更换封面' : '选择封面'}
        onClick={onPickCover}
      >
        <Thumb src={coverSrc} alt="" iconSize={20} />
        <span className="cf-cover-hint">{coverAsset ? '更换' : '选择'}</span>
      </button>
      <div className="cf-names">
        <input
          className="cf-ttl cf-name"
          value={project.name}
          placeholder="项目名称"
          aria-label="项目名称"
          maxLength={60}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => change({ name: e.target.value }, e.target.value.trim() !== '')}
          onBlur={endName}
          onKeyDown={blurOnEnter}
        />
        <input
          className="cf-ttl cf-pitch"
          value={project.pitch}
          placeholder="一句话介绍"
          aria-label="一句话介绍"
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => change({ pitch: e.target.value })}
          onBlur={endPitch}
          onKeyDown={blurOnEnter}
        />
      </div>
    </div>
  )
}

// ---------- 基本 ----------

interface ChipSetProps {
  label: string
  options: readonly string[]
  value: string[]
  onChange: (next: string[]) => void
}

/** 多选胶囊。按选项顺序保存；选项以外的旧值（手动写进去的）排在后面，照常显示 */
function ChipSet({ label, options, value, onChange }: ChipSetProps): React.JSX.Element {
  const extras = value.filter((v) => !options.includes(v))
  const toggle = (item: string): void => {
    const next = value.includes(item) ? value.filter((v) => v !== item) : [...value, item]
    onChange([...options.filter((o) => next.includes(o)), ...next.filter((v) => !options.includes(v))])
  }
  return (
    <div className="cf-chips" role="group" aria-label={label}>
      {[...options, ...extras].map((o) => (
        <Chip key={o} selected={value.includes(o)} onClick={() => toggle(o)}>
          {o}
        </Chip>
      ))}
    </div>
  )
}

export function BasicSection({ project, change }: SectionProps): React.JSX.Element {
  return (
    <GroupList title="基本">
      <GroupRow label="类型" top fill className="cf-chiprow">
        <ChipSet label="类型" options={GENRE_OPTIONS} value={project.genres} onChange={(genres) => change({ genres })} />
      </GroupRow>
      <GroupRow label="平台" top fill className="cf-chiprow">
        <ChipSet
          label="平台"
          options={PLATFORM_OPTIONS}
          value={project.platforms}
          onChange={(platforms) => change({ platforms })}
        />
      </GroupRow>
      <GroupRow label="目标玩家" htmlFor="cf-players" top fill className="cf-arearow">
        <TextArea
          id="cf-players"
          value={project.targetPlayers}
          placeholder="谁会玩、在什么时候玩"
          minRows={2}
          maxRows={6}
          onChange={(e) => change({ targetPlayers: e.target.value })}
        />
      </GroupRow>
      <GroupRow label="单局时长" htmlFor="cf-session">
        <Select<string>
          id="cf-session"
          variant="fill"
          value={project.sessionLength}
          options={SESSION_OPTIONS}
          placeholder="未设置"
          onChange={(sessionLength) => change({ sessionLength })}
        />
      </GroupRow>
    </GroupList>
  )
}

// ---------- 美术风格 ----------

export interface StyleSectionProps {
  style: Style | undefined
  copiedId: string | null
  onPick: () => void
  onCopyPrompt: (style: Style) => void
}

export function StyleSection({ style, copiedId, onPick, onCopyPrompt }: StyleSectionProps): React.JSX.Element {
  return (
    <GroupList title="美术风格">
      <div className="rowi cf-style">
        <span className="cf-sthumb">
          {style ? <StyleVisual style={style} thumb={120} /> : <Icon name="palette" size={18} strokeWidth={1.5} />}
        </span>
        <div className="cf-sinfo">
          <span className="cf-sname">{style ? style.name : '还没有选美术风格'}</span>
          <span className="lbl">{style ? style.desc : '从全局库的风格里选一个，色板和风格提示词会显示在这里'}</span>
        </div>
        <Button onClick={onPick}>{style ? '更换…' : '选择…'}</Button>
      </div>
      {style && style.palette.length > 0 && (
        <GroupRow label="色板" fill>
          <div className="cf-chips" role="group" aria-label="色板">
            {style.palette.map((hex, i) => (
              <Swatch key={`${i}-${hex}`} hex={hex} />
            ))}
          </div>
        </GroupRow>
      )}
      {style && style.prompt.trim() !== '' && (
        <GroupRow label="风格提示词" top fill className="cf-promptrow">
          <button
            type="button"
            className="cf-ptx"
            aria-label={`复制「${style.name}」的风格提示词`}
            onClick={() => onCopyPrompt(style)}
          >
            <span className="cf-ptext cf-clamp">{style.prompt}</span>
            <CopyMark done={copiedId === 'style-prompt'} />
          </button>
        </GroupRow>
      )}
    </GroupList>
  )
}

// ---------- 分辨率和尺寸 ----------

/** 放大一档 / 缩小一档时宽度走这几个常用值，高度按比例跟着变 */
const LADDER = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]
const RESOLUTION_LABELS = RESOLUTION_OPTIONS.map(sizeLabel)

interface SizeCellProps {
  label: string
  id: string
  size: Size2
  scale: ScaleResult
  onChange: (next: Size2) => void
}

function SizeCell({ label, id, size, scale, onChange }: SizeCellProps): React.JSX.Element {
  const lower = LADDER.filter((v) => v < size.w)
  const higher = LADDER.filter((v) => v > size.w)
  const stepTo = (w: number): void =>
    onChange({ w, h: size.w > 0 ? Math.max(1, Math.round((size.h * w) / size.w)) : w })
  const onScreen =
    size.w > 0 && size.h > 0
      ? `屏幕上 ${Math.round(size.w * scale.fx)}×${Math.round(size.h * scale.fy)}`
      : '屏幕上 —'
  return (
    <div className="cf-szc">
      <label htmlFor={id}>{label}</label>
      <span className="lbl" title={onScreen}>
        {onScreen}
      </span>
      <NumberField
        id={id}
        value={size.w}
        min={1}
        max={4096}
        ariaLabel={`${label}宽度`}
        onChange={(w) => onChange({ ...size, w })}
      />
      <span className="cf-x" aria-hidden="true">
        ×
      </span>
      <NumberField value={size.h} min={1} max={4096} ariaLabel={`${label}高度`} onChange={(h) => onChange({ ...size, h })} />
      <Stepper
        value={size.w}
        min={lower.length > 0 ? -Infinity : size.w}
        max={higher.length > 0 ? Infinity : size.w}
        label={`${label}尺寸`}
        onChange={(n) => stepTo(n > size.w ? higher[0] : lower[lower.length - 1])}
      />
    </div>
  )
}

export function SizeSection({ project, change }: SectionProps): React.JSX.Element {
  const scale = computeScale(project.resolution, project.scaling)
  const pickResolution = (label: string): void => {
    const r = RESOLUTION_OPTIONS.find((o) => sizeLabel(o) === label)
    if (r) change({ resolution: { w: r.w, h: r.h } })
  }
  return (
    <GroupList title="分辨率和尺寸">
      <GroupRow label="基准分辨率" htmlFor="cf-res">
        <Select<string>
          id="cf-res"
          variant="fill"
          value={sizeLabel(project.resolution)}
          options={RESOLUTION_LABELS}
          onChange={pickResolution}
        />
      </GroupRow>
      <GroupRow label="缩放方式" className="cf-scale">
        <span className="lbl" aria-live="polite">
          {scale.summary}
        </span>
        <Tag>{scale.fit}</Tag>
        <Segmented
          ariaLabel="缩放方式"
          value={project.scaling}
          options={SCALING_OPTIONS}
          onChange={(scaling) => change({ scaling })}
        />
      </GroupRow>
      <div className="cf-szg">
        {SIZE_ITEMS.map((item) => (
          <SizeCell
            key={item.key}
            id={`cf-size-${item.key}`}
            label={item.label}
            size={project.sizes[item.key]}
            scale={scale}
            onChange={(next) => change({ sizes: { ...project.sizes, [item.key]: next } })}
          />
        ))}
      </div>
    </GroupList>
  )
}

// ---------- 常用提示词（放在右侧检查器里，单击卡片复制） ----------

export interface PinnedPromptsProps extends SectionProps {
  prompts: Prompt[]
  copiedId: string | null
  onCopy: (prompt: Prompt) => void
  onAdd: () => void
}

export function PinnedPrompts({
  project,
  change,
  prompts,
  copiedId,
  onCopy,
  onAdd
}: PinnedPromptsProps): React.JSX.Element {
  const items = project.pinnedPromptIds
    .map((id) => prompts.find((p) => p.id === id))
    .filter((p): p is Prompt => p !== undefined)
  const remove = (id: ID): void => change({ pinnedPromptIds: project.pinnedPromptIds.filter((x) => x !== id) })
  return (
    <>
      <div className="cf-gh">
        <span className="gh">常用提示词</span>
        <span className="grow" />
        <Button variant="plain" size="sm" icon="plus" onClick={onAdd}>
          添加…
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="group cf-pempty lbl">把这个项目最常用的几条提示词放在这里，单击就能复制。</div>
      ) : (
        items.map((p) => (
          <div key={p.id} className="card cf-pitem">
            <button type="button" className="cf-pcard" aria-label={`复制提示词「${p.title}」`} onClick={() => onCopy(p)}>
              <span className="cf-ptitle">
                <span className="t">{p.title}</span>
                <Tag size="xs">{p.category}</Tag>
              </span>
              <span className="cf-pbody cf-clamp">{p.body}</span>
              <span className="cf-pfoot">
                <span className="meta">用过 {p.uses} 次</span>
                <span className="hv">点击复制</span>
              </span>
            </button>
            <button
              type="button"
              className="eye soft"
              aria-label={`从常用中移除「${p.title}」`}
              title="从常用中移除"
              onClick={() => remove(p.id)}
            >
              <Icon name="xmark" size={13} strokeWidth={2} />
            </button>
            {copiedId === p.id && (
              <span className="done cf-pdone">
                <Icon name="check" size={11} strokeWidth={2.4} />
                已复制
              </span>
            )}
          </div>
        ))
      )}
    </>
  )
}

// ---------- 危险操作 ----------

export function DangerZone({ onDelete }: { onDelete: () => void }): React.JSX.Element {
  return (
    <GroupList title="危险操作">
      <div className="rowi">
        <div className="cf-dtext">
          <span>删除项目</span>
          <span className="lbl">配置、构思和资料会一起移到废纸篓，可以在访达里找回。</span>
        </div>
        <Button className="cf-danger" icon="trash" onClick={onDelete}>
          删除项目…
        </Button>
      </div>
    </GroupList>
  )
}
