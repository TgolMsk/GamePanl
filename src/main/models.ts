// 全局库 · 3D 模型：每个模型一个文件夹 library/models/<id>/（导入的资产文件夹原样保留），
// 索引 models.json，模型主文件的内容哈希 model-hashes.json（去重用），界面渲染的缩略图 model-previews/<id>.png。
import { constants as fsConstants, promises as fs } from 'fs'
import type { Dirent } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { MODEL_CATEGORIES } from '@shared/types'
import type { ID, LibModel, ModelAnimation, ModelCategory, ModelImportResult } from '@shared/types'
import { parseGltf } from './gltf'
import type { GltfInfo } from './gltf'
import { sniffFormat } from './images'
import { exists, isNotFound, newId, nowIso, paths, readJson, sha256, trash, withLock, writeFileAtomic, writeJson } from './storage'
import { dropThumbs } from './thumbs'
import { asLine, asObject, asOneOf, asStringList, fail, has, isSafeId } from './validate'

export const MODEL_EXTENSIONS = ['glb', 'gltf']

/** 文件夹里认作预览图的文件名（asset.json 没写 preview 时按顺序找） */
const PREVIEW_NAMES = ['preview.png', 'preview.jpg', 'preview.jpeg', 'preview.webp', 'thumbnail.png', 'thumb.png']
/** 往下找模型时跳过的文件夹 */
const SKIP_DIRS = new Set(['node_modules', 'blender', 'textures', 'concept', 'renders', 'godot_viewer'])
/** 一个资产文件夹最大多少（防止误拖进整个硬盘目录） */
const MAX_FOLDER_BYTES = 2 * 1024 ** 3
const MAX_FOLDER_FILES = 3000
/** 一次最多导入多少个模型 */
const MAX_SOURCES = 200

const isModelFile = (name: string): boolean => MODEL_EXTENSIONS.includes(extname(name).slice(1).toLowerCase())

// ---------- 读写索引 ----------

export async function listModels(): Promise<LibModel[]> {
  const list = await readJson<LibModel[]>(paths.libModels(), [])
  return Array.isArray(list) ? list : []
}

export async function getModel(id: ID): Promise<LibModel | undefined> {
  return (await listModels()).find((m) => m.id === id)
}

/** 模型文件夹 */
export function modelDir(id: ID): string {
  if (!isSafeId(id)) fail('模型 id 不合法')
  return join(paths.libModelsDir(), id)
}

/** 文件夹里某个文件的完整路径；不允许跑出文件夹 */
export function modelFilePath(id: ID, rel: string): string {
  const dir = modelDir(id)
  const full = resolve(dir, rel)
  if (!full.startsWith(dir + sep)) fail('文件路径不合法')
  return full
}

/** 界面渲染的缩略图 */
function renderedPreviewPath(id: ID): string {
  if (!isSafeId(id)) fail('模型 id 不合法')
  return join(paths.libModelPreviews(), `${id}.png`)
}

