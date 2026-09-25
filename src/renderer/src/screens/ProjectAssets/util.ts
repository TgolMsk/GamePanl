// 资料界面用的小工具
import type { ImageRef } from '@shared/types'
import { hud } from '@renderer/app/hud'

/** 接口报错 → 给人看的原因（去掉 IPC 加的前缀） */
export function reason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

/** 接口失败时弹 HUD：「保存失败：原因」 */
export function showError(what: string, err: unknown): void {
  const why = reason(err)
  hud.show(why ? `${what}：${why}` : what)
}

/** 在访达中显示原文件；找不到时 HUD 提示 */
export async function revealImage(ref: ImageRef): Promise<void> {
  try {
    await window.gp.shell.revealImage(ref)
  } catch {
    hud.show('找不到原文件')
  }
}

/** 用系统默认应用打开原图；失败时 HUD 提示 */
export async function openImage(ref: ImageRef): Promise<void> {
  try {
    await window.gp.shell.openImage(ref)
  } catch (err) {
    showError('没能打开', err)
  }
}

// 缩略图大小（3–6，越大图越大，列数 = 9 - 大小），记在本机，下次打开还是这个大小
const ZOOM_KEY = 'gamepanl.assets.zoom'
export const ZOOM_MIN = 3
export const ZOOM_MAX = 6
const ZOOM_DEFAULT = 4

export function loadZoom(): number {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY))
    return Number.isInteger(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : ZOOM_DEFAULT
  } catch {
    return ZOOM_DEFAULT
  }
}

export function saveZoom(zoom: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(zoom))
  } catch {
    // 存不了只是下次回到默认大小
  }
}
