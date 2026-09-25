// 全局库列表 / 网格的键盘处理：焦点在主区里（或没有焦点）、不在输入框里、没有 sheet 打开时才响应。
import { useEffect, useRef, type RefObject } from 'react'
import { openSheetCount } from '@renderer/app/sheetStack'

export function isEditable(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null
}

/** 不带 ⌘ / Ctrl / ⌥ 的某个键（Backspace、Delete、Enter、Escape） */
export function isPlainKey(e: KeyboardEvent, ...keys: string[]): boolean {
  return keys.includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey
}

/** ⌘ + 字母（不带 ⇧ / ⌥）；也按物理键位判断，换了键盘布局照样认得 */
export function isCmdKey(e: KeyboardEvent, letter: string): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false
  return e.key.toLowerCase() === letter || e.code === `Key${letter.toUpperCase()}`
}

/**
 * 在 document 上监听 keydown：焦点在 main 里（或落在 body 上）、不在输入框里、没有 sheet 打开时调用 handler。
 * handler 自己决定处理哪些键，处理了就 preventDefault（这样也不会再触发应用菜单里同快捷键的项）。
 * main 要有 tabIndex={0}，点一下空白处就能接收键盘事件。
 */
export function useMainKeys(mainRef: RefObject<HTMLElement | null>, handler: (e: KeyboardEvent) => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const main = mainRef.current
      const t = e.target
      if (!main || openSheetCount() > 0 || isEditable(t)) return
      if (t !== document.body && !(t instanceof Node && main.contains(t))) return
      ref.current(e)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mainRef])
}