/** 预览图的完整路径（文件夹里自带的，或界面渲染的）；没有时返回 null */
export async function modelPreviewPath(model: LibModel): Promise<string | null> {
  const p = model.preview !== null ? modelFilePath(model.id, model.preview) : renderedPreviewPath(model.id)
  try {
    return (await fs.stat(p)).isFile() ? p : null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** 修改一条记录（加锁）；找不到时报错 */
function modifyModel(id: ID, fn: (m: LibModel) => LibModel): Promise<LibModel> {
  return withLock(paths.libModels(), async () => {
    const list = await listModels()
    const i = list.findIndex((m) => m.id === id)
    if (i < 0) fail('模型不存在')
    list[i] = fn(list[i])
    await writeJson(paths.libModels(), list)
    return list[i]
  })
}

export function updateModel(id: ID, patch: unknown): Promise<LibModel> {
  const p = asObject(patch, '修改内容')
  const name = has(p, 'name') ? asLine(p['name'], '名称').trim() : undefined
  if (name !== undefined && !name) fail('名称不能为空')
  const category = has(p, 'category') ? asOneOf(p['category'], MODEL_CATEGORIES, '分类') : undefined
  const tags = has(p, 'tags') ? asStringList(p['tags'], '标签') : undefined
  return modifyModel(id, (m) => ({
    ...m,
    ...(name !== undefined && { name }),
    ...(category !== undefined && { category }),
    ...(tags !== undefined && { tags })
  }))
}

/** 保存界面渲染的缩略图（PNG） */
export async function setModelPreview(id: ID, png: Buffer): Promise<LibModel> {
  if (png.length > 20 * 1024 * 1024 || sniffFormat(png) !== 'PNG') fail('缩略图必须是 PNG')
  if (!(await getModel(id))) fail('模型不存在')
  await writeFileAtomic(renderedPreviewPath(id), png)
  await dropThumbs(`mdl.${id}.`)
  return modifyModel(id, (m) => ({ ...m, rendered: true }))
}

/** 整个文件夹移到废纸篓，去掉索引、哈希和缩略图 */
export async function deleteModel(id: ID): Promise<void> {
  await withLock(paths.libModels(), async () => {
    const list = await listModels()
    if (!list.some((m) => m.id === id)) fail('模型不存在')
    await trash(modelDir(id))
    await writeJson(
      paths.libModels(),
      list.filter((m) => m.id !== id)
    )
    const hashes = await readJson<Record<string, string>>(paths.libModelHashes(), {})
    if (id in hashes) {
      delete hashes[id]
      await writeJson(paths.libModelHashes(), hashes)
    }
  })
  await fs.rm(renderedPreviewPath(id), { force: true })
  await dropThumbs(`mdl.${id}.`)
}

// ---------- 拷贝出去 ----------

/** 目标文件夹里有没有同名的 */
export async function copyTargetExists(id: ID, destDir: string): Promise<boolean> {
  return exists(join(destDir, id))
}

/**
 * 把模型文件夹拷贝到 destDir/<id>。replace：已有同名的先移到废纸篓；
 * 否则重名时改叫「<id> 2」「<id> 3」…。返回拷贝出来的文件夹路径。
 */
export async function copyModelTo(id: ID, destDir: string, replace: boolean): Promise<string> {
  if (!(await getModel(id))) fail('模型不存在')
  const src = modelDir(id)
  if (!(await exists(src))) fail('模型文件夹不见了')
  const dest0 = resolve(destDir, id)
  if (dest0 === src || dest0.startsWith(src + sep)) fail('不能拷贝到模型自己的文件夹里')
  let dest = dest0
  if (replace) await trash(dest)
  else for (let n = 2; await exists(dest); n++) dest = `${dest0} ${n}`
  await fs.cp(src, dest, { recursive: true, mode: fsConstants.COPYFILE_FICLONE, errorOnExist: true, force: false })
  return dest
}

// ---------- 导入 ----------

type AssetJson = Record<string, unknown>

/** 一个待导入的模型 */
interface Source {
  /** 整个原样拷贝的文件夹；单独导入模型文件时为 null */
  folder: string | null
  /** 模型主文件 */
  modelPath: string
  asset: AssetJson | null
}

interface Skip {
  path: string
  reason: string
}

async function readAssetJson(dir: string): Promise<AssetJson | null> {
  try {
    const v: unknown = JSON.parse((await fs.readFile(join(dir, 'asset.json'), 'utf8')).replace(/^﻿/, ''))
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as AssetJson) : null
  } catch {
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** asset.json 里写的相对路径（只认文件夹里面的） */
function insideRel(dir: string, rel: string): string | null {
  if (!rel) return null
  const full = resolve(dir, rel)
  return full.startsWith(dir + sep) ? relative(dir, full).split(sep).join('/') : null
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

/** 文件夹里的模型：有 asset.json 或只有一个模型文件 → 整个文件夹；有多个 → 每个文件单独导入；没有 → 往下找 */
async function folderSources(dir: string, depth: number): Promise<Source[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const models = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.') && isModelFile(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
  const asset = await readAssetJson(dir)
  if (asset) {
    const named = insideRel(dir, str(asset['file']))
    const main = named && isModelFile(named) && (await isFile(join(dir, named))) ? named : models[0]
    if (main) return [{ folder: dir, modelPath: join(dir, main), asset }]
  }
  if (models.length === 1) return [{ folder: dir, modelPath: join(dir, models[0]), asset: null }]
  if (models.length > 1) return models.map((m) => ({ folder: null, modelPath: join(dir, m), asset: null }))
  if (depth >= 3) return []
  const subs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
  // 资产根目录（dark_dragon/ 下有 export/）
  if (subs.some((e) => e.name === 'export')) return folderSources(join(dir, 'export'), depth + 1)
  const out: Source[] = []
  for (const e of subs) {
    out.push(...(await folderSources(join(dir, e.name), depth + 1)))
    if (out.length >= MAX_SOURCES) break
  }
  return out
}

async function collectSources(input: string[]): Promise<{ sources: Source[]; skipped: Skip[] }> {
  const sources: Source[] = []
  const skipped: Skip[] = []
  for (const path of input) {
    let st
    try {
      st = await fs.stat(path)
    } catch {
      skipped.push({ path, reason: '找不到这个文件' })
      continue
    }
    if (st.isDirectory()) {
      const found = await folderSources(path, 0)
      if (found.length === 0) skipped.push({ path, reason: '文件夹里没有 .glb / .gltf 模型' })
      sources.push(...found)
    } else if (st.isFile() && isModelFile(path)) {
      // 模型旁边的 asset.json 写的就是它：按整个资产文件夹导入
      const dir = dirname(path)
      const asset = await readAssetJson(dir)
      if (asset && insideRel(dir, str(asset['file'])) === basename(path)) sources.push({ folder: dir, modelPath: path, asset })
      else sources.push({ folder: null, modelPath: path, asset: null })
    } else {
      skipped.push({ path, reason: '不是 .glb / .gltf 模型' })
    }
  }
  // 同一个文件夹 / 文件只导入一次
  const seen = new Set<string>()
  const unique = sources.filter((s) => {
    const key = s.folder ?? s.modelPath
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (unique.length > MAX_SOURCES) fail(`一次最多导入 ${MAX_SOURCES} 个模型`)
  return { sources: unique, skipped }
}

/** 文件夹总大小和文件数；超过上限时提前停 */
async function folderStats(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (bytes > MAX_FOLDER_BYTES || files > MAX_FOLDER_FILES) return
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        files++
        bytes += (await fs.stat(p)).size
      }
    }
  }
  await walk(dir)
  return { bytes, files }
}

/** 转成 id 能用的字符：字母、数字、_、- */
function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 48)
}

/** 资产文件夹的名字：export/ 用上一级的名字 */
function folderName(folder: string): string {
  const name = basename(folder)
  return name.toLowerCase() === 'export' ? basename(dirname(folder)) : name
}

const CATEGORY_WORDS: Array<[ModelCategory, RegExp]> = [
  ['载具', /vehicle|\bcar\b|truck|ship|boat|plane|aircraft|tank|载具|车|船|飞机/i],
  ['怪物', /creature|monster|enemy|boss|beast|dragon|怪|兽|龙/i],
  ['角色', /character|hero|npc|player|humanoid|avatar|角色|人物/i],
  ['道具', /prop|item|weapon|pickup|tool|道具|武器|物品/i],
  ['场景', /environment|scene|level|building|terrain|architecture|场景|建筑|地形/i]
]

/** 分类：asset.json 的 category 是中文分类就直接用；否则按 category、标签、名字里的词猜 */
function guessCategory(words: string[]): ModelCategory {
  for (const w of words) {
    if ((MODEL_CATEGORIES as readonly string[]).includes(w)) return w as ModelCategory
  }
  for (const w of words) {
    const hit = CATEGORY_WORDS.find(([, re]) => re.test(w))
    if (hit) return hit[0]
  }
  return '其他'
}

/** 没有 asset.json 时按名字判断是不是循环动作 */
const LOOP_NAME = /([_\-\s.]loop|[_\-\s.]cycle)$|^(idle|walk|run|fly|swim|breath)/i

/** 动作表：asset.json 的 animations 为主（顺序和显示名），模型文件里多出来的补在后面 */
function mergeAnimations(asset: AssetJson | null, info: GltfInfo): ModelAnimation[] {
  const clips = info.animations
  const out: ModelAnimation[] = []
  const used = new Set<string>()
  const list = asset && Array.isArray(asset['animations']) ? asset['animations'] : []
  for (const raw of list) {
    const a = obj(raw)
    const name = str(a['name'])
    const inFile = str(a['name_in_glb']) || str(a['clip']) || name
    if (!name && !inFile) continue
    const clip = clips.find((c) => c.name === inFile) ?? clips.find((c) => c.name === name)
    if (clip) used.add(clip.name)
    out.push({
      name: name || inFile,
      clip: clip?.name ?? inFile,
      seconds: num(a['seconds']) || clip?.seconds || 0,
      loop: typeof a['loop'] === 'boolean' ? a['loop'] : LOOP_NAME.test(inFile)
    })
  }
  for (const c of clips) {
    if (used.has(c.name)) continue
    out.push({
      name: c.name.replace(/[_\-\s.](loop|cycle)$/i, '') || c.name,
      clip: c.name,
      seconds: c.seconds,
      loop: LOOP_NAME.test(c.name)
    })
  }
  return out
}

function sizeOf(asset: AssetJson | null, info: GltfInfo): [number, number, number] | null {
  const v = obj(asset?.['bounds_m'])['size_xyz']
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    return [v[0], v[1], v[2]] as [number, number, number]
  }
  return info.size
}

