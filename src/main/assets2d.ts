// 全局库 · 2D 资产：每个资产一个文件夹 library/assets2d/<id>/，索引与图片内容哈希分别保存。
import { constants as fsConstants, createReadStream, promises as fs } from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { ASSET2D_CATEGORIES } from '@shared/types'
import type { Asset2DImportResult, ID, LibAsset2D } from '@shared/types'
import { safeFileName } from '@shared/sprites'
import type { SpriteExportBundle } from '@shared/sprites'
import { ASSET2D_EXTENSIONS, asset2dRelativePath, detectAsset2D, isAsset2DImage } from './asset2dDetect'
import type { DetectedAsset2D } from './asset2dDetect'
import { imageInfo } from './images'
import { encodePng, writeSpriteExport } from './spriteExport'
import { exists, newId, nowIso, paths, readJson, sha256, trash, withLock, writeFileAtomic, writeJson } from './storage'
import { dropThumbs } from './thumbs'
import { asLine, asObject, asOneOf, asStringList, fail, has, isSafeId } from './validate'

export { ASSET2D_EXTENSIONS }
const MAX_FOLDER_BYTES = 2 * 1024 ** 3
const MAX_FOLDER_FILES = 3000
const MAX_SOURCES = 200

// ---------- 读写索引 ----------

export async function listAssets2D(): Promise<LibAsset2D[]> {
  const list = await readJson<LibAsset2D[]>(paths.libAssets2D(), [])
  return Array.isArray(list) ? list : []
}

export async function getAsset2D(id: ID): Promise<LibAsset2D | undefined> {
  return (await listAssets2D()).find((asset) => asset.id === id)
}

export function asset2dDir(id: ID): string {
  if (!isSafeId(id)) fail('2D 资产 id 不合法')
  return join(paths.libAssets2DDir(), id)
}

/** 文件夹里某个文件的完整路径；不允许跑出文件夹。 */
export function asset2dFilePath(id: ID, rel: string): string {
  const dir = asset2dDir(id)
  const safe = asset2dRelativePath(rel)
  if (!safe) fail('文件路径不合法')
  const full = resolve(dir, safe)
  if (!full.startsWith(dir + sep)) fail('文件路径不合法')
  return full
}

export async function updateAsset2D(id: ID, patch: unknown): Promise<LibAsset2D> {
  const p = asObject(patch, '修改内容')
  const name = has(p, 'name') ? asLine(p['name'], '名称').trim() : undefined
  if (name !== undefined && !name) fail('名称不能为空')
  const category = has(p, 'category') ? asOneOf(p['category'], ASSET2D_CATEGORIES, '分类') : undefined
  const tags = has(p, 'tags') ? asStringList(p['tags'], '标签') : undefined
  const result = await withLock(paths.libAssets2D(), async () => {
    const list = await listAssets2D()
    const index = list.findIndex((asset) => asset.id === id)
    if (index < 0) fail('2D 资产不存在')
    list[index] = {
      ...list[index], ...(name !== undefined && { name }), ...(category !== undefined && { category }),
      ...(tags !== undefined && { tags }), updatedAt: nowIso()
    }
    await writeJson(paths.libAssets2D(), list)
    return list[index]
  })
  await dropThumbs(`a2d.${id}.`)
  return result
}

/** 整个文件夹移到废纸篓，去掉索引、哈希和缩略图。 */
export async function deleteAsset2D(id: ID): Promise<void> {
  await withLock(paths.libAssets2D(), async () => {
    const list = await listAssets2D()
    if (!list.some((asset) => asset.id === id)) fail('2D 资产不存在')
    await trash(asset2dDir(id))
    await writeJson(paths.libAssets2D(), list.filter((asset) => asset.id !== id))
    const hashes = await readJson<Record<string, string>>(paths.libAsset2DHashes(), {})
    if (id in hashes) {
      delete hashes[id]
      await writeJson(paths.libAsset2DHashes(), hashes)
    }
  })
  await dropThumbs(`a2d.${id}.`)
}

// ---------- 拷贝出去 ----------

export async function copyAsset2DTargetExists(id: ID, destDir: string): Promise<boolean> {
  asset2dDir(id)
  return exists(join(destDir, id))
}

