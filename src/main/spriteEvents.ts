// 序列帧的后台事件（生成任务、从「下载」收件）推给界面；注册 ipc 时接上发送函数。
import type { SpriteEvent } from '@shared/spriteGen'
import type { SpriteOwner } from '@shared/sprites'

let sendEvent: (event: SpriteEvent) => void = () => undefined
let sendChanged: (owner: SpriteOwner) => void = () => undefined

export function connectSpriteEvents(event: (event: SpriteEvent) => void, changed: (owner: SpriteOwner) => void): void {
  sendEvent = event
  sendChanged = changed
}

export function spriteEvent(event: SpriteEvent): void {
  sendEvent(event)
}

/** 角色数据变了（加了版本、人物图），界面重新读 */
export function spriteChanged(owner: SpriteOwner): void {
  sendChanged(owner)
}
