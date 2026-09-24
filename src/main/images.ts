// 图片文件：识别格式、读宽高、从文件或剪贴板取图，以及全局库 / 项目资料共用的"图片仓库"（原图 + 索引 + 内容哈希去重）。
import { clipboard, ClipboardItem, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { fileURLToPath } from 'url'
import type { ImageFormat } from '@shared/types'
import { isNotFound, newId, readJson, sha256, trash, withLock, writeFileAtomic, writeJson } from './storage'
import { fail } from './validate'

export const IMPORT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

const FORMAT_EXT: Record<ImageFormat, string> = { PNG: 'png', JPG: 'jpg', WEBP: 'webp', GIF: 'gif' }
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

export function mimeOf(file: string): string {
  return EXT_MIME[extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

/** 按文件头识别格式（不看扩展名） */
export function sniffFormat(buf: Buffer): ImageFormat | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'PNG'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'JPG'
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'GIF'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'WEBP'
  return null
}

interface Size {
  width: number
  height: number
}

/** 从文件头读出宽高；读不出来返回 null */
export function headerSize(buf: Buffer, format: ImageFormat): Size | null {
  try {
    switch (format) {
      case 'PNG':
        if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null
        return valid(buf.readUInt32BE(16), buf.readUInt32BE(20))
      case 'GIF':
        if (buf.length < 10) return null
        return valid(buf.readUInt16LE(6), buf.readUInt16LE(8))
      case 'WEBP':
        return webpSize(buf)
      case 'JPG':
        return jpegSize(buf)
    }
  } catch {
    return null
  }
}

function valid(width: number, height: number): Size | null {
  return width > 0 && height > 0 ? { width, height } : null
}

function webpSize(buf: Buffer): Size | null {
  if (buf.length < 30) return null
  const chunk = buf.toString('latin1', 12, 16)
  if (chunk === 'VP8 ') {
    // 有损：帧头起始码 9d 01 2a 之后是 14 位宽、14 位高
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null
    return valid(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff)
  }
  if (chunk === 'VP8L') {
    // 无损：签名 0x2f 之后 14 位宽-1、14 位高-1
    if (buf[20] !== 0x2f) return null
    const bits = buf.readUInt32LE(21)
    return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X') {
    // 扩展格式：24 位宽-1、24 位高-1
    return valid(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1)
  }
  return null
}

function jpegSize(buf: Buffer): Size | null {
  let off = 2
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return null
    const marker = buf[off + 1]
    if (marker === 0xff) {
      off += 1 // 填充字节
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2 // 没有长度字段的标记
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // 图像结束 / 扫描开始之前都没找到 SOF
    const len = buf.readUInt16BE(off + 2)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (off + 9 > buf.length) return null
      return valid(buf.readUInt16BE(off + 7), buf.readUInt16BE(off + 5))
    }
    off += 2 + len
  }
  return null
}

export interface ImageInfo {
  format: ImageFormat
  ext: string
  width: number
  height: number
}

/** 识别图片：格式看文件头；宽高优先用 nativeImage，读不到再解析文件头 */
export function imageInfo(buf: Buffer): ImageInfo | null {
  const format = sniffFormat(buf)
  if (!format) return null
  let size: Size | null = null
  try {
    const s = nativeImage.createFromBuffer(buf).getSize()
    size = valid(s.width, s.height)
  } catch {
    size = null
  }
  size ??= headerSize(buf, format)
  if (!size) return null
  return { format, ext: FORMAT_EXT[format], width: size.width, height: size.height }
}

/** 一张待加入仓库的图片 */
export interface Candidate {
  buf: Buffer
  info: ImageInfo
  name: string
}

/** 读取本地图片文件；扩展名不对、不是文件或内容不是图片时返回 null */
export async function candidateFromFile(path: string): Promise<Candidate | null> {
  const ext = extname(path).slice(1).toLowerCase()
  if (!IMPORT_EXTENSIONS.includes(ext)) return null
  let buf: Buffer
  try {
    const st = await fs.stat(path)
    if (!st.isFile()) return null
    buf = await fs.readFile(path)
  } catch {
    return null
  }
  const info = imageInfo(buf)
  if (!info) return null
  return { buf, info, name: basename(path, extname(path)).trim() || '未命名' }
}

export async function candidatesFromFiles(files: string[]): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const f of files) {
    const c = await candidateFromFile(f)
    if (c) out.push(c)
  }
  return out
}