/** 拷贝到 destDir/<id>；替换时先移到废纸篓，否则重名加空格和序号。 */
export async function copyAsset2DTo(id: ID, destDir: string, replace: boolean): Promise<string> {
  return withLock(paths.libAssets2D(), async () => {
    if (!(await getAsset2D(id))) fail('2D 资产不存在')
    const src = asset2dDir(id)
    if (!(await exists(src))) fail('2D 资产文件夹不见了')
    const dest0 = resolve(destDir, id)
    const realSrc = await fs.realpath(src)
    const realDest = resolve(await fs.realpath(destDir), id)
    if (realDest === realSrc || realDest.startsWith(realSrc + sep) || realSrc.startsWith(realDest + sep)) fail('不能拷贝到资产自己的文件夹或上级目录里')
    let dest = dest0
    if (replace) await trash(dest)
    else for (let n = 2; await exists(dest); n++) dest = `${dest0} ${n}`
    await fs.cp(src, dest, {
      recursive: true, mode: fsConstants.COPYFILE_FICLONE, errorOnExist: true, force: false,
      filter: async (file) => basename(file) !== '.DS_Store' && !(await fs.lstat(file)).isSymbolicLink()
    })
    return dest
  })
}

// ---------- 导入 ----------

interface Source {
  folder: string | null
  root: string
  file: string
  files: string[]
}

interface FolderInfo {
  bytes: number
  files: string[]
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.lstat(file)).isFile()
  } catch {
    return false
  }
}

async function jsonAt(file: string): Promise<unknown> {
  try {
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 文件表也用于拷贝和识别；不跟随软链接，避免把目录外的文件带进来。 */
async function folderInfo(dir: string): Promise<FolderInfo> {
  const info: FolderInfo = { bytes: 0, files: [] }
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue
      const file = join(folder, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile()) {
        info.files.push(relative(dir, file).split(sep).join('/'))
        info.bytes += (await fs.stat(file)).size
        if (info.bytes > MAX_FOLDER_BYTES || info.files.length > MAX_FOLDER_FILES) {
          fail(`文件夹太大了（超过 2 GB 或 ${MAX_FOLDER_FILES} 个文件），请只拖入资产文件夹`)
        }
      }
    }
  }
  await walk(dir)
  info.files.sort()
  return info
}

/** 最多往下三层找 asset.json；找到资产根目录就不再拆它里面的内容。 */
async function assetFolders(dir: string, depth: number): Promise<string[]> {
  if (await isFile(join(dir, 'asset.json'))) return [dir]
  if (depth >= 3) return []
  const out: string[] = []
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    out.push(...await assetFolders(join(dir, entry.name), depth + 1))
    if (out.length > MAX_SOURCES) fail(`一次最多导入 ${MAX_SOURCES} 个 2D 资产`)
  }
  return out
}

async function collectSources(input: string[]): Promise<{ sources: Source[]; skipped: Asset2DImportResult['skipped'] }> {
  const sources: Source[] = []
  const skipped: Asset2DImportResult['skipped'] = []
  for (const path of input) {
    try {
      const full = resolve(path)
      const stat = await fs.lstat(full)
      if (stat.isDirectory()) {
        const folders = await assetFolders(full, 0)
        if (folders.length) sources.push(...folders.map((folder) => ({ folder, root: folder, file: '', files: [] })))
        else {
          const info = await folderInfo(full)
          if (info.files.some(isAsset2DImage)) sources.push({ folder: full, root: full, file: '', files: [] })
          else skipped.push({ path, reason: '文件夹里没有图片' })
        }
      } else if (stat.isFile() && isAsset2DImage(full)) {
        const file = basename(full)
        const files = [file]
        const sidecar = `${basename(full, extname(full))}.json`
        if (await isFile(join(dirname(full), sidecar))) files.push(sidecar)
        sources.push({ folder: null, root: dirname(full), file, files })
      } else if (stat.isFile() && extname(full).toLowerCase() === '.json') {
        const value = await jsonAt(full) as { meta?: { image?: unknown }; frames?: unknown } | null
        const rel = typeof value?.meta?.image === 'string' ? asset2dRelativePath(value.meta.image) : null
        if (!rel || !isAsset2DImage(rel) || !value?.frames || typeof value.frames !== 'object' || !(await isFile(join(dirname(full), rel)))) {
          skipped.push({ path, reason: '不是 Aseprite / JSON 图集，或找不到配套图片' })
          continue
        }
        const root = dirname(full)
        const realImage = await fs.realpath(join(root, rel))
        if (!realImage.startsWith(await fs.realpath(root) + sep)) fail('图集图片不在文件夹里面')
        sources.push({ folder: null, root, file: basename(full), files: [basename(full), rel] })
      } else skipped.push({ path, reason: '不是图片、图集 JSON 或资产文件夹' })
    } catch (err) {
      skipped.push({ path, reason: (err as NodeJS.ErrnoException).code === 'ENOENT' ? '找不到这个文件' : err instanceof Error ? err.message : String(err) })
    }
  }
  const seen = new Set<string>()
  const unique = sources.filter((source) => {
    const key = source.folder ?? join(source.root, source.file)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (unique.length > MAX_SOURCES) fail(`一次最多导入 ${MAX_SOURCES} 个 2D 资产`)
  return { sources: unique, skipped }
}

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 48)
}

