// 把图片加入全局库（拖入、⌘V、选择文件、剪贴板），并用 HUD 告诉用户结果。
import { hud } from '@renderer/app/hud'
import type { ImageCategory, LibImage } from '@shared/types'
import { errText } from './shared'

export type ImportSource =
  | { kind: 'files'; paths: string[] }
  /** 弹出系统文件选择框 */
  | { kind: 'picker' }
  | { kind: 'clipboard' }

/**
 * 导入并弹 HUD：「已加入 N 张」，重复的提示「已存在」。
 * category 给了就把新加入的图片归到这个分类（正在看某个分类时添加）。返回新加入的图片。
 */
export async function importToLibrary(source: ImportSource, category: ImageCategory | null): Promise<LibImage[]> {
  const lib = window.gp.library
  try {
    let added: LibImage[]
    let existing = 0
    if (source.kind === 'clipboard') {
      // 剪贴板里的图已经在库里时，接口返回原来那张
      const known = new Set((await lib.listImages()).map((x) => x.id))
      const img = await lib.importImageFromClipboard()
      if (!img) {
        hud.show('剪贴板里没有图片')
        return []
      }
      if (known.has(img.id)) {
        hud.show(`「${img.name}」已存在`)
        return []
      }
      added = [img]
    } else {
      added = await lib.importImages(source.kind === 'files' ? source.paths : undefined)
      if (source.kind === 'files') existing = Math.max(0, source.paths.length - added.length)
    }

    if (added.length === 0) {
      if (existing > 0) hud.show(existing === 1 ? '这张图片已存在' : `这 ${existing} 张图片都已存在`)
      return []
    }
    if (category !== null) {
      added = await Promise.all(
        added.map((img) => (img.category === category ? img : lib.updateImage(img.id, { category })))
      )
    }
    hud.show(existing > 0 ? `已加入 ${added.length} 张 · ${existing} 张已存在` : `已加入 ${added.length} 张`, {
      ok: true
    })
    return added
  } catch (err) {
    hud.show(`添加失败：${errText(err)}`)
    return []
  }
}