function sourceText(asset: AssetJson | null): string {
  const src = obj(asset?.['source'])
  return [str(src['how_made']) || str(asset?.['source']), str(src['license'])].filter(Boolean).join(' · ')
}

/** 模型文件夹里的预览图：asset.json 写的，或常见文件名 */
async function findPreview(dir: string, asset: AssetJson | null): Promise<string | null> {
  const named = insideRel(dir, str(asset?.['preview']))
  if (named && (await isFile(join(dir, named)))) return named
  for (const n of PREVIEW_NAMES) if (await isFile(join(dir, n))) return n
  return null
}

/** 新模型的 id：资产 id、文件夹名或文件名，转成安全字符；都不行就随机；重名加 _2、_3 */
async function pickId(src: Source, taken: Set<string>): Promise<string> {
  const names = [
    str(src.asset?.['id']),
    src.folder ? folderName(src.folder) : '',
    basename(src.modelPath, extname(src.modelPath))
  ]
  let base = names.map(slug).find((s) => s.length >= 2) ?? ''
  if (!base) base = `model_${newId().slice(0, 6)}`
  const free = async (id: string): Promise<boolean> => !taken.has(id) && !(await exists(join(paths.libModelsDir(), id)))
  let id = base
  for (let n = 2; !(await free(id)); n++) id = `${base}_${n}`
  return id
}

