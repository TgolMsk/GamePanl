// 模型的取用：在访达中显示、拷贝文件夹到…、复制路径、复制给 AI、拖出，以及右键菜单里共用的这几项。
import type { DragEvent } from 'react'
import { copyText } from '@renderer/app/clipboard'
import { hud } from '@renderer/app/hud'
import { showError } from '@renderer/screens/Library/shared'
import type { LibModel, MenuItemSpec } from '@shared/types'
import { aiText } from './format'

let rootJob: Promise<string> | null = null

/** 数据目录（~/GamePanl） */
export function dataRoot(): Promise<string> {
  rootJob ??= window.gp.app.getInfo().then((info) => info.dataRoot)
  return rootJob
}

/** 模型文件夹的完整路径 */
export async function modelFolder(id: string): Promise<string> {
  return `${await dataRoot()}/library/models/${id}`
}

export async function revealModel(m: LibModel): Promise<void> {
  try {
    await window.gp.shell.revealModel(m.id)
  } catch {
    hud.show('找不到模型文件夹')
  }
}

export async function copyModelTo(m: LibModel): Promise<void> {
  try {
    const dest = await window.gp.library.copyModelTo(m.id)
    if (!dest) return
    const tail = dest.split('/').slice(-2).join('/')
    hud.show(`已拷贝到 …/${tail}`, { ok: true })
  } catch (err) {
    showError('拷贝失败', err)
  }
}

export async function copyModelPath(m: LibModel): Promise<boolean> {
  return copyText(await modelFolder(m.id), '文件夹路径')
}

export async function copyForAI(m: LibModel): Promise<boolean> {
  return copyText(aiText(m, await modelFolder(m.id)), '给 AI 的说明 · 粘贴到对话里')
}

/** 把整个模型文件夹拖到访达或游戏项目里（系统原生拖拽） */
export function dragModelOut(e: DragEvent, m: LibModel): void {
  e.preventDefault()
  void window.gp.shell.dragModel(m.id).catch(() => undefined)
}

/** 右键菜单里取用模型的几项（只对单个模型可用） */
export function modelMenuItems(single: boolean): MenuItemSpec[] {
  return [
    { id: 'm:view', label: '3D 预览…', enabled: single },
    { id: 'm:ai', label: '复制给 AI', enabled: single },
    { id: 'm:path', label: '复制路径', enabled: single },
    { id: 'm:reveal', label: '在访达中显示', enabled: single },
    { id: 'm:copyto', label: '拷贝文件夹到…', enabled: single }
  ]
}

/** 处理上面几项；不是这几项时返回 false */
export function handleModelMenu(picked: string, m: LibModel, openView: () => void): boolean {
  if (picked === 'm:view') openView()
  else if (picked === 'm:ai') void copyForAI(m)
  else if (picked === 'm:path') void copyModelPath(m)
  else if (picked === 'm:reveal') void revealModel(m)
  else if (picked === 'm:copyto') void copyModelTo(m)
  else return false
  return true
}
