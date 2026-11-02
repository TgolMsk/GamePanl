import './sprites.css'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useProject, useSpriteCharacters } from '@renderer/app/data'
import { useFileDrop } from '@renderer/app/drop'
import { hud } from '@renderer/app/hud'
import { isCmdKey, isPlainKey, useMainKeys } from '@renderer/screens/Library/keys'
import { showError } from '@renderer/screens/Library/shared'
import {
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
import type { SpriteImportResult } from '@shared/api'
import type { ID } from '@shared/types'
import type { SpriteAction, SpriteActionParams, SpriteCharacter, SpriteFrameEdit, SpriteSettings } from '@shared/sprites'
import { sheetCols } from './bundle'
import { Inspector } from './Inspector'
import { ExportSheet, WatermarkSheet } from './Sheets'
import { FirstFrame, setEdit, Stage } from './Stage'

const SEL_KEY = (projectId: ID): string => `gamepanl.sprites.sel.${projectId}`

function restoreSel(projectId: ID): { c: ID | null; a: ID | null } {
  try {
    const v = JSON.parse(localStorage.getItem(SEL_KEY(projectId)) ?? 'null') as { c?: unknown; a?: unknown } | null
    return { c: typeof v?.c === 'string' ? v.c : null, a: typeof v?.a === 'string' ? v.a : null }
  } catch {
    return { c: null, a: null }
  }
}

const isVideoName = (n: string): boolean => /\.(mp4|mov|m4v)$/i.test(n)

function reportImport(r: SpriteImportResult): void {
  const made = [...r.created, ...r.merged]
  if (made.length === 0) {
    hud.show(r.skipped[0] ? `没有导入：${r.skipped[0].reason}` : '没有导入任何视频')
    return
  }
  const parts: string[] = []
  if (r.created.length) parts.push(r.created.length === 1 ? `新角色「${r.created[0].name}」· ${r.created[0].actions.length} 个动作` : `${r.created.length} 个新角色`)
  if (r.merged.length) parts.push(`动作加进了「${r.merged.map((c) => c.name).join('、')}」`)
  if (r.skipped.length) parts.push(`跳过 ${r.skipped.length} 个（${r.skipped[0].reason}）`)
  hud.show(parts.join('；'), { ok: r.skipped.length === 0 })
}

function phaseText(run: CharacterRun | undefined, a: SpriteAction, out: ActionOutput | undefined): { text: string; err?: boolean } {
  const ph = run?.phases[a.id]
  if (ph === 'error') return { text: run?.errors[a.id] ?? '处理失败', err: true }
  if (run?.running && ph && ph !== 'done') return { text: ph === 'loading' ? '读取视频…' : ph === 'analyzing' ? '分析中…' : '出图中…' }
  if (!out) return { text: run?.running ? '排队中…' : '选中后处理' }
  return { text: `${out.analysis.kind === 'loop' ? '循环' : '单次'} · ${out.frames.length} 帧 · ${out.frameWidth}×${out.frameHeight}` }
}

/**
 * 项目 · 序列帧：AI 绿幕动作视频 → 像素序列帧 + 引擎文件。
 * 拖进视频（一个文件夹一个角色）后自动处理；改参数后自动重算（只重算受影响的部分）。
 */
export default function ProjectSpritesScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useProject(projectId)
  const chars = useSpriteCharacters(projectId)
  const pname = project.data?.name ?? ''
  const [sel, setSel] = useState(() => restoreSel(projectId))
  const ch = chars.data.find((c) => c.id === sel.c) ?? chars.data[0] ?? null
  const action = ch?.actions.find((a) => a.id === sel.a) ?? ch?.actions[0] ?? null
  const run = useSpriteRuns((s) => (ch ? s[ch.id] : undefined))
  const runs = useSpriteRuns()
  const output = run?.output ?? null
  const out = output?.actions.find((o) => o.actionId === action?.id)

  const [cur, setCur] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [wmOpen, setWmOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ kind: 'char' | 'action'; id: ID; value: string } | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'char' | 'action'; id: ID; name: string } | null>(null)
  const stageRef = useRef<HTMLElement>(null)

  const select = (c: ID | null, a: ID | null): void => {
    setSel({ c, a })
    try {
      localStorage.setItem(SEL_KEY(projectId), JSON.stringify({ c, a }))
    } catch {
      // 记不住只是下次回到第一个
    }
  }

  useEffect(() => {
    setCur(0)
    setPlaying(true)
  }, [action?.id])

  // 数据变了就重算（停顿 120 ms 再算，连续改参数时只算最后一次）；结果已经对得上就不算
  const sig = ch ? characterSignature(ch) : ''
  const chRef = useRef(ch)
  chRef.current = ch
  const first = useRef(true)
  useEffect(() => {
    const c = chRef.current
    if (!c) return
    retainActions(c.actions.map((a) => actionKey(projectId, c, a)))
    const done = useSpriteRuns.getState()[c.id]?.output?.character
    if (done && characterSignature(done) === sig) return
    const t = setTimeout(() => void processCharacter(projectId, c), first.current ? 0 : 120)
    first.current = false
    return () => clearTimeout(t)
  }, [sig, projectId])

  const applyChar = (c: SpriteCharacter): void => chars.mutate((list) => list.map((x) => (x.id === c.id ? c : x)))

  const guard = async (what: string, fn: () => Promise<SpriteCharacter | void>): Promise<void> => {
    try {
      const c = await fn()
      if (c) applyChar(c)
    } catch (err) {
      showError(what, err)
      void chars.refresh()
    }
  }

  const setParams = (patch: Partial<SpriteActionParams>): void => {
    if (!ch || !action) return
    const params = { ...action.params, ...patch }
    applyChar({ ...ch, actions: ch.actions.map((a) => (a.id === action.id ? { ...a, params } : a)) })
    void guard('没能保存参数', () => window.gp.sprites.updateAction(projectId, ch.id, action.id, { params }))
  }
  const setEdits = (edits: SpriteFrameEdit[]): void => {
    if (!ch || !action) return
    applyChar({ ...ch, actions: ch.actions.map((a) => (a.id === action.id ? { ...a, edits } : a)) })
    void guard('没能保存换帧', () => window.gp.sprites.updateAction(projectId, ch.id, action.id, { edits }))
  }
  const setSettings = (patch: Partial<SpriteSettings>): void => {
    if (!ch) return
    const settings = { ...ch.settings, ...patch }
    applyChar({ ...ch, settings })
    void guard('没能保存设置', () => window.gp.sprites.update(projectId, ch.id, { settings }))
  }

  const importVideos = async (paths?: string[]): Promise<void> => {
    try {
      const r = await window.gp.sprites.create(projectId, paths)
      const made = [...r.created, ...r.merged]
      if (made.length) {
        chars.mutate((list) => [...list.filter((c) => !made.some((m) => m.id === c.id)), ...made])
        const c = r.created[0] ?? r.merged[0]
        select(c.id, r.created[0] ? c.actions[0].id : c.actions[c.actions.length - 1].id)
      }
      if (made.length || r.skipped.length) reportImport(r)
    } catch (err) {
      showError('导入失败', err)
    }
  }

  const addActions = async (c: SpriteCharacter): Promise<void> => {
    try {
      const r = await window.gp.sprites.addActions(projectId, c.id)
      if (r.added.length) {
        applyChar(r.character)
        select(c.id, r.added[0].id)
        hud.show(`已添加 ${r.added.length} 个动作到「${c.name}」`, { ok: r.skipped.length === 0 })
      } else if (r.skipped.length) hud.show(`没有添加：${r.skipped[0].reason}`)
    } catch (err) {
      showError('添加失败', err)
    }
  }

  useFileDrop((paths) => void importVideos(paths), {
    label: '松手导入动作视频',
    hint: '一个文件夹是一个角色；和已有角色同名的会加进那个角色',
    accept: (f) => isVideoName(f.name) || (f.type === '' && !/\.[^./]{1,6}$/.test(f.name)),
    reject: '只能导入视频（mp4 / mov）或装着视频的文件夹'
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
    select(c.id, c.actions[0]?.id ?? null)
    const picked = await showContextMenu(e, [
      { id: 'add', label: '添加动作视频…' },
      { id: 'rename', label: '重命名…' },
      { id: 'export', label: '导出…' },
      menuSeparator,
      { id: 'delete', label: '删除角色', destructive: true }
    ])
    if (picked === 'add') void addActions(c)
    else if (picked === 'rename') setRenaming({ kind: 'char', id: c.id, value: c.name })
    else if (picked === 'export') setExporting(true)
    else if (picked === 'delete') setDeleting({ kind: 'char', id: c.id, name: c.name })
  }

  const actionMenu = async (e: ReactMouseEvent, c: SpriteCharacter, a: SpriteAction): Promise<void> => {
    e.preventDefault()
    select(c.id, a.id)
    const k = c.actions.indexOf(a)
    const picked = await showContextMenu(e, [
      { id: 'rename', label: '重命名…' },
      { id: 'up', label: '上移', enabled: k > 0 },
      { id: 'down', label: '下移', enabled: k < c.actions.length - 1 },
      menuSeparator,
      { id: 'delete', label: '删除动作', destructive: true }
    ])
    if (picked === 'rename') setRenaming({ kind: 'action', id: a.id, value: a.name })
    else if (picked === 'up' || picked === 'down') {
      const order = c.actions.map((x) => x.id)
      const j = picked === 'up' ? k - 1 : k + 1
      ;[order[k], order[j]] = [order[j], order[k]]
      void guard('没能调整顺序', () => window.gp.sprites.reorderActions(projectId, c.id, order))
    } else if (picked === 'delete') setDeleting({ kind: 'action', id: a.id, name: a.name })
  }

  const failed = ch && run ? ch.actions.filter((a) => run.phases[a.id] === 'error').map((a) => a.name) : []
  const ready = !!output && !run?.running && characterSignature(output.character) === sig

  let body: React.ReactNode
  if (chars.loading) body = null
  else if (chars.data.length === 0 || !ch) {
    body = (
      <main className="screen-main">
        <EmptyState
          icon="film"
          title="还没有序列帧"
          hint="把 AI 生成的绿幕动作视频（mp4 / mov）拖到这里：一个文件夹是一个角色，里面每个视频是一个动作（idle、run、attack…）。导入后自动抠图、找循环、出像素帧。"
        >
          <Button onClick={() => void importVideos()}>导入视频…</Button>
        </EmptyState>
      </main>
    )
  } else {
    body = (
      <>
        <nav className="sp-list" aria-label="角色与动作">
          {chars.data.map((c) => {
            const r = runs[c.id]
            return (
              <div key={c.id} style={{ display: 'contents' }}>
                <div className="sp-chr" onContextMenu={(e) => void charMenu(e, c)} onDoubleClick={() => setRenaming({ kind: 'char', id: c.id, value: c.name })}>
                  <span className="nm">{c.name}</span>
                  <span className="ct">{c.actions.length}</span>
                  <button type="button" className="more sp-add" style={{ height: 22, padding: '0 4px' }} aria-label={`${c.name} 的更多操作`} onClick={(e) => void charMenu(e, c)}>
                    <Icon name="ellipsis" size={14} />
                  </button>
                </div>
                {c.actions.map((a) => {
                  const o = r?.output?.actions.find((x) => x.actionId === a.id)
                  const ph = phaseText(r, a, o)
                  const on = c.id === ch.id && a.id === action?.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={cx('sp-act', on && 'on')}
                      onClick={() => select(c.id, a.id)}
                      onContextMenu={(e) => void actionMenu(e, c, a)}
                      title={a.sourceName}
                    >
                      <span className="th checker">
                        <FirstFrame out={o} size={40} />
                      </span>
                      <span className="tx">
                        <span className="nm">{a.name}</span>
                        <span className={cx('mt', ph.err && 'err')}>{ph.text}</span>
                      </span>
                      {!!o?.warnings && <span className="sp-badge" title={`${o.warnings} 个质检警告`}>{o.warnings}</span>}
                    </button>
                  )
                })}
                {c.id === ch.id && (
                  <button type="button" className="sp-add" onClick={() => void addActions(c)}>
                    <Icon name="plus" size={12} strokeWidth={2} />
                    添加动作视频…
                  </button>
                )}
              </div>
            )
          })}
        </nav>
        {action ? (
          <Stage
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
            onRetry={() => void processCharacter(projectId, ch)}
            stageRef={stageRef}
          />
        ) : (
          <main className="screen-main">
            <EmptyState icon="film" title="这个角色还没有动作">
              <Button onClick={() => void addActions(ch)}>添加动作视频…</Button>
            </EmptyState>
          </main>
        )}
        <Inspector
          ch={ch}
          action={action}
          output={output}
          out={out}
          projectHeight={project.data?.sizes?.character?.h ?? null}
          onSettings={setSettings}
          onParams={setParams}
          onApplyAll={() => {
            if (!action) return
            void guard('没能应用', () => window.gp.sprites.applyParamsToAll(projectId, ch.id, action.params)).then(() =>
              hud.show(`已把「${action.name}」的参数用到全部 ${ch.actions.length} 个动作`, { ok: true })
            )
          }}
          onPickWatermark={() => setWmOpen(true)}
          onJump={jumpTo}
        />
      </>
    )
  }

  const subtitle = ch
    ? `序列帧 · ${chars.data.length} 个角色${run?.running ? ' · 处理中…' : output ? ` · ${output.ms} ms` : ''}`
    : '序列帧'

  return (
    <div className="screen">
      <Toolbar title={pname} subtitle={subtitle}>
        <Button icon="plus" onClick={() => void importVideos()}>
          导入视频
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
      <div className="screen-body">{body}</div>

      {ch && (
        <ExportSheet open={exporting} projectId={projectId} ch={ch} output={ready ? output : null} failed={failed} onClose={() => setExporting(false)} />
      )}
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
          const target = chars.data.find((c) => (renaming.kind === 'char' ? c.id === renaming.id : c.actions.some((a) => a.id === renaming.id)))
          if (!target) return
          await guard('没能重命名', () =>
            renaming.kind === 'char'
              ? window.gp.sprites.update(projectId, target.id, { name })
              : window.gp.sprites.updateAction(projectId, target.id, renaming.id, { name })
          )
          setRenaming(null)
        }}
      />
      <ConfirmSheet
        open={deleting !== null}
        title={deleting?.kind === 'char' ? `删除角色「${deleting?.name}」？` : `删除动作「${deleting?.name}」？`}
        message={deleting?.kind === 'char' ? '角色和拷进来的源视频会移到废纸篓，已经导出的文件不受影响。' : '这个动作的源视频会移到废纸篓。'}
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const d = deleting
          if (!d) return
          const owner = chars.data.find((c) => (d.kind === 'char' ? c.id === d.id : c.actions.some((a) => a.id === d.id)))
          if (owner) {
            if (d.kind === 'char') {
              await guard('没能删除', () => window.gp.sprites.remove(projectId, owner.id))
              chars.mutate((list) => list.filter((c) => c.id !== owner.id))
            } else await guard('没能删除', () => window.gp.sprites.deleteAction(projectId, owner.id, d.id))
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
  value: { kind: 'char' | 'action'; value: string } | null
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
    () => (value?.kind === 'action' ? '动作名就是导出的动画名和文件夹名（idle、run、attack…）' : '角色名就是导出的文件夹名'),
    [value?.kind]
  )
  return (
    <Sheet
      open={value !== null}
      onClose={onClose}
      title={value?.kind === 'char' ? '重命名角色' : '重命名动作'}
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
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
        }}
      />
    </Sheet>
  )
}
