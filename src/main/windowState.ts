// 记住窗口位置和大小：关闭前存进设置，下次启动恢复（只在那个位置仍在某块屏幕上时）。
import { screen } from 'electron'
import type { BrowserWindow, Rectangle } from 'electron'
import { getSettings, patchSettings } from './settings'
import type { WindowBounds } from './settings'

const MIN_W = 1080
const MIN_H = 680

/** 上次的窗口矩形；没有记录或已经不在任何屏幕范围内时返回 null */
export async function restoredBounds(): Promise<WindowBounds | null> {
  const b = (await getSettings()).windowBounds
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || b.width < MIN_W || b.height < MIN_H) return null
  const area = screen.getDisplayMatching(b).workArea
  const visible =
    b.x + b.width > area.x + 40 && b.x < area.x + area.width - 40 && b.y >= area.y - 10 && b.y < area.y + area.height - 40
  return visible ? b : null
}

/** 窗口移动或改大小后延迟保存 */
export function trackWindowBounds(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
      const r: Rectangle = win.getNormalBounds()
      void patchSettings({ windowBounds: { x: r.x, y: r.y, width: r.width, height: r.height } }).catch(() => undefined)
    }, 400)
  }
  win.on('resize', save)
  win.on('move', save)
  win.once('closed', () => clearTimeout(timer))
}
