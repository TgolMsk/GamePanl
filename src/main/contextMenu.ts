// 原生右键菜单：界面传来菜单项，在鼠标位置弹出，返回点中项的 id。
import { BrowserWindow, Menu } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import type { MenuItemSpec } from '@shared/types'
import { fail } from './validate'

const MAX_ITEMS = 60
const MAX_DEPTH = 3

function asItems(v: unknown, depth: number): MenuItemSpec[] {
  if (!Array.isArray(v)) fail('菜单项必须是数组')
  if (v.length > MAX_ITEMS) fail('菜单项太多了')
  if (depth > MAX_DEPTH) fail('菜单层级太深')
  return v.map((raw): MenuItemSpec => {
    if (typeof raw !== 'object' || raw === null) fail('菜单项格式不对')
    const o = raw as Record<string, unknown>
    if (o['type'] === 'separator') return { type: 'separator' }
    if (typeof o['id'] !== 'string' || !o['id'] || typeof o['label'] !== 'string') fail('菜单项缺少 id 或 label')
    return {
      id: o['id'].slice(0, 200),
      label: o['label'].slice(0, 200),
      enabled: o['enabled'] === undefined ? true : Boolean(o['enabled']),
      checked: o['checked'] === undefined ? undefined : Boolean(o['checked']),
      destructive: Boolean(o['destructive']),
      submenu: o['submenu'] === undefined ? undefined : asItems(o['submenu'], depth + 1)
    }
  })
}

function toTemplate(items: MenuItemSpec[], pick: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((it): MenuItemConstructorOptions => {
    if ('type' in it) return { type: 'separator' }
    if (it.submenu) return { label: it.label, enabled: it.enabled, submenu: toTemplate(it.submenu, pick) }
    return {
      label: it.label,
      enabled: it.enabled,
      type: it.checked === undefined ? 'normal' : 'checkbox',
      checked: it.checked,
      click: () => pick(it.id)
    }
  })
}

/** 弹出菜单并等用户选择；点在菜单外面关闭时返回 null */
export function popupContextMenu(event: IpcMainInvokeEvent, rawItems: unknown): Promise<string | null> {
  const items = asItems(rawItems, 1)
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
  return new Promise((resolve) => {
    let done = false
    const finish = (id: string | null): void => {
      if (done) return
      done = true
      resolve(id)
    }
    const menu = Menu.buildFromTemplate(toTemplate(items, finish))
    // 点中某项时 click 先于 callback 触发；callback 里延后一拍再当作「没选」
    menu.popup({ window: win, callback: () => setTimeout(() => finish(null), 0) })
  })
}
