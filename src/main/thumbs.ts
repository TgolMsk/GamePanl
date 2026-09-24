// 缩略图：生成后缓存到 <数据目录>/.cache/thumbs/。
// 缓存文件名里带原图的修改时间和大小，原图变了自然失效；图片或项目删除时清掉对应前缀的缓存。
import { nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { systemThumbnail } from './images'
import { isNotFound, paths, writeFileAtomic } from './storage'

export interface Thumb {
  buf: Buffer
  mime: string
}

const pending = new Map<string, Promise<Thumb | null>>()

/**
 * 取缩略图（最长边不超过 size）。key 是这张图在缓存里的前缀，如 "lib.<id>."。
 * 生成不了时返回 null（调用方退回原图）。
 */
export async function thumbnail(src: string, key: string, size: number, jpeg: boolean): Promise<Thumb | null> {
  const st = await fs.stat(src)
  const ext = jpeg ? 'jpg' : 'png'
  const mime = jpeg ? 'image/jpeg' : 'image/png'
  const cacheFile = join(paths.thumbs(), `${key}${size}.${Math.floor(st.mtimeMs)}.${st.size}.${ext}`)
  try {
    return { buf: await fs.readFile(cacheFile), mime }
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
  let job = pending.get(cacheFile)
  if (!job) {
    job = (async (): Promise<Thumb | null> => {
      const img = await makeThumbnail(src, size)
      if (!img) return null
      const buf = jpeg ? img.toJPEG(85) : img.toPNG()
      await writeFileAtomic(cacheFile, buf)
      return { buf, mime }
    })().finally(() => pending.delete(cacheFile))
    pending.set(cacheFile, job)
  }
  return job
}

async function makeThumbnail(src: string, size: number): Promise<NativeImage | null> {
  let img = await systemThumbnail(src, size, size)
  if (!img) {
    const full = nativeImage.createFromPath(src)
    if (full.isEmpty()) return null
    img = full
  }
  const { width, height } = img.getSize()
  const scale = size / Math.max(width, height)
  if (scale >= 1) return img
  return img.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good'
  })
}

/** 删掉以 prefix 开头的缓存文件（缓存可以随时重建，直接删除） */
export async function dropThumbs(prefix: string): Promise<void> {
  let names: string[]
  try {
    names = await fs.readdir(paths.thumbs())
  } catch (err) {
    if (isNotFound(err)) return
    throw err
  }
  await Promise.all(
    names.filter((n) => n.startsWith(prefix)).map((n) => fs.rm(join(paths.thumbs(), n), { force: true }))
  )
}
