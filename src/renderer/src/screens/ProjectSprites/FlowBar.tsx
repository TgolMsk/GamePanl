// 角色的制作流程：设定 → 定妆照 → 动作清单 → 生成视频 → 拆帧质检 → 保存。
// 每一步显示做到哪了，点一下直接去那一步；右边是「下一步」和软件里生成的入口。
import type { CharacterRun, CharacterOutput } from '@renderer/sprites/engine'
import { Button, Icon, IconButton, cx } from '@renderer/ui'
import { actionFacing, anchorRef, SPRITE_FACING_LABELS, viewFacings, type SpriteCharacter, type SpriteFacing, type SpriteOwner } from '@shared/sprites'
import type { ID } from '@shared/types'
import { activeJobs, costText, isActive, useGen } from './gen'

export interface FlowBarProps {
  owner: SpriteOwner
  ch: SpriteCharacter
  run: CharacterRun | undefined
  /** 全部动作都处理完、结果和当前数据对得上 */
  output: CharacterOutput | null
  ready: boolean
  onRefs: () => void
  onAnchor: (facing: SpriteFacing) => void
  onTemplate: () => void
  onSelectAction: (id: ID) => void
  /** 软件里一次生成全部待生成动作（先确认费用） */
  onGenerateAll: (actionIds: ID[]) => void
  onQuickSave: () => void
  onExport: () => void
  onJobs: () => void
  onSettings: () => void
}

interface Step {
  id: string
  label: string
  detail: string
  done: boolean
  go: () => void
}

/** 动作要用到的朝向（还没有动作时按视角的第一个朝向） */
export function neededFacings(ch: SpriteCharacter): SpriteFacing[] {
  const used = [...new Set(ch.actions.map((a) => actionFacing(ch.view, a.name)))]
  return used.length ? used : viewFacings(ch.view).slice(0, 1)
}

