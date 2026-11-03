import './sprites.css'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useProject, useSpriteCharacters } from '@renderer/app/data'
import { useFileDrop, usePasteImage } from '@renderer/app/drop'
import { hud } from '@renderer/app/hud'
import { isCmdKey, isPlainKey, useMainKeys } from '@renderer/screens/Library/keys'
import { showError } from '@renderer/screens/Library/shared'
import {
  characterPrefix,
  characterSignature,
  processCharacter,
  retainActions,
  useSpriteRuns,
  actionKey,
  type ActionOutput,
  type CharacterRun
} from '@renderer/sprites/engine'
import { stripRgba } from '@renderer/sprites/pipeline'
import { Button, ConfirmSheet, EmptyState, Icon, Sheet, TextField, Toolbar, cx } from '@renderer/ui'
import { spriteRefUrl, type SpriteImportResult } from '@shared/api'
import { SPRITE_VIDEO_MODELS, type SpriteJob } from '@shared/spriteGen'
import type { ID } from '@shared/types'
import type { SpriteAction, SpriteActionParams, SpriteCharacter, SpriteFacing, SpriteFrameEdit, SpriteOwner, SpriteSettings } from '@shared/sprites'
import { anchorRef, buildSpritePrompt } from '@shared/sprites'
import { buildPayload, sheetCols } from './bundle'
import { FlowBar, neededFacings } from './FlowBar'
import { costText, expectDownload, installGen, useGen } from './gen'
import { GenSettingsSheet, JobsSheet } from './GenSheets'
import { Inspector } from './Inspector'
import { PixelBar } from './PixelBar'
import { ExportSheet, WatermarkSheet } from './Sheets'
import { FirstFrame, setEdit, Stage } from './Stage'
import { SEL_KEY, rememberSpriteSelection } from './selection'
import { Refs } from './Refs'
import { AnchorSheet } from './Anchor'
import { Generate, PromptSheet } from './Generate'
import { TemplateSheet } from './TemplateSheet'
import { NewGroupSheet, AddPlannedSheet, ExtractSheet } from './PlanSheets'

function restoreSel(owner: SpriteOwner): { c: ID | null; a: ID | null } {
  try {
    const v = JSON.parse(localStorage.getItem(SEL_KEY(owner)) ?? 'null') as { c?: unknown; a?: unknown } | null
    return { c: typeof v?.c === 'string' ? v.c : null, a: typeof v?.a === 'string' ? v.a : null }
  } catch {
    return { c: null, a: null }
  }
}

const isSpriteFile = (n: string): boolean => /\.(mp4|mov|m4v|png|jpe?g|webp)$/i.test(n)
const COLLAPSED_KEY = 'gamepanl.sprites.collapsed'
const videoCount = (c: SpriteCharacter): number => c.actions.filter((a) => a.video).length
const groupId = (c: SpriteCharacter, a: SpriteAction): ID | null => c.groups.some((g) => g.id === a.group) ? a.group : null

function restoreCollapsed(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, v]) => v === true)) : {}
  } catch { return {} }
}

function reportImport(r: SpriteImportResult): void {
  const made = [...r.created, ...r.merged]
  const parts: string[] = []
  if (r.created.length) parts.push(r.created.map((c) => `新角色「${c.name}」`).join('、'))
  if (r.placed.length) {
    const how = { take: '新版本', filled: '补上了', new: '新动作' }
    const names = r.placed.slice(0, 3).map((p) => `${p.action}（${how[p.how]}）`).join('、')
    parts.push(`${r.placed.length} 个视频放进了动作：${names}${r.placed.length > 3 ? '…' : ''}`)
  }
  if (r.refs) parts.push(`${r.refs} 张人物图`)
  if (r.skipped.length) parts.push(`跳过 ${r.skipped.length} 个（${r.skipped[0].reason}）`)
  if (parts.length || made.length) hud.show(parts.join('；') || '没有导入任何文件', { ok: r.skipped.length === 0 })
}

function phaseText(run: CharacterRun | undefined, a: SpriteAction, out: ActionOutput | undefined): { text: string; err?: boolean } {
  const ph = run?.phases[a.id]
  if (ph === 'error') return { text: run?.errors[a.id] ?? '处理失败', err: true }
  if (run?.running && ph && ph !== 'done') return { text: ph === 'loading' ? '读取视频…' : ph === 'analyzing' ? '分析中…' : '出图中…' }
  if (!out) return { text: run?.running ? '排队中…' : '选中后处理' }
  const own = a.params.height !== null || a.params.colors !== null ? ' · 单独像素' : ''
  return { text: `${out.analysis.kind === 'loop' ? '循环' : '单次'} · ${out.frames.length} 帧 · ${out.frameWidth}×${out.frameHeight}${own}` }
}

/** 项目 · 序列帧 */
export default function ProjectSpritesScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useProject(projectId)
  return <SpritesScreen key={projectId} owner={projectId} title={project.data?.name ?? ''} projectHeight={project.data?.sizes?.character?.h ?? null} />
}

/** 全局库 · 序列帧：不属于哪个项目，导出时可以存进图片素材 */
export function LibrarySpritesScreen(): React.JSX.Element {
  return <SpritesScreen owner={null} title="全局库" projectHeight={null} />
}

