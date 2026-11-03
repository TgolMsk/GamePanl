// 「在软件里生成」和自动收件的界面状态：任务列表、等收件、生成设置、本机工具。
// 主进程推来的事件在这里汇总，各面板直接读。
import { create } from 'zustand'
import { estimateVideoCost, type SpriteGenSettings, type SpriteGenTools, type SpriteJob, type SpriteWaiting } from '@shared/spriteGen'
import type { SpriteOwner } from '@shared/sprites'
import type { ID } from '@shared/types'

interface GenState {
  jobs: SpriteJob[]
  waiting: SpriteWaiting[]
  settings: SpriteGenSettings | null
  tools: SpriteGenTools | null
}

export const useGen = create<GenState>(() => ({ jobs: [], waiting: [], settings: null, tools: null }))

let installed = false

/** 订阅主进程事件，取一次当前状态（只做一次） */
export function installGen(): void {
  if (installed) return
  installed = true
  window.gp.onSpriteEvent((e) => {
    if (e.type === 'jobs') useGen.setState({ jobs: e.jobs })
    else if (e.type === 'waiting') useGen.setState({ waiting: e.waiting })
  })
  void window.gp.sprites.jobs().then((jobs) => useGen.setState({ jobs }), () => undefined)
  void window.gp.sprites.waiting().then((waiting) => useGen.setState({ waiting }), () => undefined)
  void window.gp.sprites.genSettings().then((settings) => useGen.setState({ settings }), () => undefined)
  void refreshTools()
}

/** 重新找一次 bl、codex（装好以后点「重新检测」） */
export async function refreshTools(): Promise<SpriteGenTools | null> {
  try {
    const tools = await window.gp.sprites.genTools()
    useGen.setState({ tools })
    return tools
  } catch {
    return null
  }
}

export async function saveGenSettings(patch: Partial<SpriteGenSettings>): Promise<void> {
  const settings = await window.gp.sprites.setGenSettings(patch)
  useGen.setState({ settings })
}

export const isActive = (j: SpriteJob): boolean => j.state === 'queued' || j.state === 'running'

/** 某个角色（或其中一个动作）还在排队、生成中的任务 */
export function activeJobs(jobs: SpriteJob[], owner: SpriteOwner, characterId: ID, actionId?: ID | null): SpriteJob[] {
  return jobs.filter((j) => isActive(j) && j.owner === owner && j.characterId === characterId && (actionId === undefined || j.actionId === actionId))
}

/** 正在等「下载」里出现这个动作（actionId 为 null：人物图）的文件 */
export function isWaiting(waiting: SpriteWaiting[], owner: SpriteOwner, characterId: ID, actionId: ID | null): boolean {
  return waiting.some((w) => w.owner === owner && w.characterId === characterId && w.actionId === actionId)
}

/** 「约 ¥1.2」 */
export function costText(settings: SpriteGenSettings, count: number): string {
  return `约 ¥${estimateVideoCost(settings, count).toFixed(1)}`
}

/** 复制提示词以后开始等「下载」里的文件；收件关着时什么也不做 */
export function expectDownload(owner: SpriteOwner, characterId: ID, actionId: ID | null, prompt: string): void {
  void window.gp.sprites.expect(owner, characterId, actionId, prompt).catch(() => undefined)
}