async function clipboardBlob(item: Electron.ClipboardItem, type: string): Promise<Blob | null> {
  const v = await item.getType(type)
  return v instanceof Blob ? v : null
}

/**
 * 系统剪贴板里的图片。在访达里拷贝的图片文件按原文件导入；
 * 其余情况取剪贴板里的图像数据（通常是 PNG）。没有图片时返回 null。
 */
export async function candidateFromClipboard(): Promise<Candidate | null> {
  const items = await clipboard.read()
  for (const item of items) {
    if (!item.types.includes('text/uri-list')) continue
    const blob = await clipboardBlob(item, 'text/uri-list')
    const list = blob ? await blob.text() : ''
    for (const line of list.split(/\r?\n/)) {
      if (!line.startsWith('file://')) continue
      let file: string
      try {
        file = fileURLToPath(line.trim())
      } catch {
        continue
      }
      const c = await candidateFromFile(file)
      if (c) return c
    }
  }
  for (const item of items) {
    const type = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].find((t) => item.types.includes(t))
    if (!type) continue
    const blob = await clipboardBlob(item, type)
    if (!blob) continue
    const buf = Buffer.from(await blob.arrayBuffer())
    const info = imageInfo(buf)
    if (info) return { buf, info, name: '粘贴的图片' }
  }
  return null
}

/**
 * 系统缩略图（QuickLook，能解 WEBP / GIF）。结果可能带 1x、2x 两种倍率，
 * 这里重新解码成单一的像素尺寸：最长边不超过 box 的两倍，也不超过原图。
 */
