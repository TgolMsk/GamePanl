// 没有预览图的模型：用 three.js 离屏渲染一张缩略图存回主进程。一个一个排队渲染，每个模型本次运行只试一次。
import { modelFileUrl } from '@shared/api'
import type { LibModel } from '@shared/types'

const tried = new Set<string>()
let queue: Promise<void> = Promise.resolve()

export function ensurePreviews(models: ReadonlyArray<LibModel>): void {
  for (const m of models) {
    // 删掉后重新导入的同名模型 addedAt 不同，会再渲染一次
    const key = `${m.id}@${m.addedAt}`
    if (m.preview !== null || m.rendered || tried.has(key)) continue
    tried.add(key)
    queue = queue.then(async () => {
      try {
        // three.js 比较大，用到时再加载
        const { renderModelThumbnail } = await import('@renderer/app/model3d')
        const blob = await renderModelThumbnail(modelFileUrl(m.id, m.file), 640, 480)
        await window.gp.library.setModelPreview(m.id, new Uint8Array(await blob.arrayBuffer()))
      } catch (err) {
        // 模型被删了或渲染不了：卡片上显示占位图标
        console.warn('[model preview]', m.id, err)
      }
    })
  }
}
