import './update.css'
import { useState, type ReactNode } from 'react'
import type { UpdateState } from '@shared/types'
import { formatBytes, formatDate } from '../app/format'
import { hud } from '../app/hud'
import { closeUpdateSheet, useUpdateStore } from '../app/update'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (err) {
    hud.show(errorText(err))
  }
}

// ---------- 更新说明：把 GitHub Release 的 Markdown 简单排成段落和列表 ----------

type NoteBlock = { kind: 'h' | 'p'; text: string } | { kind: 'ul'; items: string[] }

function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 $2')
    .trim()
}

function parseNotes(text: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let para: string[] = []
  const flush = (): void => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') })
    para = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push({ kind: 'h', text: stripInline(h[1]) })
      continue
    }
    const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      flush()
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'ul') last.items.push(stripInline(li[1]))
      else blocks.push({ kind: 'ul', items: [stripInline(li[1])] })
      continue
    }
    para.push(stripInline(line))
  }
  flush()
  return blocks
}

const URL_RE = /(https?:\/\/[^\s<>)]+)/g

/** 网址变成链接（target=_blank 的链接由主进程交给系统浏览器打开） */
function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part.replace(/^https?:\/\/(www\.)?/, '')}
      </a>
    ) : (
      part
    )
  )
}

function Notes({ text }: { text: string }): React.JSX.Element {
  const blocks = parseNotes(text)
  if (blocks.length === 0) return <p className="lbl">这个版本没有写更新说明。</p>
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'h') return <h4 key={i}>{linkify(b.text)}</h4>
        if (b.kind === 'ul') {
          return (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{linkify(it)}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{linkify(b.text)}</p>
      })}
    </>
  )
}

// ---------- 各阶段的内容 ----------

function Status({ icon, title, detail }: { icon: ReactNode; title: string; detail?: ReactNode }): React.JSX.Element {
  return (
    <div className="upd-status">
      <span className="upd-status-ic">{icon}</span>
      <div className="upd-status-title">{title}</div>
      {detail != null && <div className="upd-status-detail">{detail}</div>}
    </div>
  )
}

function Body({ state }: { state: UpdateState }): React.JSX.Element {
  const { release } = state
  switch (state.phase) {
    case 'idle':
      return <Status icon={<Icon name="info" size={28} />} title="还没有检查过更新" />
    case 'checking':
      return <Status icon={<span className="upd-spinner" />} title="正在检查更新…" />
    case 'none':
      return (
        <Status
          icon={<Icon name="check" size={28} strokeWidth={2} />}
          title="已经是最新版本"
          detail={`GamePanl ${state.currentVersion}${state.lastCheckAt ? ` · 上次检查 ${formatDate(state.lastCheckAt, { time: true })}` : ''}`}
        />
      )
    case 'error':
      return <Status icon={<Icon name="info" size={28} />} title="检查更新失败" detail={state.error} />
    default:
      break
  }
  if (!release) return <Status icon={<Icon name="info" size={28} />} title="没有可用的更新信息" />
  const p = state.progress
  const pct = p && p.total > 0 ? Math.min(100, (p.received / p.total) * 100) : 0
  return (
    <div className="upd-release">
      <div className="upd-release-head">
        <div className="upd-release-title">GamePanl {release.version} 可以更新</div>
        <div className="lbl">
          当前 {state.currentVersion} · 发布于 {formatDate(release.publishedAt)}
          {release.asset ? ` · ${formatBytes(release.asset.bytes)}` : ''}
        </div>
      </div>
      <div className="upd-notes">
        <Notes text={release.notes} />
      </div>
      {state.phase === 'downloading' && (
        <div className="upd-progress">
          <div className="upd-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="lbl">
            {p ? `${formatBytes(p.received)} / ${formatBytes(p.total)}` : '正在连接…'}
            {release.asset ? ` · ${release.asset.name}` : ''}
          </div>
        </div>
      )}
      {state.phase === 'downloaded' && (
        <div className="upd-done">
          <Icon name="check" size={14} strokeWidth={2.2} />
          <span>
            已下载到「下载」文件夹。打开安装包，把 GamePanl 拖进「应用程序」替换旧版本，然后重新打开。
          </span>
        </div>
      )}
    </div>
  )
}

function Actions({ state, busy, setBusy }: { state: UpdateState; busy: boolean; setBusy: (b: boolean) => void }): React.JSX.Element {
  const go = (action: () => Promise<unknown>): (() => void) => () => {
    setBusy(true)
    void run(action).finally(() => setBusy(false))
  }
  const close = <Button onClick={closeUpdateSheet}>关闭</Button>
  const check = (
    <Button variant="primary" disabled={busy} onClick={go(() => window.gp.update.check())}>
      检查更新
    </Button>
  )
  switch (state.phase) {
    case 'idle':
      return (
        <>
          {close}
          {check}
        </>
      )
    case 'checking':
      return (
        <Button variant="primary" disabled>
          正在检查…
        </Button>
      )
    case 'none':
      return <Button variant="primary" onClick={closeUpdateSheet}>好</Button>
    case 'error':
      return (
        <>
          {close}
          {state.release?.asset ? (
            <Button variant="primary" disabled={busy} onClick={go(() => window.gp.update.download())}>
              重新下载
            </Button>
          ) : (
            check
          )}
        </>
      )
    case 'available':
      return (
        <>
          <Button variant="plain" disabled={busy} onClick={go(() => window.gp.update.skipVersion(state.release!.version))}>
            跳过这个版本
          </Button>
          <Button onClick={closeUpdateSheet}>稍后</Button>
          {state.release?.asset ? (
            <Button variant="primary" icon="tray.down" disabled={busy} onClick={go(() => window.gp.update.download())}>
              下载更新
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={go(() => window.gp.update.openReleasePage())}>
              前往下载页面
            </Button>
          )}
        </>
      )
    case 'downloading':
      return (
        <Button disabled={busy} onClick={go(() => window.gp.update.cancelDownload())}>
          取消下载
        </Button>
      )
    case 'downloaded':
      return (
        <>
          <Button disabled={busy} onClick={go(() => window.gp.update.revealDownloaded())}>
            在访达中显示
          </Button>
          <Button variant="primary" disabled={busy} onClick={go(() => window.gp.update.openDownloaded())}>
            打开安装包
          </Button>
        </>
      )
  }
}

/** 「软件更新」窗口：菜单里的「检查更新…」和侧栏提示都打开它 */
export function UpdateSheet(): React.JSX.Element | null {
  const open = useUpdateStore((s) => s.sheetOpen)
  const state = useUpdateStore((s) => s.state)
  const [busy, setBusy] = useState(false)
  if (!state) return null
  const autoId = 'upd-auto-check'
  return (
    <Sheet
      open={open}
      onClose={closeUpdateSheet}
      title="软件更新"
      subtitle={`GamePanl ${state.currentVersion}`}
      width={560}
      bodyClassName="upd-body"
      footer={
        <>
          <label className="upd-auto" htmlFor={autoId}>
            <input
              id={autoId}
              type="checkbox"
              checked={state.autoCheck}
              onChange={(e) => void run(() => window.gp.update.setAutoCheck(e.target.checked))}
            />
            自动检查更新
          </label>
          <span className="grow" />
          <Actions state={state} busy={busy} setBusy={setBusy} />
        </>
      }
    >
      <Body state={state} />
    </Sheet>
  )
}
