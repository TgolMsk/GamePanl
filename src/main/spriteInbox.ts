// 从「下载」自动收件：复制了提示词以后（两小时内），「下载」文件夹里新出现的视频和图片自动放进对应的角色。
// 视频按文件名里的动作标签（提示词第一行的 [attack1]，Muse、即梦的下载文件名会带上）放进那个动作，
// 认不出标签的放进最近复制过提示词的动作；图片放进最近复制过设定图 / 定妆照提示词的角色。
// 只看开始等以后新出现的文件；还在下载的（.crdownload、.download、大小还在变）等下完再收；同一个视频不重复收。
import { app } from 'electron'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { WAIT_HOURS, type SpriteWaiting } from '@shared/spriteGen'
import { actionFromTag, type SpriteOwner } from '@shared/sprites'
import type { ID } from '@shared/types'
import { candidateFromFile } from './images'
import { spriteChanged, spriteEvent } from './spriteEvents'
import { genSettings } from './spriteGen'
import { addRefImage, addTakeFile, getCharacter, isRefImage, isVideoFile } from './sprites'
import { nowIso } from './storage'

interface Wait extends SpriteWaiting {
  /** 复制的提示词，记到收进来的版本上 */
  prompt: string
}

const POLL_MS = 2000
const waits: Wait[] = []
let timer: NodeJS.Timeout | null = null
/** 开始等的时候「下载」里已经有的文件（不收），和已经处理过的新文件 */
let seen: Set<string> | null = null
/** 新文件上次看到的大小：连续两次一样才算下载完 */
const sizes = new Map<string, number>()
let busy = false

const inboxDir = (): string => process.env['GAMEPANL_INBOX_DIR'] || app.getPath('downloads')

/** 复制了提示词：开始（或重新）等这个动作的视频；actionId 为 null 是等人物图 */
export async function expect(owner: SpriteOwner, characterId: ID, actionId: ID | null, prompt: string): Promise<void> {
  if (!(await genSettings()).inbox) return
  const i = waits.findIndex((w) => w.owner === owner && w.characterId === characterId && w.actionId === actionId)
  if (i >= 0) waits.splice(i, 1)
  waits.push({ owner, characterId, actionId, at: nowIso(), prompt })
  emitWaiting()
  await start()
}

export function waiting(): SpriteWaiting[] {
  prune()
  return waits.map(({ owner, characterId, actionId, at }) => ({ owner, characterId, actionId, at }))
}

/** 设置里关掉自动收件 */
export function stopInbox(): void {
  waits.length = 0
  stop()
  emitWaiting()
}

function emitWaiting(): void {
  spriteEvent({ type: 'waiting', waiting: waits.map(({ owner, characterId, actionId, at }) => ({ owner, characterId, actionId, at })) })
}

function noAccess(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'EPERM' || code === 'EACCES') return '没有权限读「下载」文件夹，自动收件用不了：到「系统设置 → 隐私与安全性 → 文件和文件夹」里允许 GamePanl 访问「下载」'
  return `读不了「下载」文件夹，自动收件先停了：${err instanceof Error ? err.message : String(err)}`
}

async function start(): Promise<void> {
  if (timer) return
  try {
    seen = new Set(await fs.readdir(inboxDir()))
  } catch (err) {
    waits.length = 0
    emitWaiting()
    spriteEvent({ type: 'notice', message: noAccess(err), error: true })
    return
  }
  timer = setInterval(() => void poll(), POLL_MS)
}

function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
  seen = null
  sizes.clear()
}

/** 去掉超过两小时的等待；都没了就停 */
function prune(): void {
  const limit = Date.now() - WAIT_HOURS * 3600_000
  const before = waits.length
  for (let i = waits.length - 1; i >= 0; i--) if (Date.parse(waits[i].at) < limit) waits.splice(i, 1)
  if (waits.length !== before) emitWaiting()
  if (waits.length === 0) stop()
}

async function poll(): Promise<void> {
  if (busy) return
  busy = true
  try {
    prune()
    const known = seen
    if (!known) return
    const dir = inboxDir()
    for (const name of await fs.readdir(dir)) {
      if (known.has(name)) continue
      if (name.startsWith('.') || !(isVideoFile(name) || isRefImage(name))) {
        known.add(name)
        continue
      }
      const file = join(dir, name)
      const st = await fs.stat(file).catch(() => null)
      if (!st?.isFile()) {
        known.add(name)
        continue
      }
      if (st.size === 0 || sizes.get(name) !== st.size) {
        sizes.set(name, st.size)
        continue
      }
      known.add(name)
      sizes.delete(name)
      await route(file).catch((err) => spriteEvent({ type: 'notice', message: `没收进来（${name}）：${err instanceof Error ? err.message : String(err)}`, error: true }))
    }
  } catch (err) {
    stopInbox()
    spriteEvent({ type: 'notice', message: noAccess(err), error: true })
  } finally {
    busy = false
  }
}

/** 视频：先按文件名里的动作标签找（最近等的角色优先），找不到放进最近复制过提示词的动作；图片：最近等人物图的角色 */
async function route(file: string): Promise<void> {
  const name = basename(file)
  const recent = [...waits].reverse()
  if (isVideoFile(name)) {
    for (const w of recent) {
      const ch = await getCharacter(w.owner, w.characterId).catch(() => null)
      const a = ch ? actionFromTag(name, ch.actions) : null
      if (!a) continue
      const same = waits.find((x) => x.owner === w.owner && x.characterId === w.characterId && x.actionId === a.id)
      return putVideo(w.owner, w.characterId, a.id, file, same?.prompt ?? '')
    }
    const w = recent.find((x) => x.actionId !== null)
    if (w?.actionId) await putVideo(w.owner, w.characterId, w.actionId, file, w.prompt)
    return
  }
  const w = recent.find((x) => x.actionId === null)
  if (!w) return
  const cand = await candidateFromFile(file)
  if (!cand) return
  const r = await addRefImage(w.owner, w.characterId, cand)
  if (!r.ref) return
  spriteChanged(w.owner)
  spriteEvent({ type: 'inbox', event: { owner: w.owner, characterId: w.characterId, characterName: r.character.name, actionId: null, actionName: '', takeId: null, refId: r.ref.id, fileName: name } })
}

async function putVideo(owner: SpriteOwner, id: ID, actionId: ID, file: string, prompt: string): Promise<void> {
  const r = await addTakeFile(owner, id, actionId, file, { prompt, via: 'inbox' }, true)
  if (!r) return
  spriteChanged(owner)
  spriteEvent({ type: 'inbox', event: { owner, characterId: id, characterName: r.character.name, actionId, actionName: r.action.name, takeId: r.take.id, refId: null, fileName: basename(file) } })
}
