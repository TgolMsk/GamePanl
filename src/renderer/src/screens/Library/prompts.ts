// 提示词卡片和编辑 sheet 共用：分类圆点、使用次数文字、复制并记一次使用。
import { copyText } from '@renderer/app/clipboard'
import { hud } from '@renderer/app/hud'
import { PROMPT_CATEGORIES, type Prompt, type PromptCategory } from '@shared/types'

/** 分类圆点的颜色类（library.css 里的 .lib-dot.c0 …） */
export function dotClass(category: PromptCategory): string {
  return `lib-dot c${PROMPT_CATEGORIES.indexOf(category)}`
}

export function usesText(uses: number): string {
  return uses > 0 ? `用过 ${uses} 次` : '还没用过'
}

/** 复制正文并记一次使用；返回是否复制成功 */
export async function copyPrompt(p: Pick<Prompt, 'id' | 'body'>, onUsed: (next: Prompt) => void): Promise<boolean> {
  if (!p.body.trim()) {
    hud.show('这条提示词还没有正文')
    return false
  }
  if (!(await copyText(p.body, '提示词'))) return false
  window.gp.library.markPromptUsed(p.id).then(onUsed, () => undefined)
  return true
}
