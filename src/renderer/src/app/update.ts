// 在线更新的界面状态：主进程负责检查和下载，这里只保存最新状态、控制「软件更新」窗口和侧栏提示的显示。
import { useEffect } from 'react'
import { create } from 'zustand'
import type { UpdateState } from '@shared/types'

interface UpdateStore {
  state: UpdateState | null
  sheetOpen: boolean
  /** 侧栏提示被用户关掉的版本（本次运行内不再显示） */
  dismissedVersion: string | null
}

export const useUpdateStore = create<UpdateStore>(() => ({ state: null, sheetOpen: false, dismissedVersion: null }))

export function openUpdateSheet(): void {
  useUpdateStore.setState({ sheetOpen: true })
}

export function closeUpdateSheet(): void {
  useUpdateStore.setState({ sheetOpen: false })
}

export function dismissUpdateBanner(version: string): void {
  useUpdateStore.setState({ dismissedVersion: version })
}

/** 外壳调用一次：读取当前状态并订阅变化；用户从菜单手动检查时自动弹出「软件更新」窗口 */
export function useUpdateSync(): void {
  useEffect(() => {
    let cancelled = false
    window.gp.update.getState().then(
      (s) => {
        if (!cancelled) useUpdateStore.setState({ state: s })
      },
      () => undefined
    )
    const off = window.gp.onUpdateState((s) => {
      const prev = useUpdateStore.getState().state
      const manualStarted = s.manual && s.phase === 'checking' && !(prev?.manual && prev.phase === 'checking')
      useUpdateStore.setState(manualStarted ? { state: s, sheetOpen: true } : { state: s })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])
}