function folderName(folder: string): string {
  return basename(folder).toLowerCase() === 'export' ? basename(dirname(folder)) : basename(folder)
}

async function pickId(names: string[], taken: Set<string>): Promise<string> {
  const base = names.map(slug).find((name) => name.length >= 2) ?? `asset2d_${newId().slice(0, 6)}`
  let id = base
  for (let n = 2; taken.has(id) || await exists(asset2dDir(id)); n++) id = `${base}_${n}`
  return id
}

async function inspect(dir: string, files: string[], name: string): Promise<DetectedAsset2D> {
  return detectAsset2D({
    files, name,
    readJson: (file) => jsonAt(join(dir, file)),
    readImageSize: async (file) => {
      const info = imageInfo(await fs.readFile(join(dir, file)))
      return info ? [info.width, info.height] : null
    }
  })
}

/** 所有图片按相对路径排序，每项由路径和内容哈希组成；不会把大图全留在内存里。 */
async function imageHash(dir: string, files: string[]): Promise<string> {
  const parts: string[] = []
  for (const file of files.filter(isAsset2DImage).sort()) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(join(dir, file))) hash.update(chunk)
    parts.push(`${file}:${hash.digest('hex')}`)
  }
  return sha256(Buffer.from(parts.join('\n')))
}

async function sourceInfo(source: Source): Promise<FolderInfo> {
  if (source.folder) return folderInfo(source.folder)
  let bytes = 0
  for (const file of source.files) bytes += (await fs.stat(join(source.root, file))).size
  if (bytes > MAX_FOLDER_BYTES) fail('资产文件太大了（超过 2 GB）')
  return { bytes, files: source.files }
}

/** 按已经检查过的文件表拷贝，临时目录完整写好后再放进库。 */
async function copyIn(source: Source, info: FolderInfo, id: ID): Promise<void> {
  const tmp = join(paths.libAssets2DDir(), `.incoming-${newId()}`)
  try {
    if (source.folder) {
      await fs.cp(source.folder, tmp, {
        recursive: true, mode: fsConstants.COPYFILE_FICLONE,
        filter: async (file) => basename(file) !== '.DS_Store' && !(await fs.lstat(file)).isSymbolicLink()
      })
    } else {
      await fs.mkdir(tmp, { recursive: true })
      const root = await fs.realpath(source.root)
      for (const file of info.files) {
        const src = join(source.root, file)
        if (!(await fs.lstat(src)).isFile()) fail('导入文件已发生变化，请重新导入')
        const real = await fs.realpath(src)
        if (!real.startsWith(root + sep)) fail('导入文件不在资产文件夹里面')
        await fs.mkdir(dirname(join(tmp, file)), { recursive: true })
        await fs.copyFile(src, join(tmp, file), fsConstants.COPYFILE_FICLONE)
      }
    }
    await fs.rename(tmp, asset2dDir(id))
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true })
    throw err
  }
}

