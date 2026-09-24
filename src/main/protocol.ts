// gp:// 协议：把本地图片安全地交给界面显示。
//   gp://image/library/<id>                 全局库原图
//   gp://image/project/<projectId>/<id>     项目资料原图
//   ?thumb=N                                缩略图，最长边不超过 N 像素
import { protocol } from 'electron'
import { promises as fs } from 'fs'
import type { ImageRef } from '@shared/types'
import { findInStore, mimeOf, storedPath } from './images'
import type { StoredImage } from './images'
import { getImage, libraryStore } from './library'
import { assetStore } from './projects'
import { isNotFound } from './storage'
import { thumbnail } from './thumbs'
import { isSafeId } from './validate'

export interface ResolvedImage {
  path: string
  width: number
  height: number
  /** 缩略图缓存里这张图的前缀 */
  thumbKey: string
}

/** 找到图片原文件；不存在时返回 null */
export async function resolveImage(ref: ImageRef): Promise<ResolvedImage | null> {
  let item: (StoredImage & { width: number; height: number }) | undefined
  let path: string
  let thumbKey: string
  if (ref.scope === 'library') {
    if (!isSafeId(ref.id)) return null
    item = await getImage(ref.id)
    if (!item) return null
    path = storedPath(libraryStore(), item)
    thumbKey = `lib.${ref.id}.`
  } else {
    if (!isSafeId(ref.projectId) || !isSafeId(ref.id)) return null
    const store = assetStore(ref.projectId)
    item = await findInStore(store, ref.id)
    if (!item) return null
    path = storedPath(store, item)
    thumbKey = `prj.${ref.projectId}.${ref.id}.`
  }
  try {
    if (!(await fs.stat(path)).isFile()) return null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  return { path, width: item.width, height: item.height, thumbKey }
}

function parseRef(url: URL): ImageRef | null {
  if (url.hostname !== 'image') return null
  let parts: string[]
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  if (parts[0] === 'library' && parts.length === 2) return { scope: 'library', id: parts[1] }
  if (parts[0] === 'project' && parts.length === 3) return { scope: 'project', projectId: parts[1], id: parts[2] }
  return null
}

function reply(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

function image(buf: Buffer, mime: string): Response {
  return new Response(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(buf.byteLength),
      'Access-Control-Allow-Origin': '*'
    }
  })
}

async function handle(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return reply(400, 'Bad request')
  }
  const ref = parseRef(url)
  if (!ref) return reply(404, 'Not found')
  const found = await resolveImage(ref)
  if (!found) return reply(404, 'Not found')

  const thumbParam = url.searchParams.get('thumb')
  if (thumbParam !== null) {
    const size = Number(thumbParam)
    if (!Number.isInteger(size) || size <= 0) return reply(400, 'Bad thumb size')
    const n = Math.min(Math.max(size, 16), 4096)
    // 原图本来就不比缩略图大时直接给原图（像素画放大会糊）
    if (Math.max(found.width, found.height) > n) {
      const jpeg = mimeOf(found.path) === 'image/jpeg'
      const t = await thumbnail(found.path, found.thumbKey, n, jpeg)
      if (t) return image(t.buf, t.mime)
    }
  }
  return image(await fs.readFile(found.path), mimeOf(found.path))
}

export function registerImageProtocol(): void {
  protocol.handle('gp', async (request) => {
    try {
      return await handle(request)
    } catch (err) {
      console.error('[gp protocol]', request.url, err)
      return reply(500, 'Internal error')
    }
  })
}