export async function systemThumbnail(path: string, width: number, height: number): Promise<NativeImage | null> {
  try {
    const t = await nativeImage.createThumbnailFromPath(path, { width, height })
    if (t.isEmpty()) return null
    const img = nativeImage.createFromBuffer(t.toPNG())
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

/** 把图片原图写进系统剪贴板（PNG；其他格式先转成 PNG）。读不出图像时返回 false */
export async function copyImageToClipboard(path: string, width: number, height: number): Promise<boolean> {
  const buf = await fs.readFile(path)
  let png: Buffer | null = null
  if (sniffFormat(buf) === 'PNG') png = buf
  else {
    let img: NativeImage | null = nativeImage.createFromPath(path)
    if (img.isEmpty()) img = await systemThumbnail(path, width, height)
    if (img && !img.isEmpty()) png = img.toPNG()
  }
  if (!png?.length) return false
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  return true
}

// ---------- 图片仓库 ----------

/** 仓库里一条记录至少有 id 和原图文件名 */
export interface StoredImage {
  id: string
  file: string
}

/** 一个图片仓库：原图目录 + 索引 JSON + 内容哈希表（id → sha256） */
export interface ImageStore {
  dir: string
  index: string
  hashes: string
}

/** 原图的完整路径；索引里的文件名必须是单纯的文件名 */
export function storedPath(store: ImageStore, item: StoredImage): string {
  if (!item.file || basename(item.file) !== item.file) fail('图片文件名不合法')
  return join(store.dir, item.file)
}

/** 读取哈希表，补上缺的（比如手动放进来的旧数据）、去掉已删除的；返回是否有变动 */
async function loadHashes<T extends StoredImage>(
  store: ImageStore,
  list: T[]
): Promise<{ hashes: Record<string, string>; changed: boolean }> {
  const saved = await readJson<Record<string, string>>(store.hashes, {})
  const hashes: Record<string, string> = {}
  let changed = false
  for (const item of list) {
    const known = saved[item.id]
    if (typeof known === 'string' && known) {
      hashes[item.id] = known
      continue
    }
    try {
      hashes[item.id] = sha256(await fs.readFile(storedPath(store, item)))
      changed = true
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }
  if (Object.keys(saved).length !== Object.keys(hashes).length) changed = true
  return { hashes, changed }
}

export interface AddResult<T> {
  item: T
  isNew: boolean
}

/**
 * 把图片加入仓库（加锁）：复制原图为 <id>.<ext>，写入索引（新的排在最前）。
 * dedupe 为 true 时按内容哈希去重，已存在的返回原记录、isNew 为 false。
 */
export function addToStore<T extends StoredImage>(
  store: ImageStore,
  candidates: Candidate[],
  make: (c: Candidate, id: string, file: string) => T,
  dedupe = true
): Promise<AddResult<T>[]> {
  return withLock(store.index, async () => {
    const list = await readJson<T[]>(store.index, [])
    const { hashes, changed } = await loadHashes(store, list)
    const byHash = new Map<string, T>()
    for (const item of list) {
      const h = hashes[item.id]
      if (h && !byHash.has(h)) byHash.set(h, item)
    }
    const taken = new Set(list.map((x) => x.id))
    const results: AddResult<T>[] = []
    const added: T[] = []
    for (const c of candidates) {
      const hash = sha256(c.buf)
      const existing = dedupe ? byHash.get(hash) : undefined
      if (existing) {
        results.push({ item: existing, isNew: false })
        continue
      }
      const id = newId((x) => taken.has(x))
      taken.add(id)
      const file = `${id}.${c.info.ext}`
      await writeFileAtomic(join(store.dir, file), c.buf)
      const item = make(c, id, file)
      hashes[id] = hash
      if (!byHash.has(hash)) byHash.set(hash, item)
      added.push(item)
      results.push({ item, isNew: true })
    }
    if (added.length) {
      await writeJson(store.index, [...added, ...list])
      await writeJson(store.hashes, hashes)
    } else if (changed) {
      await writeJson(store.hashes, hashes)
    }
    return results
  })
}

export async function listStore<T extends StoredImage>(store: ImageStore): Promise<T[]> {
  const list = await readJson<T[]>(store.index, [])
  return Array.isArray(list) ? list : []
}

export async function findInStore<T extends StoredImage>(store: ImageStore, id: string): Promise<T | undefined> {
  return (await listStore<T>(store)).find((x) => x.id === id)
}

/** 修改一条记录（加锁）；找不到时报错 */
export function updateInStore<T extends StoredImage>(
  store: ImageStore,
  id: string,
  notFound: string,
  fn: (item: T) => T
): Promise<T> {
  return withLock(store.index, async () => {
    const list = await readJson<T[]>(store.index, [])
    const i = list.findIndex((x) => x.id === id)
    if (i < 0) fail(notFound)
    list[i] = fn(list[i])
    await writeJson(store.index, list)
    return list[i]
  })
}

/** 从索引移除并把原图移到废纸篓（加锁）；找不到时报错 */
export function removeFromStore<T extends StoredImage>(store: ImageStore, id: string, notFound: string): Promise<T> {
  return withLock(store.index, async () => {
    const list = await readJson<T[]>(store.index, [])
    const item = list.find((x) => x.id === id)
    if (!item) fail(notFound)
    await trash(storedPath(store, item))
    await writeJson(
      store.index,
      list.filter((x) => x.id !== id)
    )
    const hashes = await readJson<Record<string, string>>(store.hashes, {})
    if (id in hashes) {
      delete hashes[id]
      await writeJson(store.hashes, hashes)
    }
    return item
  })
}