function makeRecord(info: DetectedAsset2D, stats: FolderInfo, id: ID, importedFrom: string): LibAsset2D {
  const { idHint: _idHint, ...metadata } = info
  const at = nowIso()
  return { ...metadata, id, fromSprite: null, importedFrom, bytes: stats.bytes, fileCount: stats.files.length, addedAt: at, updatedAt: at }
}

/** 导入资产（加锁）：按图片相对路径和内容去重，新资产排在最前。 */
export async function importAssets2D(input: string[]): Promise<Asset2DImportResult> {
  const { sources, skipped } = await collectSources(input)
  if (!sources.length) return { added: [], existing: [], skipped }
  return withLock(paths.libAssets2D(), async () => {
    const list = await listAssets2D()
    const hashes = await readJson<Record<string, string>>(paths.libAsset2DHashes(), {})
    const byHash = new Map<string, LibAsset2D>()
    for (const asset of list) if (hashes[asset.id] && !byHash.has(hashes[asset.id])) byHash.set(hashes[asset.id], asset)
    const taken = new Set(list.map((asset) => asset.id))
    const added: LibAsset2D[] = []
    const existing: LibAsset2D[] = []
    for (const source of sources) {
      let copied: ID | null = null
      try {
        const stats = await sourceInfo(source)
        const hash = await imageHash(source.root, stats.files)
        const known = byHash.get(hash)
        if (known) {
          if (!existing.includes(known) && !added.includes(known)) existing.push(known)
          continue
        }
        const name = source.folder ? folderName(source.folder) : basename(source.file, extname(source.file))
        const info = await inspect(source.root, stats.files, name)
        const id = await pickId([info.idHint, name], taken)
        await copyIn(source, stats, id)
        copied = id
        const asset = makeRecord(info, stats, id, source.folder ?? join(source.root, source.file))
        taken.add(id)
        hashes[id] = hash
        byHash.set(hash, asset)
        added.push(asset)
      } catch (err) {
        if (copied) await fs.rm(asset2dDir(copied), { recursive: true, force: true })
        skipped.push({ path: source.folder ?? join(source.root, source.file), reason: err instanceof Error ? err.message : String(err) })
      }
    }
    if (added.length) {
      await writeJson(paths.libAssets2D(), [...added, ...list])
      await writeJson(paths.libAsset2DHashes(), hashes)
    }
    return { added, existing, skipped }
  })
}

// ---------- 序列帧导出存入 ----------

interface SpriteAssetInput {
  owner: ID | null
  characterId: ID
  name: string
  /** true 时用 name 改掉库里的名称；否则保留用户在库里改过的名称 */
  rename?: boolean
  bundle: SpriteExportBundle
  assetId: ID | null
  /** 人物素材（主图在前），拷进资产的 refs/ */
  refs: Array<{ path: string; name: string }>
  description: string
}

/** 资产里能当人物素材的图片（绝对路径，最多 12 张）：refs/ 里的优先，其次预览图；静态资产再加上其余图片 */
export async function characterImages(id: ID): Promise<string[]> {
  const asset = await getAsset2D(id)
  if (!asset) fail('2D 资产不存在')
  const dir = asset2dDir(id)
  const stats = await folderInfo(dir)
  const images = stats.files.filter(isAsset2DImage).filter((f) => !/\.gif$/i.test(f))
  const refs = (asset.references ?? []).filter((f) => images.includes(f))
  const picked = [...refs]
  if (!picked.length && asset.preview && images.includes(asset.preview)) picked.push(asset.preview)
  if (!refs.length && asset.animations.length === 0) picked.push(...images.filter((f) => !picked.includes(f)))
  if (!picked.length && images[0]) picked.push(images[0])
  return picked.slice(0, 12).map((f) => join(dir, f))
}

/** 透明预览图按整数倍最近邻放大，保持每个像素的边缘。 */
function spritePreview(bundle: SpriteExportBundle): Buffer {
  const action = bundle.actions.find((action) => action.name.toLowerCase() === 'idle') ?? bundle.actions[0]
  const scale = Math.max(1, Math.ceil(128 / Math.max(action.frameWidth, action.frameHeight)))
  const width = action.frameWidth * scale
  const height = action.frameHeight * scale
  const pixels = new Uint8Array(width * height * 4)
  const frame = action.frames[0]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (Math.floor(y / scale) * action.frameWidth + Math.floor(x / scale)) * 4
    pixels.set(frame.subarray(from, from + 4), (y * width + x) * 4)
  }
  return encodePng(pixels, width, height)
}

