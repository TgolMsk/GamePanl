// 应用菜单发来的命令（⌘N 新建项目、⇧⌘N 新建笔记、⌘I 添加图片、⌘F 查找）。
// 外壳订阅一次；界面用 useCommand('new-note', handler) 接自己关心的命令。
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { AppCommand } from '@shared/types'
import { openSheetCount } from './sheetStack'

interface CommandEvent {
  command: AppCommand
  seq: number
}

const useCommandStore = create<{ last: CommandEvent | null }>(() => ({ last: null }))
let seq = 0

export function dispatchCommand(command: AppCommand): void {
  useCommandStore.setState({ last: { command, seq: ++seq } })
}

/** 当前界面接一个命令。有 sheet 打开时不响应（免得在弹窗后面新建东西）。 */
export function useCommand(command: AppCommand, handler: () => void): void {
  const ref = useRef(handler)
  ref.current = handler
  const last = useCommandStore((s) => s.last)
  const seen = useRef(last?.seq ?? 0)
  useEffect(() => {
    if (!last || last.seq === seen.current) return
    seen.current = last.seq
    if (last.command !== command || openSheetCount() > 0) return
    ref.current()
  }, [last, command])
}

/** 外壳调用一次：把主进程发来的命令转成 store 里的事件 */
export function useCommandSync(): void {
  useEffect(() => window.gp.onCommand(dispatchCommand), [])
}

/** ⌘F：聚焦当前界面工具栏里的搜索框 */
export function focusSearch(): boolean {
  const input = document.querySelector<HTMLInputElement>('.toolbar .search input, .toolbar input[type="search"]')
  if (!input) return false
  input.focus()
  input.select()
  return true
}