export function FlowBar(p: FlowBarProps): React.JSX.Element {
  const { owner, ch, run, output } = p
  const jobs = useGen((s) => s.jobs)
  const settings = useGen((s) => s.settings)
  const tools = useGen((s) => s.tools)
  const facings = neededFacings(ch)
  const missing = facings.find((f) => !anchorRef(ch, f)) ?? null
  const planned = ch.actions.filter((a) => !a.video)
  const filmed = ch.actions.filter((a) => a.video)
  const failed = filmed.filter((a) => run?.phases[a.id] === 'error')
  const warnings = output?.actions.reduce((n, o) => n + o.warnings, 0) ?? 0
  const lastTake = Math.max(0, ...ch.actions.flatMap((a) => a.takes.map((t) => Date.parse(t.addedAt) || 0)))
  const saved = !!ch.exportPrefs.lastExportAt && Date.parse(ch.exportPrefs.lastExportAt) >= lastTake
  const generating = activeJobs(jobs, owner, ch.id).filter((j) => j.kind === 'video')
  const busyIds = new Set(generating.map((j) => j.actionId))
  /** 能在软件里生成的：待生成、有定妆照、还没在生成 */
  const batch = planned.filter((a) => !busyIds.has(a.id) && anchorRef(ch, actionFacing(ch.view, a.name)))
  const allJobs = jobs.filter(isActive).length
  /** 设定图和定妆照只在还要生成新视频时才需要；动作都拍好了（比如视频是直接导入的）就不再催 */
  const setupNeeded = !ch.actions.length || planned.length > 0

  const steps: Step[] = [
    {
      id: 'design',
      label: '设定',
      detail: ch.refs.length ? `${ch.refs.filter((r) => !r.facing).length} 张人物图` : ch.description.trim() ? '画设定图' : '写描述、画设定图',
      done: ch.refs.length > 0,
      go: p.onRefs
    },
    {
      id: 'anchor',
      label: '定妆照',
      detail: missing ? `缺${SPRITE_FACING_LABELS[missing]}` : `${facings.map((f) => SPRITE_FACING_LABELS[f]).join('、')}`,
      done: !missing,
      go: () => (ch.refs.length ? p.onAnchor(missing ?? facings[0]) : p.onRefs())
    },
    {
      id: 'actions',
      label: '动作清单',
      detail: ch.actions.length ? `${ch.actions.length} 个动作` : '选模板',
      done: ch.actions.length > 0,
      go: p.onTemplate
    },
    {
      id: 'videos',
      label: '生成视频',
      detail: ch.actions.length ? `${filmed.length}/${ch.actions.length}${generating.length ? ` · 生成中 ${generating.length}` : ''}` : '—',
      done: ch.actions.length > 0 && planned.length === 0,
      go: () => {
        const a = planned[0] ?? ch.actions[0]
        if (a) p.onSelectAction(a.id)
        else p.onTemplate()
      }
    },
    {
      id: 'frames',
      label: '拆帧质检',
      detail: !filmed.length ? '—' : failed.length ? `${failed.length} 个失败` : !p.ready ? '处理中…' : warnings ? `${warnings} 个警告` : '通过',
      done: filmed.length > 0 && p.ready && failed.length === 0,
      go: () => {
        const bad = failed[0] ?? filmed.find((a) => (output?.actions.find((o) => o.actionId === a.id)?.warnings ?? 0) > 0) ?? filmed[0]
        if (bad) p.onSelectAction(bad.id)
      }
    },
    {
      id: 'save',
      label: '保存',
      detail: saved ? '已保存' : filmed.length ? '存进 2D 资产库' : '—',
      done: saved && planned.length === 0,
      go: p.onExport
    }
  ]

  // 下一步：第一个没做完的步骤要做的事
  let next: { label: string; run: () => void; disabled?: boolean } | null = null
  if (setupNeeded && !ch.refs.length) next = { label: ch.description.trim() ? '下一步：画设定图' : '下一步：写人物描述', run: p.onRefs }
  else if (setupNeeded && missing) next = { label: `下一步：做${SPRITE_FACING_LABELS[missing]}定妆照`, run: () => p.onAnchor(missing) }
  else if (!ch.actions.length) next = { label: '下一步：选动作清单', run: p.onTemplate }
  else if (planned.length) {
    const a = planned.find((x) => !busyIds.has(x.id)) ?? planned[0]
    next = { label: `下一个待生成：${a.name}`, run: () => p.onSelectAction(a.id) }
  } else if (failed.length) next = { label: `看看「${failed[0].name}」`, run: () => p.onSelectAction(failed[0].id) }
  else if (!p.ready) next = { label: '拆帧处理中…', run: () => undefined, disabled: true }
  else if (!saved) next = { label: '存进 2D 资产库', run: p.onQuickSave }
  const current = steps.find((s) => !s.done && (setupNeeded || (s.id !== 'design' && s.id !== 'anchor')))?.id

  return (
    <div className="sp-flow" role="navigation" aria-label={`「${ch.name}」的制作流程`}>
      <ol className="sp-flow-steps">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button type="button" className={cx('sp-flow-step', s.done && 'is-done', s.id === current && 'current')} onClick={s.go} aria-current={s.id === current ? 'step' : undefined}>
              <span className="no">{s.done ? <Icon name="check" size={11} strokeWidth={2.4} /> : i + 1}</span>
              <span className="tx">
                <span className="nm">{s.label}</span>
                <span className="dt">{s.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="sp-flow-actions">
        {next && (
          <Button size="sm" variant="primary" disabled={next.disabled} onClick={next.run}>
            {next.label}
          </Button>
        )}
        {batch.length > 0 && tools?.bl && settings && (
          <Button size="sm" icon="sparkles" onClick={() => p.onGenerateAll(batch.map((a) => a.id))} title={`用百炼万相在软件里生成 ${batch.length} 个待生成动作，每个 ${settings.takes} 个版本`}>
            全部生成 · {costText(settings, batch.length * settings.takes)}
          </Button>
        )}
        <Button size="sm" variant="plain" icon="list" onClick={p.onJobs} title="软件里生成的任务">
          {allJobs ? `任务 ${allJobs}` : '任务'}
        </Button>
        <IconButton icon="slider" label="生成设置" onClick={p.onSettings} />
      </div>
    </div>
  )
}