/** 重复导出替换同一资产；保留用户整理的名称、分类、标签和加入时间。 */
export async function saveSpriteAsset(input: SpriteAssetInput): Promise<LibAsset2D> {
  return withLock(paths.libAssets2D(), async () => {
    const list = await listAssets2D()
    const hashes = await readJson<Record<string, string>>(paths.libAsset2DHashes(), {})
    const old = input.assetId ? list.find((asset) => asset.id === input.assetId) : undefined
    const id = old?.id ?? await pickId([input.name], new Set(list.map((asset) => asset.id)))
    const tmp = join(paths.libAssets2DDir(), `.incoming-${newId()}`)
    const backup = join(paths.libAssets2DDir(), `.previous-${id}-${newId()}`)
    const dest = asset2dDir(id)
    let movedOld = false
    let movedNew = false
    let wroteIndex = false
    const bundle = { ...input.bundle, godotPrefix: null }
    try {
      const result = await writeSpriteExport(tmp, bundle)
      await writeFileAtomic(join(result.folder, 'preview.png'), spritePreview(bundle))
      // 人物素材原样拷进 refs/，文件名用素材名（重名加编号）
      const references: string[] = []
      for (const ref of input.refs) {
        const ext = extname(ref.path).toLowerCase()
        let file = `refs/${safeFileName(ref.name, 'ref')}${ext}`
        for (let n = 2; references.includes(file); n++) file = `refs/${safeFileName(ref.name, 'ref')}_${n}${ext}`
        await fs.mkdir(join(result.folder, 'refs'), { recursive: true })
        await fs.copyFile(ref.path, join(result.folder, file))
        references.push(file)
      }
      const fromSprite = { owner: input.owner, characterId: input.characterId }
      await writeJson(join(result.folder, 'asset.json'), {
        id, name: input.rename || !old ? input.name : old.name, kind: '2d', category: old?.category ?? '角色', tags: old?.tags ?? ['序列帧'],
        preview: 'preview.png', frame_size: [bundle.actions[0].frameWidth, bundle.actions[0].frameHeight],
        ...(input.description.trim() && { description: input.description.trim() }),
        ...(references.length && { references }),
        animations: bundle.actions.map((action) => ({
          name: action.name, fps: action.fps, loop: action.loop,
          ...(typeof action.meta['group'] === 'string' && { group: action.meta['group'] }),
          frames: action.frames.map((_, index) => `${safeFileName(action.name)}/frames/frame_${String(index).padStart(action.frames.length > 100 ? 3 : 2, '0')}.png`)
        })),
        source: { how_made: 'GamePanl 序列帧（AI 绿幕动作视频）' }, fromSprite
      })
      const stats = await folderInfo(result.folder)
      const info = await inspect(result.folder, stats.files, input.name)
      const hash = await imageHash(result.folder, stats.files)
      const asset = { ...makeRecord(info, stats, id, ''), fromSprite, addedAt: old?.addedAt ?? nowIso() }
      if (await exists(dest)) {
        await fs.rename(dest, backup)
        movedOld = true
      }
      await fs.rename(result.folder, dest)
      movedNew = true
      wroteIndex = true
      await writeJson(paths.libAsset2DHashes(), { ...hashes, [id]: hash })
      await writeJson(paths.libAssets2D(), old ? list.map((item) => item.id === id ? asset : item) : [asset, ...list])
      await dropThumbs(`a2d.${id}.`)
      // 旧版本是上次导出生成的，直接删掉，不往废纸篓里堆
      if (movedOld) await fs.rm(backup, { recursive: true, force: true })
      return asset
    } catch (err) {
      if (movedNew) await fs.rm(dest, { recursive: true, force: true })
      if (movedOld) await fs.rename(backup, dest)
      if (wroteIndex) {
        await writeJson(paths.libAsset2DHashes(), hashes)
        await writeJson(paths.libAssets2D(), list)
      }
      throw err
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
}
