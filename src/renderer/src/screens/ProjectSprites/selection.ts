import type { SpriteOwner } from '@shared/sprites'
import type { ID } from '@shared/types'

export const SEL_KEY = (owner: SpriteOwner): string => `gamepanl.sprites.sel.${owner ?? 'library'}`

/** 页面内选择和从 2D 资产跳转共用同一份记忆。 */
export function rememberSpriteSelection(owner: SpriteOwner, c: ID | null, a: ID | 'refs' | null): void {
  try {
    localStorage.setItem(SEL_KEY(owner), JSON.stringify({ c, a }))
  } catch {
    // 记不住只是下次回到第一个，不影响继续操作。
  }
}