/** 把一个模型拷进库里的临时文件夹，再改名为 <id>，失败时清掉 */
async function copyIn(src: Source, info: GltfInfo, id: string): Promise<void> {
  const tmp = join(paths.libModelsDir(), `.incoming-${newId()}`)
  try {
    if (src.folder) {
      await fs.cp(src.folder, tmp, {
        recursive: true,
        mode: fsConstants.COPYFILE_FICLONE,
        filter: (p) => basename(p) !== '.DS_Store'
      })
    } else {
      // 单独的模型文件：连同 .gltf 引用的外部文件（.bin、贴图）一起拷，保持相对路径
      const dir = dirname(src.modelPath)
      await fs.mkdir(tmp, { recursive: true })
      await fs.copyFile(src.modelPath, join(tmp, basename(src.modelPath)), fsConstants.COPYFILE_FICLONE)
      for (const res of info.resources) {
        const rel = insideRel(dir, res)
        if (!rel) continue
        try {
          await fs.mkdir(dirname(join(tmp, rel)), { recursive: true })
          await fs.copyFile(join(dir, rel), join(tmp, rel), fsConstants.COPYFILE_FICLONE)
        } catch {
          // 缺的外部文件不影响导入，查看时贴图会缺
        }
      }
    }
    await fs.rename(tmp, join(paths.libModelsDir(), id))
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true })
    throw err
  }
}

