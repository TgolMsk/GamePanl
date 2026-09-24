// 应用信息（版本、数据目录、系统强调色）。启动时读取一次，窗口重新获得焦点时再读，
// 这样在系统设置里换了强调色，回到应用就能跟着变。
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AppInfo } from '@shared/types'

const useAppInfoStore = create<{ info: AppInfo | null }>(() => ({ info: null }))

/** 应用信息；还没读到时是 null */
export function useAppInfo(): AppInfo | null {
  return useAppInfoStore((s) => s.info)
}

/** 接受 #RRGGBB、RRGGBB、RRGGBBAA 等写法，统一成 #rrggbb */
function normalizeHex(color: string): string | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

async function loadAppInfo(): Promise<void> {
  try {
    const info = await window.gp.app.getInfo()
    useAppInfoStore.setState({ info })
    const accent = normalizeHex(info.accentColor)
    if (accent) document.documentElement.style.setProperty('--acc', accent)
  } catch {
    // 读不到时沿用 tokens.css 里的默认强调色
  }
}

/** 外壳调用一次：读取应用信息并把系统强调色写进 --acc */
export function useAppInfoSync(): void {
  useEffect(() => {
    void loadAppInfo()
    const onFocus = (): void => void loadAppInfo()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}
