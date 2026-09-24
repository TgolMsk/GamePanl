// 复制助手：写系统剪贴板并弹 HUD。返回是否成功，卡片据此显示「已复制」角标。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageRef } from '@shared/types'
import { hud } from './hud'

/** 把原图复制成图片（可以直接粘贴到 ChatGPT、PS 等） */
export async function copyImage(ref: ImageRef, name?: string): Promise<boolean> {
  let ok = false
  try {
    ok = await window.gp.clipboard.copyImage(ref)
  } catch {
    ok = false
  }
  if (ok) hud.show('已复制图片 · 可以直接粘贴到 ChatGPT / PS', { ok: true })
  else hud.show(name ? `「${name}」复制失败` : '复制失败')
  return ok
}

/** 复制文字；what 用在提示里：copyText(body, '提示词') → 「已复制提示词」 */
export async function copyText(text: string, what = ''): Promise<boolean> {
  try {
    await window.gp.clipboard.copyText(text)
    hud.show(`已复制${what}`, { ok: true })
    return true
  } catch {
    hud.show('复制失败')
    return false
  }
}

/**
 * 记住最近复制的是哪一项，ms 毫秒后清空，用来显示「✓ 已复制」角标。
 * const [copiedId, markCopied] = useCopiedFlag()
 * onClick={async () => { if (await copyText(p.body, '提示词')) markCopied(p.id) }}
 */
export function useCopiedFlag(ms = 2000): [string | null, (id: string) => void] {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const mark = useCallback(
    (id: string) => {
      clearTimeout(timer.current)
      setCopiedId(id)
      timer.current = setTimeout(() => setCopiedId(null), ms)
    },
    [ms]
  )
  return [copiedId, mark]
}
