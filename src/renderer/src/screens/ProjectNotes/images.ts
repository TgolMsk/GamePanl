// 笔记里的图片引用 → 显示用的信息（名称、尺寸、预览数据），来自本项目资料和全局库。
import { useMemo } from 'react'
import { useAssets, useLibImages } from '@renderer/app/data'
import type { QuickLookImage } from '@renderer/ui'
import type { ImageRef, LibImage, ProjectAsset } from '@shared/types'
import { refKey } from './noteUtil'

export interface ImageInfo {
  ref: ImageRef
  name: string
  width: number
  height: number
  /** 「本项目资料」或「全局库」 */
  source: string
  look: QuickLookImage
}

export interface ImageSource {
  /** 找不到（被删掉了，或者还没读到）时返回 null */
  lookup: (ref: ImageRef) => ImageInfo | null
  /** 资料和全局库都读过一次了（在这之前找不到不代表被删掉） */
  ready: boolean
  assets: ProjectAsset[]
  libImages: LibImage[]
}

export function useImageSource(projectId: string): ImageSource {
  const assets = useAssets(projectId)
  const lib = useLibImages()
  const ready = !assets.loading && !lib.loading

  const lookup = useMemo(() => {
    const map = new Map<string, ImageInfo>()
    for (const a of assets.data) {
      const ref: ImageRef = { scope: 'project', projectId, id: a.id }
      map.set(refKey(ref), { ref, name: a.name, width: a.width, height: a.height, source: '本项目资料', look: { ...a, ref } })
    }
    for (const img of lib.data) {
      const ref: ImageRef = { scope: 'library', id: img.id }
      map.set(refKey(ref), { ref, name: img.name, width: img.width, height: img.height, source: '全局库', look: { ...img, ref } })
    }
    return (ref: ImageRef): ImageInfo | null => map.get(refKey(ref)) ?? null
  }, [assets.data, lib.data, projectId])

  return { lookup, ready, assets: assets.data, libImages: lib.data }
}