/**
 * 序列帧：AI 绿幕动作视频 → 像素序列帧 + 引擎文件。
 * 拖进视频（一个文件夹一个角色）后自动处理；改参数后自动重算（只重算受影响的部分）。
 */
function SpritesScreen({ owner, title, projectHeight }: { owner: SpriteOwner; title: string; projectHeight: number | null }): React.JSX.Element {
  const chars = useSpriteCharacters(owner)
  const [sel, setSel] = useState(() => restoreSel(owner))
  const ch = chars.data.find((c) => c.id === sel.c) ?? chars.data[0] ?? null
  const action = sel.c === ch?.id && sel.a === 'refs' ? null : ch?.actions.find((a) => a.id === sel.a) ?? ch?.actions[0] ?? null
  const refsSelected = !!ch && !action
  const run = useSpriteRuns((s) => (ch ? s[ch.id] : undefined))
  const runs = useSpriteRuns()
  const output = run?.output ?? null
  const out = output?.actions.find((o) => o.actionId === action?.id)

  const [cur, setCur] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [wmOpen, setWmOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [plannedOpen, setPlannedOpen] = useState(false)
  /** 「从这个视频再抽一个动作」的原动作 */
  const [extractFrom, setExtractFrom] = useState<ID | null>(null)
  const [anchorFor, setAnchorFor] = useState<SpriteFacing | null>(null)
  /** 定妆照编辑器先选的人物图（刚画好、刚收进来的） */
  const [anchorFrom, setAnchorFrom] = useState<ID | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  const [jobsOpen, setJobsOpen] = useState(false)
  /** 等确认费用的一批待生成动作 */
  const [confirmGen, setConfirmGen] = useState<ID[] | null>(null)
  const genSettings = useGen((s) => s.settings)
  const [collapsed, setCollapsed] = useState(restoreCollapsed)
  const [renaming, setRenaming] = useState<{ kind: 'char' | 'action' | 'group'; id: ID; value: string } | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'char' | 'action'; id: ID; name: string } | null>(null)
  const stageRef = useRef<HTMLElement>(null)

  const select = (c: ID | null, a: ID | null, character?: SpriteCharacter): void => {
    setSel({ c, a })
    rememberSpriteSelection(owner, c, a)
    if (c && a && a !== 'refs') {
      const target = character ?? chars.data.find((x) => x.id === c)
      const act = target?.actions.find((x) => x.id === a)
      if (target && act) setGroupCollapsed(c, groupId(target, act), false)
    }
  }

  const setGroupCollapsed = (c: ID, group: ID | null, closed: boolean): void => {
    setCollapsed((prev) => {
      const next = { ...prev, [`${owner ?? 'library'}:${c}:${group ?? 'ungrouped'}`]: closed }
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)) } catch { /* 下次仍可展开 */ }
      return next
    })
  }

  useEffect(() => {
    setCur(0)
    setPlaying(true)
    setPromptOpen(false)
    setWmOpen(false)
  }, [action?.id, action?.video])

  // 数据变了就重算（停顿 120 ms 再算，连续改参数时只算最后一次）；结果已经对得上就不算
  const sig = ch ? characterSignature(ch) : ''
  const chRef = useRef(ch)
  chRef.current = ch
  const first = useRef(true)
  useEffect(() => {
    const c = chRef.current
    if (!c) return
    retainActions(c.actions.filter((a) => a.video).map((a) => actionKey(owner, c, a)), characterPrefix(owner, c))
    if (!c.actions.some((a) => a.video)) return
    const done = useSpriteRuns.getState()[c.id]?.output?.character
    if (done && characterSignature(done) === sig) return
    const t = setTimeout(() => void processCharacter(owner, c), first.current ? 0 : 120)
    first.current = false
    return () => clearTimeout(t)
  }, [sig, owner])

  const applyChar = (c: SpriteCharacter): void => chars.mutate((list) => list.map((x) => (x.id === c.id ? c : x)))

  const guard = async (what: string, fn: () => Promise<SpriteCharacter | void>): Promise<boolean> => {
    try {
      const c = await fn()
      if (c) applyChar(c)
      return true
    } catch (err) {
      showError(what, err)
      void chars.refresh()
      return false
    }
  }

  useEffect(() => installGen(), [])

  // 后台事件：从「下载」收进来的文件、生成任务做完、要提示的话
  const latest = useRef({ chars: chars.data, select, applyChar })
  latest.current = { chars: chars.data, select, applyChar }
  const jobStates = useRef(new Map<ID, SpriteJob['state']>())
  useEffect(() => {
    const openAnchor = (characterId: ID, refId: ID | null, facing?: SpriteFacing | null): void => {
      const c = latest.current.chars.find((x) => x.id === characterId)
      if (!c) return
      const needed = neededFacings(c)
      latest.current.select(characterId, 'refs')
      setAnchorFrom(refId)
      setAnchorFor(facing ?? needed.find((f) => !anchorRef(c, f)) ?? needed[0])
    }
    const finished = (j: SpriteJob): void => {
      if (j.owner !== owner) return
      if (j.state === 'failed') hud.show(`${j.characterName} · ${j.label} 没生成成功：${j.message}`, { action: { label: '查看任务', run: () => setJobsOpen(true) } })
      else if (j.state === 'done' && j.kind === 'video' && j.actionId) {
        const aid = j.actionId
        hud.show(`「${j.characterName}」的 ${j.label} 生成好了`, { ok: true, action: { label: '查看', run: () => latest.current.select(j.characterId, aid) } })
      } else if (j.state === 'done' && j.kind === 'image') {
        hud.show(`「${j.characterName}」的${j.label.replace(' · ', '')}画好了，已放进人物素材`, { ok: true, action: { label: '做成定妆照', run: () => openAnchor(j.characterId, j.resultId, j.facing) } })
      }
    }
    return window.gp.onSpriteEvent((e) => {
      if (e.type === 'notice') hud.show(e.message)
      else if (e.type === 'jobs') {
        const prev = jobStates.current
        const next = new Map(e.jobs.map((j) => [j.id, j.state]))
        for (const j of e.jobs) {
          const was = prev.get(j.id)
          if ((was === 'running' || was === 'queued') && (j.state === 'done' || j.state === 'failed')) finished(j)
        }
        jobStates.current = next
      } else if (e.type === 'inbox' && e.event.owner === owner) {
        const ev = e.event
        if (ev.takeId && ev.actionId) {
          const { actionId, takeId } = ev
          hud.show(`已把下载的视频收进「${ev.characterName}」的 ${ev.actionName}`, {
            ok: true,
            action: {
              label: '撤销',
              run: () => void window.gp.sprites.deleteTake(owner, ev.characterId, actionId, takeId).then((c) => {
                latest.current.applyChar(c)
                hud.show('已撤销，这个视频移出了动作')
              }, (err) => showError('没能撤销', err))
            }
          })
        } else if (ev.refId) {
          const refId = ev.refId
          hud.show(`已把下载的图片收进「${ev.characterName}」的人物素材`, { ok: true, action: { label: '做成定妆照', run: () => openAnchor(ev.characterId, refId) } })
        }
      }
    })
  }, [owner])

  const createBlank = async (): Promise<void> => {
    try {
      const c = await window.gp.sprites.createBlank(owner)
      chars.mutate((list) => [...list.filter((x) => x.id !== c.id), c])
      select(c.id, 'refs')
      hud.show(`已新建「${c.name}」：写人物描述，再让 AI 画设定图`, { ok: true, action: { label: '改名', run: () => setRenaming({ kind: 'char', id: c.id, value: c.name }) } })
    } catch (err) {
      showError('没能新建角色', err)
    }
  }

  const pasteImage = async (): Promise<void> => {
    try {
      const r = await window.gp.sprites.addRefsFromClipboard(owner, ch?.id ?? null)
      if (!r) {
        hud.show('剪贴板里没有图片')
        return
      }
      chars.mutate((list) => [...list.filter((x) => x.id !== r.character.id), r.character])
      if (r.added) select(r.character.id, 'refs')
      hud.show(r.added ? `已粘贴进「${r.character.name}」的人物素材` : r.skipped[0]?.reason ?? '没有粘贴', { ok: r.added > 0 })
    } catch (err) {
      showError('粘贴失败', err)
    }
  }

  const startGenerate = async (actionIds: ID[]): Promise<void> => {
    if (!ch) return
    try {
      const jobs = await window.gp.sprites.generateVideos(owner, ch.id, actionIds)
      hud.show(`已开始生成 ${jobs.length} 个视频，做好自动放进对应动作`, { action: { label: '查看任务', run: () => setJobsOpen(true) } })
    } catch (err) {
      showError('没能开始生成', err)
    }
  }

  const quickSave = async (): Promise<void> => {
    if (!ch || !output) return
    try {
      const prefs = ch.exportPrefs
      if (!prefs.toAssets2D) applyChar(await window.gp.sprites.update(owner, ch.id, { exportPrefs: { ...prefs, toAssets2D: true } }))
      const r = await window.gp.sprites.export(owner, ch.id, buildPayload(ch, output, prefs.scale, new Set(prefs.skip)), null, { actions: {} })
      const first = r.assets2d[0]
      hud.show(first ? `已存进 2D 资产库「${first.name}」${r.assets2d.length > 1 ? ` 等 ${r.assets2d.length} 个` : ''}` : '已保存', { ok: true })
    } catch (err) {
      showError('没能存进 2D 资产库', err)
    }
  }

  const setParams = (patch: Partial<SpriteActionParams>): void => {
    if (!ch || !action) return
    const params = { ...action.params, ...patch }
    applyChar({ ...ch, actions: ch.actions.map((a) => (a.id === action.id ? { ...a, params } : a)) })
    void guard('没能保存参数', () => window.gp.sprites.updateAction(owner, ch.id, action.id, { params }))
  }
  const setEdits = (edits: SpriteFrameEdit[]): void => {
    if (!ch || !action) return
    applyChar({ ...ch, actions: ch.actions.map((a) => (a.id === action.id ? { ...a, edits } : a)) })
    void guard('没能保存换帧', () => window.gp.sprites.updateAction(owner, ch.id, action.id, { edits }))
  }
  const setSettings = (patch: Partial<SpriteSettings>): void => {
    if (!ch) return
    const settings = { ...ch.settings, ...patch }
    applyChar({ ...ch, settings })
    void guard('没能保存设置', () => window.gp.sprites.update(owner, ch.id, { settings }))
  }

  const importFiles = async (paths?: string[], target = false): Promise<void> => {
    try {
      const r = await window.gp.sprites.create(owner, paths, target ? { target: ch ? { id: ch.id, actionId: action?.id ?? null } : null } : undefined)
      const made = [...new Map([...r.created, ...r.merged].map((c) => [c.id, c])).values()]
      if (made.length) {
        chars.mutate((list) => [...list.filter((c) => !made.some((m) => m.id === c.id)), ...made])
        const placed = r.placed[0]
        const c = made.find((x) => x.id === placed?.characterId)
          ?? made.find((x) => x.refs.length > (chars.data.find((old) => old.id === x.id)?.refs.length ?? 0))
          ?? made[0]
        select(c.id, placed?.actionId ?? 'refs')
        const importedAction = c.actions.find((a) => a.id === placed?.actionId)
        if (importedAction) setGroupCollapsed(c.id, groupId(c, importedAction), false)
      }
      if (made.length || r.skipped.length) reportImport(r)
    } catch (err) {
      showError('导入失败', err)
    }
  }

  const addActions = async (c: SpriteCharacter, actionId?: ID): Promise<void> => {
    try {
      const r = await window.gp.sprites.addActions(owner, c.id, undefined, actionId)
      applyChar(r.character)
      if (r.placed.length || r.refs) {
        select(c.id, r.placed[0]?.actionId ?? 'refs')
        const importedAction = r.character.actions.find((a) => a.id === r.placed[0]?.actionId)
        if (importedAction) setGroupCollapsed(c.id, groupId(r.character, importedAction), false)
      }
      reportImport({ ...r, created: [], merged: r.placed.length || r.refs ? [r.character] : [] })
    } catch (err) {
      showError('添加失败', err)
    }
  }

  const addRefs = async (c: SpriteCharacter): Promise<void> => {
    try {
      const r = await window.gp.sprites.addRefs(owner, c.id)
      applyChar(r.character)
      if (r.added) select(c.id, 'refs')
      if (r.added || r.skipped.length) reportImport({ created: [], merged: r.added ? [r.character] : [], placed: [], refs: r.added, skipped: r.skipped })
    } catch (err) { showError('添加人物图失败', err) }
  }

  useFileDrop((paths) => void importFiles(paths, true), {
    label: ch ? `松手加到「${ch.name}」` : '松手导入',
    hint: '视频按文件名归到动作，图片进人物素材；文件夹是一个新角色',
    accept: (f) => isSpriteFile(f.name) || (f.type === '' && !/\.[^./]+$/.test(f.name)),
    reject: '只能导入视频（mp4 / mov / m4v）、人物图（png / jpg / webp）或文件夹'
  })

  usePasteImage((p) => (p.kind === 'files' ? void importFiles(p.paths, true) : void pasteImage()), {
    accept: (f) => isSpriteFile(f.name) || (f.type === '' && !/\.[^./]+$/.test(f.name)),
    reject: '只能粘贴视频（mp4 / mov / m4v）、人物图（png / jpg / webp）或文件夹'
  })

  const copySheet = async (): Promise<void> => {
    if (!out || !ch) return
    const s = stripRgba(out.frames, out.frameWidth, out.frameHeight, sheetCols(ch.settings.cols, out.frames.length))
    try {
      await window.gp.sprites.copyImage(s.rgba, s.width, s.height)
      hud.show(`已复制「${action?.name}」的 Sprite Sheet · ${s.width}×${s.height}`, { ok: true })
    } catch (err) {
      showError('复制失败', err)
    }
  }

  const jumpTo = (frame: number): void => {
    if (!out) return
    let best = 0
    out.analysis.picks.forEach((p, k) => {
      if (Math.abs(p.frame - frame) < Math.abs(out.analysis.picks[best].frame - frame)) best = k
    })
    setPlaying(false)
    setCur(best)
  }

  useMainKeys(stageRef, (e) => {
    if (!out) return
    const n = out.frames.length
    if (isPlainKey(e, ' ')) {
      e.preventDefault()
      setPlaying(!playing)
    } else if (isPlainKey(e, 'ArrowLeft', 'ArrowRight')) {
      e.preventDefault()
      setPlaying(false)
      setCur((Math.min(cur, n - 1) + (e.key === 'ArrowLeft' ? n - 1 : 1)) % n)
    } else if (isPlainKey(e, 'Backspace', 'Delete')) {
      const pk = out.analysis.picks[Math.min(cur, n - 1)]
      if (!pk || n <= 1 || !action) return
      e.preventDefault()
      setEdits(setEdit(action.edits, pk.base, null))
    } else if (isCmdKey(e, 'c')) {
      if (document.getSelection()?.isCollapsed === false) return
      e.preventDefault()
      void copySheet()
    }
  })

  const charMenu = async (e: ReactMouseEvent, c: SpriteCharacter): Promise<void> => {
    e.preventDefault()
    if (c.id !== ch?.id) select(c.id, c.actions[0]?.id ?? 'refs')
    const picked = await showContextMenu(e, [
      { id: 'add', label: '添加动作视频…' },
      { id: 'refs', label: '添加人物图…' },
      { id: 'template', label: '动作清单（模板 / 照搬其他角色）…' },
      { id: 'planned', label: '添加待生成动作…' },
      { id: 'group', label: '新建分组…' },
      menuSeparator,
      { id: 'rename', label: '重命名…' },
      { id: 'export', label: '导出…', enabled: videoCount(c) > 0 },
      menuSeparator,
      { id: 'delete', label: '删除角色', destructive: true }
    ])
    if (picked === 'add') void addActions(c)
    else if (picked === 'refs') void addRefs(c)
    else if (picked === 'template') setTemplateOpen(true)
    else if (picked === 'planned') setPlannedOpen(true)
    else if (picked === 'group') setGroupOpen(true)
    else if (picked === 'rename') setRenaming({ kind: 'char', id: c.id, value: c.name })
    else if (picked === 'export') setExporting(true)
    else if (picked === 'delete') setDeleting({ kind: 'char', id: c.id, name: c.name })
  }

  const actionMenu = async (e: ReactMouseEvent, c: SpriteCharacter, a: SpriteAction): Promise<void> => {
    e.preventDefault()
    select(c.id, a.id)
    const k = c.actions.indexOf(a)
    const group = groupId(c, a)
    const siblings = c.actions.filter((x) => groupId(c, x) === group)
    const position = siblings.indexOf(a)
    const picked = await showContextMenu(e, [
      { id: 'rename', label: '重命名…' },
      { id: 'move', label: '移到分组', submenu: [
        ...c.groups.map((g) => ({ id: `group:${g.id}`, label: g.name, checked: g.id === group, enabled: g.id !== group })),
        { id: 'ungrouped', label: '未分组', checked: group === null, enabled: group !== null }
      ] },
      { id: 'prompt', label: '复制生成提示词' },
      { id: 'version', label: '添加新版本视频…' },
      { id: 'extract', label: '从这个视频再抽一个动作…', enabled: !!a.video },
      { id: 'up', label: '上移', enabled: position > 0 },
      { id: 'down', label: '下移', enabled: position < siblings.length - 1 },
      menuSeparator,
      { id: 'delete', label: '删除动作', destructive: true }
    ])
    if (picked === 'rename') setRenaming({ kind: 'action', id: a.id, value: a.name })
    else if (picked?.startsWith('group:') || picked === 'ungrouped') {
      const nextGroup = picked === 'ungrouped' ? null : picked.slice(6)
      void guard('没能移动动作', () => window.gp.sprites.updateAction(owner, c.id, a.id, { group: nextGroup })).then((ok) => {
        if (ok) setGroupCollapsed(c.id, nextGroup, false)
      })
    } else if (picked === 'prompt') {
      try {
        const text = buildSpritePrompt(c, a).prompt
        await window.gp.clipboard.copyText(text)
        expectDownload(owner, c.id, a.id, text)
        hud.show(genSettings?.inbox ? `已复制生成提示词；下载的视频会自动放进「${a.name}」` : '已复制生成提示词', { ok: true })
      } catch (err) { showError('复制失败', err) }
    } else if (picked === 'version') void addActions(c, a.id)
    else if (picked === 'extract') setExtractFrom(a.id)
    else if (picked === 'up' || picked === 'down') {
      const order = c.actions.map((x) => x.id)
      const neighbor = siblings[position + (picked === 'up' ? -1 : 1)]
      if (!neighbor) return
      const j = c.actions.indexOf(neighbor)
      ;[order[k], order[j]] = [order[j], order[k]]
      void guard('没能调整顺序', () => window.gp.sprites.reorderActions(owner, c.id, order))
    } else if (picked === 'delete') setDeleting({ kind: 'action', id: a.id, name: a.name })
  }

  const groupMenu = async (e: ReactMouseEvent, c: SpriteCharacter, id: ID): Promise<void> => {
    const index = c.groups.findIndex((g) => g.id === id)
    const group = c.groups[index]
    if (!group) return
    const picked = await showContextMenu(e, [
      { id: 'rename', label: '重命名…' },
      { id: 'up', label: '上移', enabled: index > 0 },
      { id: 'down', label: '下移', enabled: index < c.groups.length - 1 },
      menuSeparator,
      { id: 'delete', label: '删除分组', destructive: true }
    ])
    if (picked === 'rename') setRenaming({ kind: 'group', id, value: group.name })
    else if (picked === 'delete') {
      void guard('没能删除分组', () => window.gp.sprites.update(owner, c.id, { groups: c.groups.filter((g) => g.id !== id) }))
    } else if (picked === 'up' || picked === 'down') {
      const groups = [...c.groups]
      const next = index + (picked === 'up' ? -1 : 1)
      if (!groups[next]) return
      ;[groups[index], groups[next]] = [groups[next], groups[index]]
      void guard('没能调整分组顺序', () => window.gp.sprites.update(owner, c.id, { groups }))
    }
  }

  const failed = ch && run ? ch.actions.filter((a) => a.video && run.phases[a.id] === 'error').map((a) => a.name) : []
  /** 当前动作之后（转一圈）的下一个待生成动作 */
  const nextPlanned = (() => {
    if (!ch) return null
    const k = action ? ch.actions.indexOf(action) : -1
    const order = [...ch.actions.slice(k + 1), ...ch.actions.slice(0, Math.max(0, k))]
    return order.find((a) => !a.video) ?? null
  })()
  const ready = !!ch && videoCount(ch) > 0 && !!output?.actions.length && !run?.running && characterSignature(output.character) === sig

  let body: React.ReactNode
  if (chars.loading) body = null
  else if (chars.data.length === 0 || !ch) {
    body = (
      <main className="screen-main">
        <EmptyState
          icon="film"
          title="还没有角色"
          hint="新建一个角色，写好人物描述让 AI 画设定图；或者拖入、⌘V 粘贴人物图（立绘、三视图）建角色。也可以直接拖入绿幕动作视频：一个文件夹是一个角色，里面每个视频是一个动作（idle、run、attack…）。"
        >
          <Button variant="primary" icon="plus" onClick={() => void createBlank()}>新建角色</Button>
          <Button onClick={() => void importFiles()}>导入…</Button>
        </EmptyState>
      </main>
    )
  } else {
    body = (
      <>
        <nav className="sp-list" aria-label="角色与动作">
          {chars.data.map((c) => {
            const r = runs[c.id]
            const expanded = c.id === ch.id
            const videos = videoCount(c)
            const ungrouped = c.actions.filter((a) => groupId(c, a) === null)
            const groups = [
              ...c.groups.map((g) => ({ ...g, actions: c.actions.filter((a) => a.group === g.id) })),
              ...(ungrouped.length ? [{ id: null, name: '未分组', actions: ungrouped }] : [])
            ]
            return (
              <div key={c.id} style={{ display: 'contents' }}>
                <div className={cx('sp-chr', expanded && 'selected')} onContextMenu={(e) => void charMenu(e, c)}>
                  <button type="button" className="sp-chr-select" aria-expanded={expanded} onClick={() => select(c.id, expanded ? (action?.id ?? 'refs') : c.actions[0]?.id ?? 'refs')} onDoubleClick={() => setRenaming({ kind: 'char', id: c.id, value: c.name })}>
                    <span className="sp-avatar">{c.mainRef ? <img src={spriteRefUrl(owner, c.id, c.mainRef, 64)} alt="" /> : <Icon name="film" size={16} />}</span>
                    <span className="nm">{c.name}</span>
                    <span className="ct">{videos === c.actions.length ? videos : `${videos}/${c.actions.length}`}</span>
                  </button>
                  <button type="button" className="more sp-add" aria-label={`${c.name} 的更多操作`} onClick={(e) => void charMenu(e, c)}>
                    <Icon name="ellipsis" size={14} />
                  </button>
                </div>
                {expanded && <>
                  <button type="button" className={cx('sp-refs-row', refsSelected && 'on')} onClick={() => select(c.id, 'refs')} aria-current={refsSelected ? 'page' : undefined}>
                    <Icon name="photo" size={16} /><span>人物素材</span><span className="ct">{c.refs.length}</span>
                  </button>
                  {groups.map((g) => {
                    const closed = collapsed[`${owner ?? 'library'}:${c.id}:${g.id ?? 'ungrouped'}`] === true
                    return <div key={g.id ?? 'ungrouped'} className="sp-group">
                      <button type="button" className={cx('sp-group-heading', closed && 'closed')} aria-expanded={!closed} onClick={() => setGroupCollapsed(c.id, g.id, !closed)} onContextMenu={g.id ? (e) => void groupMenu(e, c, g.id!) : undefined}>
                        <Icon name="chevron.down" size={11} /><span className="nm">{g.name}</span><span className="ct">{g.actions.filter((a) => a.video).length}/{g.actions.length}</span>
                      </button>
                      {!closed && g.actions.map((a) => {
                        const o = a.video ? r?.output?.actions.find((x) => x.actionId === a.id) : undefined
                        const ph = a.video ? phaseText(r, a, o) : { text: '待生成' }
                        const on = a.id === action?.id
                        return <button key={a.id} type="button" className={cx('sp-act', on && 'on')} onClick={() => select(c.id, a.id)} onContextMenu={(e) => void actionMenu(e, c, a)} title={a.video ? a.sourceName : `${a.name} · 待生成`} aria-current={on ? 'page' : undefined}>
                          <span className={cx('th', a.video ? 'checker' : 'planned')}>{a.video ? <FirstFrame out={o} size={40} /> : <Icon name="sparkles" size={18} />}</span>
                          <span className="tx"><span className="nm">{a.name}</span><span className={cx('mt', ph.err && 'err')}>{ph.text}{a.takes.length > 1 ? ` · ${a.takes.length} 个版本` : ''}</span></span>
                          {!!o?.warnings && <span className="sp-badge" title={`${o.warnings} 个质检警告`}>{o.warnings}</span>}
                        </button>
                      })}
                    </div>
                  })}
                  <button type="button" className="sp-add" onClick={() => void addActions(c)}>
                    <Icon name="plus" size={12} strokeWidth={2} />添加动作视频…
                  </button>
                  <button type="button" className="sp-add" onClick={() => setPlannedOpen(true)}>
                    <Icon name="sparkles" size={12} />添加待生成动作…
                  </button>
                </>}
              </div>
            )
          })}
        </nav>
        {refsSelected ? <Refs key={ch.id} owner={owner} ch={ch} onChange={applyChar} onSelectAction={(id) => select(ch.id, id)} onTemplate={() => setTemplateOpen(true)} onAnchor={setAnchorFor} onJobs={() => setJobsOpen(true)} /> : action && !action.video ? (
          <Generate
            key={action.id}
            owner={owner}
            ch={ch}
            action={action}
            onChange={applyChar}
            setParams={setParams}
            onRefs={() => select(ch.id, 'refs')}
            onImport={() => void addActions(ch, action.id)}
            onAnchor={setAnchorFor}
            onGenerate={(ids) => void startGenerate(ids)}
            onNext={nextPlanned ? () => select(ch.id, nextPlanned.id) : null}
            onJobs={() => setJobsOpen(true)}
          />
        ) : action ? (
          <Stage
            owner={owner}
            ch={ch}
            onChange={applyChar}
            onAddVersion={() => void addActions(ch, action.id)}
            onPrompt={() => setPromptOpen(true)}
            onExtract={() => setExtractFrom(action.id)}
            action={action}
            out={out}
            phase={run?.phases[action.id]}
            error={run?.errors[action.id]}
            cur={cur}
            setCur={setCur}
            playing={playing}
            setPlaying={setPlaying}
            onEdits={setEdits}
            onSegment={(start, end) => setParams({ start, end })}
            onRetry={() => void processCharacter(owner, ch)}
            stageRef={stageRef}
            pixelBar={<PixelBar ch={ch} action={action} projectHeight={projectHeight} onSettings={setSettings} onParams={setParams} />}
          />
        ) : null}
        {action?.video && <Inspector
          ch={ch}
          action={action}
          output={output}
          out={out}
          onSettings={setSettings}
          onParams={setParams}
          onApplyAll={() => {
            if (!action) return
            void guard('没能应用', () => window.gp.sprites.applyParamsToAll(owner, ch.id, action.params)).then((ok) =>
              ok && hud.show(`已把「${action.name}」的参数用到全部 ${videoCount(ch)} 个动作`, { ok: true })
            )
          }}
          onPickWatermark={() => setWmOpen(true)}
          onJump={jumpTo}
        />}
      </>
    )
  }

  const subtitle = ch
    ? `序列帧 · ${chars.data.length} 个角色${run?.running ? ' · 处理中…' : output ? ` · ${output.ms} ms` : ''}`
    : '序列帧'

  return (
    <div className="screen">
      <Toolbar title={title} subtitle={subtitle}>
        <Button icon="plus" onClick={() => void createBlank()} title="新建空角色：写人物描述，让 AI 画设定图">
          新建角色
        </Button>
        <Button onClick={() => void importFiles()}>
          导入…
        </Button>
        {ch && (
          <>
            <Button icon="copy" disabled={!out} onClick={() => void copySheet()} title="把当前动作的 Sprite Sheet 复制到剪贴板（⌘C）">
              复制 Sheet
            </Button>
            <Button variant="primary" icon="tray.down" disabled={!ready} onClick={() => setExporting(true)}>
              导出…
            </Button>
          </>
        )}
      </Toolbar>
      {ch && !chars.loading && (
        <FlowBar
          owner={owner}
          ch={ch}
          run={run}
          output={ready ? output : null}
          ready={ready}
          onRefs={() => select(ch.id, 'refs')}
          onAnchor={(f) => { setAnchorFrom(null); setAnchorFor(f) }}
          onTemplate={() => setTemplateOpen(true)}
          onSelectAction={(id) => select(ch.id, id)}
          onGenerateAll={setConfirmGen}
          onQuickSave={() => void quickSave()}
          onExport={() => setExporting(true)}
          onJobs={() => setJobsOpen(true)}
          onSettings={() => setGenOpen(true)}
        />
      )}
      <div className="screen-body">{body}</div>

      {ch && (
        <ExportSheet open={exporting} owner={owner} ch={ch} output={ready ? output : null} failed={failed} onClose={() => setExporting(false)} />
      )}
      {ch && templateOpen && <TemplateSheet key={ch.id} owner={owner} ch={ch} others={chars.data} onChange={applyChar} onClose={() => setTemplateOpen(false)} />}
      {ch && groupOpen && <NewGroupSheet key={ch.id} owner={owner} ch={ch} onChange={applyChar} onClose={() => setGroupOpen(false)} />}
      {ch && extractFrom && (
        <ExtractSheet
          owner={owner}
          ch={ch}
          actionId={extractFrom}
          onChange={applyChar}
          onSelectAction={(id, c) => {
            select(ch.id, id, c)
            const added = c.actions.find((x) => x.id === id)
            if (added) setGroupCollapsed(ch.id, groupId(c, added), false)
          }}
          onClose={() => setExtractFrom(null)}
        />
      )}
      {ch && plannedOpen && <AddPlannedSheet key={ch.id} owner={owner} ch={ch} onChange={applyChar} onSelectAction={(id, c) => select(ch.id, id, c)} onClose={() => setPlannedOpen(false)} />}
      {ch && anchorFor && <AnchorSheet key={`${ch.id}:${anchorFor}:${anchorFrom ?? ''}`} owner={owner} ch={ch} facing={anchorFor} from={anchorFrom} onChange={applyChar} onClose={() => { setAnchorFor(null); setAnchorFrom(null) }} onJobs={() => setJobsOpen(true)} />}
      {genOpen && <GenSettingsSheet onClose={() => setGenOpen(false)} />}
      {jobsOpen && <JobsSheet owner={owner} onClose={() => setJobsOpen(false)} onOpen={(j) => {
        setJobsOpen(false)
        if (j.kind === 'video' && j.actionId) select(j.characterId, j.actionId)
        else if (j.kind === 'image') {
          select(j.characterId, 'refs')
          if (j.facing) { setAnchorFrom(j.resultId); setAnchorFor(j.facing) }
        }
      }} />}
      {ch && genSettings && (
        <ConfirmSheet
          open={confirmGen !== null}
          title={`在软件里生成 ${confirmGen?.length ?? 0} 个动作？`}
          message={`每个动作 ${genSettings.takes} 个版本，共 ${(confirmGen?.length ?? 0) * genSettings.takes} 个视频（${SPRITE_VIDEO_MODELS[genSettings.videoModel].label} · ${genSettings.resolution} · ${genSettings.duration} 秒），按百炼价格${costText(genSettings, (confirmGen?.length ?? 0) * genSettings.takes)}。都用定妆照当首帧，做好自动放进对应动作。`}
          confirmLabel="开始生成"
          onCancel={() => setConfirmGen(null)}
          onConfirm={async () => {
            const ids = confirmGen
            setConfirmGen(null)
            if (ids) await startGenerate(ids)
          }}
        />
      )}
      {ch && action && promptOpen && <PromptSheet key={action.id} owner={owner} ch={ch} action={action} onChange={applyChar} onClose={() => setPromptOpen(false)} />}
      {action && (
        <WatermarkSheet
          out={wmOpen ? (out ?? null) : null}
          value={action.params.watermark}
          onClose={() => setWmOpen(false)}
          onSave={(watermark) => {
            setWmOpen(false)
            setParams({ watermark })
          }}
        />
      )}
      <RenameSheet
        value={renaming}
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          if (!renaming || !ch) return
          const target = chars.data.find((c) => renaming.kind === 'char' ? c.id === renaming.id : renaming.kind === 'group' ? c.groups.some((g) => g.id === renaming.id) : c.actions.some((a) => a.id === renaming.id))
          if (!target) return
          if (renaming.kind === 'group' && target.groups.some((g) => g.id !== renaming.id && g.name.toLowerCase() === name.toLowerCase())) {
            hud.show('已经有这个分组名了，换一个名字吧')
            return
          }
          const ok = await guard('没能重命名', () =>
            renaming.kind === 'char'
              ? window.gp.sprites.update(owner, target.id, { name })
              : renaming.kind === 'group'
                ? window.gp.sprites.update(owner, target.id, { groups: target.groups.map((g) => g.id === renaming.id ? { ...g, name } : g) })
              : window.gp.sprites.updateAction(owner, target.id, renaming.id, { name })
          )
          if (ok) setRenaming(null)
        }}
      />
      <ConfirmSheet
        open={deleting !== null}
        title={deleting?.kind === 'char' ? `删除角色「${deleting?.name}」？` : `删除动作「${deleting?.name}」？`}
        message={deleting?.kind === 'char' ? '角色、人物图和拷进来的源视频会移到废纸篓，已经导出的文件不受影响。' : '这个动作会被删除，已有的各版本视频会移到废纸篓。'}
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const d = deleting
          if (!d) return
          const target = chars.data.find((c) => (d.kind === 'char' ? c.id === d.id : c.actions.some((a) => a.id === d.id)))
          if (target) {
            if (d.kind === 'char') {
              if (!await guard('没能删除', () => window.gp.sprites.remove(owner, target.id))) return
              chars.mutate((list) => list.filter((c) => c.id !== target.id))
            } else if (!await guard('没能删除', () => window.gp.sprites.deleteAction(owner, target.id, d.id))) return
          }
          setDeleting(null)
        }}
      />
    </div>
  )
}

function RenameSheet({
  value,
  onClose,
  onSave
}: {
  value: { kind: 'char' | 'action' | 'group'; value: string } | null
  onClose: () => void
  onSave: (name: string) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  useEffect(() => setDraft(value?.value ?? ''), [value])
  const ok = draft.trim() !== '' && draft.trim() !== value?.value
  const save = (): void => {
    if (ok) void onSave(draft.trim())
  }
  const hint = useMemo(
    () => (value?.kind === 'action' ? '动作名就是导出的动画名和文件夹名（idle、run、attack…）' : value?.kind === 'group' ? '给这一组动作起个名字' : '角色名就是导出的文件夹名'),
    [value?.kind]
  )
  return (
    <Sheet
      open={value !== null}
      onClose={onClose}
      title={value?.kind === 'char' ? '重命名角色' : value?.kind === 'group' ? '重命名分组' : '重命名动作'}
      subtitle={hint}
      width={420}
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!ok} onClick={save}>
            重命名
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        maxLength={value?.kind === 'char' ? 80 : 40}
        aria-label={value?.kind === 'group' ? '分组名称' : value?.kind === 'char' ? '角色名称' : '动作名称'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
        }}
      />
    </Sheet>
  )
}