/** 读取模型并生成记录（还没拷贝） */
async function prepare(src: Source): Promise<{ buf: Buffer; info: GltfInfo }> {
  const st = await fs.stat(src.modelPath)
  if (st.size > 2 * 1024 ** 3) fail('模型文件太大了（超过 2 GB）')
  const buf = await fs.readFile(src.modelPath)
  const info = await parseGltf(buf, { baseDir: dirname(src.modelPath) })
  if (src.folder) {
    const stats = await folderStats(src.folder)
    if (stats.bytes > MAX_FOLDER_BYTES || stats.files > MAX_FOLDER_FILES) {
      fail(`文件夹太大了（超过 2 GB 或 ${MAX_FOLDER_FILES} 个文件），请只拖入模型的 export 文件夹`)
    }
  }
  return { buf, info }
}

function makeRecord(src: Source, info: GltfInfo, id: string, preview: string | null, stats: { bytes: number; files: number }): LibModel {
  const asset = src.asset
  const mesh = obj(asset?.['mesh'])
  const skeleton = obj(asset?.['skeleton'])
  const rawTags = asset?.['tags']
  const assetTags = Array.isArray(rawTags) ? rawTags.map(str).filter(Boolean) : []
  const fileBase = basename(src.modelPath, extname(src.modelPath))
  const name = str(asset?.['name']) || (src.folder ? folderName(src.folder) : '') || fileBase || '未命名模型'
  const file = src.folder ? relative(src.folder, src.modelPath).split(sep).join('/') : basename(src.modelPath)
  return {
    id,
    name: name.slice(0, 200),
    file,
    preview,
    rendered: false,
    category: guessCategory([str(asset?.['category']), ...assetTags, name, fileBase]),
    tags: [...new Set(assetTags)].slice(0, 30).map((t) => t.slice(0, 60)),
    version: str(asset?.['version']).slice(0, 40),
    format: info.format,
    size: sizeOf(asset, info),
    triangles: num(mesh['triangles']) || info.triangles,
    vertices: num(mesh['vertices']) || info.vertices,
    bones: num(skeleton['bone_count']) || info.bones,
    animations: mergeAnimations(asset, info),
    sockets: Object.keys(obj(asset?.['sockets'])).slice(0, 100),
    hasAssetJson: asset !== null,
    source: sourceText(asset).slice(0, 1000),
    importedFrom: src.folder ?? src.modelPath,
    bytes: stats.bytes,
    fileCount: stats.files,
    addedAt: nowIso()
  }
}

/** 导入模型（加锁）：按模型文件内容去重，新的排在最前 */
export async function importModels(input: string[]): Promise<ModelImportResult> {
  const { sources, skipped } = await collectSources(input)
  if (sources.length === 0) return { added: [], existing: [], skipped }
  return withLock(paths.libModels(), async () => {
    const list = await listModels()
    const hashes = await readJson<Record<string, string>>(paths.libModelHashes(), {})
    const byHash = new Map<string, LibModel>()
    for (const m of list) {
      const h = hashes[m.id]
      if (h && !byHash.has(h)) byHash.set(h, m)
    }
    const taken = new Set(list.map((m) => m.id))
    const added: LibModel[] = []
    const existing: LibModel[] = []
    for (const src of sources) {
      try {
        const { buf, info } = await prepare(src)
        const hash = sha256(buf)
        const known = byHash.get(hash)
        if (known) {
          if (!existing.includes(known) && !added.includes(known)) existing.push(known)
          continue
        }
        const id = await pickId(src, taken)
        taken.add(id)
        await copyIn(src, info, id)
        const dir = join(paths.libModelsDir(), id)
        const model = makeRecord(src, info, id, await findPreview(dir, src.asset), await folderStats(dir))
        hashes[id] = hash
        byHash.set(hash, model)
        added.push(model)
      } catch (err) {
        skipped.push({ path: src.folder ?? src.modelPath, reason: err instanceof Error ? err.message : String(err) })
      }
    }
    if (added.length) {
      await writeJson(paths.libModels(), [...added, ...list])
      await writeJson(paths.libModelHashes(), hashes)
    }
    return { added, existing, skipped }
  })
}
