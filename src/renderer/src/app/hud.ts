// 底部居中的深色提示胶囊。hud.show() 在任何地方都能调用，<Hud /> 由外壳渲染一次。
import { create } from 'zustand'

export interface HudAction {
  label: string
  run: () => void
}

export interface HudOptions {
  /** 前面显示对勾（操作成功） */
  ok?: boolean
  /** 右侧的操作按钮，如「撤销」；有操作时停留 5 秒，否则 2 秒 */
  action?: HudAction
}

export interface HudMessage {
  id: number
  msg: string
  ok: boolean
  action: HudAction | null
}

export const useHudStore = create<{ current: HudMessage | null }>(() => ({ current: null }))

let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

export const hud = {
  show(msg: string, opts: HudOptions = {}): void {
    clearTimeout(timer)
    useHudStore.setState({ current: { id: ++seq, msg, ok: opts.ok ?? false, action: opts.action ?? null } })
    timer = setTimeout(hud.hide, opts.action ? 5000 : 2000)
  },
  hide(): void {
    clearTimeout(timer)
    useHudStore.setState({ current: null })
  }
}
