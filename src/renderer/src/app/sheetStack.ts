// 打开中的 sheet 栈：Esc 只关最上层；拖入、粘贴只交给最上层所在的界面处理。
import { createContext, useContext } from 'react'
import { create } from 'zustand'

export const useSheetStack = create<{ stack: number[] }>(() => ({ stack: [] }))

/** 当前组件所在的 sheet 层级：页面里是 0，第一层 sheet 里是 1，依此类推 */
export const SheetDepthContext = createContext(0)

export function useSheetDepth(): number {
  return useContext(SheetDepthContext)
}

/** 当前打开的 sheet 数量 */
export function openSheetCount(): number {
  return useSheetStack.getState().stack.length
}

let seq = 0

export function pushSheet(): number {
  const id = ++seq
  useSheetStack.setState((s) => ({ stack: [...s.stack, id] }))
  return id
}

export function popSheet(id: number): void {
  useSheetStack.setState((s) => ({ stack: s.stack.filter((x) => x !== id) }))
}

export function isTopSheet(id: number): boolean {
  const { stack } = useSheetStack.getState()
  return stack[stack.length - 1] === id
}
