// 右键菜单：调系统原生菜单（macOS 样式），返回点中项的 id。
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { MenuItemSpec } from '@shared/types'

export const menuSeparator: MenuItemSpec = { type: 'separator' }

/**
 * 在鼠标位置弹出原生右键菜单。用法：
 *   onContextMenu={async (e) => {
 *     const id = await showContextMenu(e, [{ id: 'view', label: '查看' }, menuSeparator, { id: 'trash', label: '移到废纸篓', destructive: true }])
 *     if (id === 'trash') …
 *   }}
 * 没选任何项（点到外面、按 Esc）返回 null。
 */
export async function showContextMenu(
  e: ReactMouseEvent | MouseEvent,
  items: MenuItemSpec[]
): Promise<string | null> {
  e.preventDefault()
  e.stopPropagation()
  if (items.length === 0) return null
  try {
    return await window.gp.menu.popup(items)
  } catch {
    return null
  }
}

/** 是否按着多选用的修饰键（⌘ / ⇧ / Ctrl）——这时单击只选中，不复制 */
export function isSelectModifier(e: { metaKey: boolean; shiftKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.shiftKey || e.ctrlKey
}
