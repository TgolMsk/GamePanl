// gp:// 协议：把本地图片安全地交给界面显示。
//   gp://image/library/<id>                 全局库原图
//   gp://image/project/<projectId>/<id>     项目资料原图
//   ?thumb=N                                缩略图，最长边不超过 N 像素
//   gp://model/<id>/file/<相对路径>          全局库模型文件夹里的文件（.glb、.gltf、.bin、贴图）
//   gp://model/<id>/preview                 模型预览图（文件夹自带的或界面渲染的），也支持 ?thumb=N
import { protocol } from 'electron'
import { promises as fs } from 'fs'
import type { ImageRef } from '@shared/types'
import { findInStore, mimeOf, storedPath } from './images'
import type { StoredImage } from './images'
import { getImage, libraryStore } from './library'
import { getModel, modelFilePath, modelPreviewPath } from './models'
import { assetStore } from './projects'
import { videoPath } from './sprites'
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

const MODEL_MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
  ktx2: 'image/ktx2',
  json: 'application/json'
}

function fileMime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return MODEL_MIME[ext] ?? mimeOf(path)
}

async function readIfFile(path: string): Promise<Buffer | null> {
  try {
    if (!(await fs.stat(path)).isFile()) return null
    return await fs.readFile(path)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** gp://model/... */
async function handleModel(url: URL): Promise<Response> {
  let parts: string[]
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return reply(400, 'Bad request')
  }
  const [id, kind, ...rest] = parts
  if (!isSafeId(id)) return reply(404, 'Not found')
  const model = await getModel(id)
  if (!model) return reply(404, 'Not found')
  if (kind === 'file' && rest.length > 0) {
    let path: string
    try {
      path = modelFilePath(id, rest.join('/'))
    } catch {
      return reply(404, 'Not found')
    }
    const buf = await readIfFile(path)
    return buf ? image(buf, fileMime(path)) : reply(404, 'Not found')
  }
  if (kind === 'preview' && rest.length === 0) {
    const path = await modelPreviewPath(model)
    if (!path) return reply(404, 'Not found')
    const thumbParam = url.searchParams.get('thumb')
    if (thumbParam !== null) {
      const size = Number(thumbParam)
      if (!Number.isInteger(size) || size <= 0) return reply(400, 'Bad thumb size')
      const n = Math.min(Math.max(size, 16), 4096)
      const t = await thumbnail(path, `mdl.${id}.`, n, false)
      if (t) return image(t.buf, t.mime)
    }
    return image(await fs.readFile(path), mimeOf(path))
  }
  return reply(404, 'Not found')
}

/** gp://sprite/<项目 id>/<角色 id>/<动作 id>：序列帧动作的源视频 */
async function handleSprite(url: URL): Promise<Response> {
  let parts: string[]
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return reply(400, 'Bad request')
  }
  if (parts.length !== 3 || !parts.every(isSafeId)) return reply(404, 'Not found')
  const path = await videoPath(parts[0], parts[1], parts[2])
  const buf = path ? await readIfFile(path) : null
  if (!buf || !path) return reply(404, 'Not found')
  return image(buf, path.endsWith('.mov') ? 'video/quicktime' : 'video/mp4')
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
  if (url.hostname === 'model') return handleModel(url)
  if (url.hostname === 'sprite') return handleSprite(url)
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
