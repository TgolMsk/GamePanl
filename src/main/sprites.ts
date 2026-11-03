// 序列帧角色的存储：projects/<id>/sprites/<角色 id>/character.json（全局库在 library/sprites/<角色 id>/），
// 源视频拷进同目录的 videos/。
// 源视频拷一份进工作台：「下载」里的原文件被清理掉以后，照样能重新调整、重新导出。
import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import {
  actionNameFromFile,
  DEFAULT_FRAME_SETUP,
  DEFAULT_SPRITE_PARAMS,
  DEFAULT_SPRITE_SETTINGS,
  defaultGroupName,
  detectActionName,
  fileNameTokens,
  isDirectionWord,
  SPRITE_ASPECTS,
  SPRITE_FACING_LABELS,
  SPRITE_REF_EXTENSIONS,
  SPRITE_SCREENS,
  SPRITE_STANDARD_GROUPS,
  SPRITE_TEMPLATES,
  SPRITE_VIDEO_EXTENSIONS,
  stripCopySuffix,
  type SpriteAction,
  type SpriteActionParams,
  safeFileName,
  type SpriteCharacter,
  type SpriteExportAction,
  type SpriteExportBundle,
  type SpriteExportPrefs,
  type SpriteExportResult,
  type SpriteAspect,
  type SpriteFacing,
  type SpriteFrameEdit,
  type SpriteFrameSetup,
  type SpriteGroup,
  type SpriteOwner,
  type SpriteRef,
  type SpriteScreen,
  type SpriteSettings,
  type SpriteTake,
  type SpriteTakeVia,
  type SpriteView
} from '@shared/sprites'
import type { ID, LibAsset2D } from '@shared/types'
import { asset2dDir, saveSpriteAsset } from './assets2d'
import { candidateFromFile, imageInfo, type Candidate } from './images'
import { addLibraryImages, deleteImage, listStyles } from './library'
import { addProjectAssets, deleteAsset, getProject } from './projects'
import { actionPreviewGif, composeAtlas, encodePng, writeSpriteExport } from './spriteExport'
import { exists, isNotFound, newId, nowIso, paths, readJson, trash, withLock, writeJson } from './storage'
import { asBoolean, asId, asLine, asObject, asString, fail, has, isSafeId } from './validate'

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024

export const spritePaths = {
  root: (owner: SpriteOwner) => (owner === null ? paths.libSprites() : join(paths.project(owner), 'sprites')),
  dir: (owner: SpriteOwner, id: ID) => join(spritePaths.root(owner), asId(id, '角色 id')),
  file: (owner: SpriteOwner, id: ID) => join(spritePaths.dir(owner, id), 'character.json'),
  videos: (owner: SpriteOwner, id: ID) => join(spritePaths.dir(owner, id), 'videos'),
  refs: (owner: SpriteOwner, id: ID) => join(spritePaths.dir(owner, id), 'refs')
}

export function isVideoFile(path: string): boolean {
  return SPRITE_VIDEO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())
}

// ---------- 读取 ----------

async function readCharacter(owner: SpriteOwner, id: ID): Promise<SpriteCharacter | null> {
  const raw = await readJson<unknown>(spritePaths.file(owner, id), null)
  if (!raw || typeof raw !== 'object') return null
  return normalizeCharacter(raw as Record<string, unknown>, id)
}

export async function listCharacters(owner: SpriteOwner): Promise<SpriteCharacter[]> {
  let names: string[]
  try {
    names = await fs.readdir(spritePaths.root(owner))
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const out: SpriteCharacter[] = []
  for (const name of names) {
    if (!isSafeId(name)) continue
    try {
      const c = await readCharacter(owner, name)
      if (c) out.push(c)
    } catch (err) {
      console.error(`[sprites] 跳过无法读取的角色 ${name}:`, err)
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

export async function getCharacter(owner: SpriteOwner, id: ID): Promise<SpriteCharacter> {
  const c = await readCharacter(owner, id)
  if (!c) fail('角色不存在')
  return c
}

export async function countCharacters(owner: SpriteOwner): Promise<number> {
  try {
    const names = await fs.readdir(spritePaths.root(owner))
    let n = 0
    for (const name of names) if (isSafeId(name) && (await exists(spritePaths.file(owner, name)))) n++
    return n
  } catch {
    return 0
  }
}

/** 动作的源视频文件 */
export async function videoPath(owner: SpriteOwner, id: ID, actionId: ID, takeId: ID | null = null): Promise<string | null> {
  const c = await readCharacter(owner, id)
  const a = c?.actions.find((x) => x.id === actionId)
  const video = takeId === null ? a?.video : a?.takes.find((t) => t.id === takeId)?.video
  if (!video || !isSafeVideoName(video)) return null
  return join(spritePaths.videos(owner, id), video)
}

function isSafeVideoName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{2,4}$/.test(name)
}

const isSafeRefName = isSafeVideoName

function asText(v: unknown, label: string, max: number): string {
  return asString(v, label, max).trim()
}

function asView(v: unknown): SpriteView {
  if (v !== 'side' && v !== 'topdown' && v !== 'front') fail('视角不对')
  return v
}

function asFacing(v: unknown): SpriteFacing {
  if (typeof v !== 'string' || !(v in SPRITE_FACING_LABELS)) fail('定妆照朝向不对')
  return v as SpriteFacing
}

function normalizeFrameSetup(raw: Record<string, unknown>): SpriteFrameSetup {
  const aspect = typeof raw['aspect'] === 'string' && raw['aspect'] in SPRITE_ASPECTS ? (raw['aspect'] as SpriteAspect) : DEFAULT_FRAME_SETUP.aspect
  const screen = typeof raw['screen'] === 'string' && raw['screen'] in SPRITE_SCREENS ? (raw['screen'] as SpriteScreen) : DEFAULT_FRAME_SETUP.screen
  const fill = typeof raw['fill'] === 'number' && Number.isFinite(raw['fill']) ? Math.min(0.8, Math.max(0.4, Math.round(raw['fill'] * 100) / 100)) : DEFAULT_FRAME_SETUP.fill
  return { aspect, fill, screen }
}

// ---------- 导入 ----------

/** 从文件名里去掉动作词、方向词和平台前缀，剩下的当角色名 */
const GENERIC = /^(wan\d*(\.\d+)?|kling|hailuo|vidu|seedance|jimeng|runway|veo\d*|sora|pika|ai|gen|video|image|output|final|clip|take\d*|v\d+|\d+)$/i

function nameTokens(file: string): string[] {
  return fileNameTokens(basename(file)).filter((t) => !GENERIC.test(t) && !isDirectionWord(t) && detectActionName(t) === null)
}

/** 几个文件共同的角色名；没有共同部分时返回 null */
export function inferCharacterName(files: string[]): string | null {
  const lists = files.map(nameTokens)
  if (lists.length === 0) return null
  const common = lists[0].filter((t) => lists.every((l) => l.some((x) => x.toLowerCase() === t.toLowerCase())))
  const name = common.join('_')
  return name || null
}

function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name
  for (let i = 2; ; i++) {
    const n = `${name}_${i}`
    if (!taken.includes(n)) return n
  }
}

export function isRefImage(path: string): boolean {
  return SPRITE_REF_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())
}

/** 版本的来历：提示词、来源；sourceName 不给时用原文件名 */
export interface TakeOrigin {
  prompt: string
  via: SpriteTakeVia
  sourceName?: string
}

const FROM_FILE: TakeOrigin = { prompt: '', via: 'file' }

async function copyVideo(owner: SpriteOwner, charId: ID, file: string, origin: TakeOrigin = FROM_FILE): Promise<SpriteTake> {
  const st = await fs.stat(file)
  if (!st.isFile()) fail(`不是文件：${basename(file)}`)
  if (st.size > MAX_VIDEO_BYTES) fail(`视频太大了（超过 1 GB）：${basename(file)}`)
  const id = newId()
  const ext = extname(file).slice(1).toLowerCase()
  const video = `${id}.${ext}`
  const dir = spritePaths.videos(owner, charId)
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(file, join(dir, video))
  return {
    id,
    video,
    sourceName: origin.sourceName ?? basename(file),
    bytes: st.size,
    start: null,
    end: null,
    edits: [],
    prompt: origin.prompt.slice(0, 8000),
    via: origin.via,
    addedAt: nowIso()
  }
}

function newAction(name: string, group: ID | null, brief = ''): SpriteAction {
  return {
    id: newId(),
    name,
    group,
    brief,
    video: '',
    sourceName: '',
    bytes: 0,
    takes: [],
    params: { ...DEFAULT_SPRITE_PARAMS },
    edits: [],
    asset2dId: null,
    addedAt: nowIso()
  }
}

/** 换成另一个视频版本：当前版本的片段起止和换帧记录先存回它自己 */
function activateTake(a: SpriteAction, take: SpriteTake): void {
  const cur = a.takes.find((t) => t.video === a.video)
  if (cur && cur !== take) {
    cur.start = a.params.start
    cur.end = a.params.end
    cur.edits = a.edits
  }
  a.video = take.video
  a.sourceName = take.sourceName
  a.bytes = take.bytes
  a.params = { ...a.params, start: take.start, end: take.end }
  a.edits = take.edits
}

/** 按名字找分组，没有就建一个（标准分组按 移动 → 攻击 → 受击 → 交互 → 其他 的顺序插进去） */
function ensureGroup(c: SpriteCharacter, name: string): ID {
  const found = c.groups.find((g) => g.name.toLowerCase() === name.toLowerCase())
  if (found) return found.id
  const g: SpriteGroup = { id: newId(), name }
  const rank = (n: string): number => {
    const k = (SPRITE_STANDARD_GROUPS as readonly string[]).indexOf(n)
    return k < 0 ? 1e9 : k
  }
  const at = c.groups.findIndex((x) => rank(x.name) > rank(name) && rank(x.name) < 1e9)
  if (at < 0 || rank(name) >= 1e9) c.groups.push(g)
  else c.groups.splice(at, 0, g)
  return g.id
}

/** 同一个角色里已经导入过的视频（同文件名、同大小）不重复导入；浏览器重复下载加的「 (1)」不算不同 */
function alreadyHas(c: SpriteCharacter, name: string, bytes: number): SpriteAction | undefined {
  const n = stripCopySuffix(name)
  return c.actions.find((a) => a.takes.some((t) => t.bytes === bytes && stripCopySuffix(t.sourceName) === n))
}

export type Skipped = Array<{ path: string; reason: string }>

/** 一个视频放到了哪：new 新动作；filled 补上了待生成的动作；take 已有动作的新版本 */
export interface Placed {
  characterId: ID
  actionId: ID
  action: string
  how: 'new' | 'filled' | 'take'
}

/**
 * 把视频放进角色（改的是传进来的 c，调用方负责存）：
 * 文件名对上已有动作名（含待生成）的放进那个动作——待生成的补上视频，已有视频的加成新版本并切到新版本；
 * 对不上的：只有一个且指定了 target 动作时放进 target，否则按文件名新建动作（自动归组）。
 */
async function placeVideos(owner: SpriteOwner, c: SpriteCharacter, files: string[], target: ID | null, skipped: Skipped): Promise<Placed[]> {
  const placed: Placed[] = []
  const put = async (a: SpriteAction, f: string, isNew: boolean): Promise<void> => {
    const take = await copyVideo(owner, c.id, f)
    const how: Placed['how'] = isNew ? 'new' : a.video ? 'take' : 'filled'
    a.takes.push(take)
    activateTake(a, take)
    placed.push({ characterId: c.id, actionId: a.id, action: a.name, how })
  }
  const unmatched: string[] = []
  for (const f of files) {
    try {
      const st = await fs.stat(f)
      const dup = alreadyHas(c, basename(f), st.size)
      if (dup) {
        skipped.push({ path: f, reason: `「${c.name}」的「${dup.name}」里已经有这个视频了` })
        continue
      }
      const name = actionNameFromFile(basename(f), c.actions.map((a) => a.name))
      const same = name ? c.actions.find((a) => a.name.toLowerCase() === name.toLowerCase()) : undefined
      if (same) await put(same, f, false)
      else if (name) {
        const a = newAction(name, ensureGroup(c, defaultGroupName(name)))
        c.actions.push(a)
        await put(a, f, true)
      } else unmatched.push(f)
    } catch (err) {
      skipped.push({ path: f, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  const t = target ? c.actions.find((a) => a.id === target) : undefined
  for (const f of unmatched) {
    try {
      if (t && unmatched.length === 1) await put(t, f, false)
      else {
        const stem = basename(f, extname(f)).slice(0, 40) || '动作'
        const a = newAction(uniqueName(stem, c.actions.map((x) => x.name)), ensureGroup(c, '其他'))
        c.actions.push(a)
        await put(a, f, true)
      }
    } catch (err) {
      skipped.push({ path: f, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return placed
}

/** 一张图写进 refs/（同名、同大小的不重复，返回 null）；还没有主图时它当主图 */
async function placeRefCandidate(owner: SpriteOwner, c: SpriteCharacter, cand: Candidate): Promise<SpriteRef | null> {
  if (c.refs.some((r) => r.name === cand.name.slice(0, 80) && r.bytes === cand.buf.length)) return null
  const id = newId()
  const file = `${id}.${cand.info.ext}`
  const dir = spritePaths.refs(owner, c.id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, file), cand.buf)
  const ref: SpriteRef = { id, file, name: cand.name.slice(0, 80), width: cand.info.width, height: cand.info.height, bytes: cand.buf.length, facing: null, from: null, addedAt: nowIso() }
  c.refs.push(ref)
  if (!c.mainRef) c.mainRef = ref.id
  return ref
}

/** 人物素材拷进 refs/（同文件名、同大小的不重复）；还没有主图时第一张当主图 */
async function placeRefs(owner: SpriteOwner, c: SpriteCharacter, files: string[], skipped: Skipped): Promise<SpriteRef[]> {
  const added: SpriteRef[] = []
  for (const f of files) {
    const cand = await candidateFromFile(f)
    if (!cand || !SPRITE_REF_EXTENSIONS.includes(cand.info.ext)) {
      skipped.push({ path: f, reason: '不是图片（只支持 PNG、JPG、WebP）' })
      continue
    }
    const ref = await placeRefCandidate(owner, c, cand)
    if (ref) added.push(ref)
    else skipped.push({ path: f, reason: `「${c.name}」的人物素材里已经有这张图了` })
  }
  if (!c.mainRef && c.refs.length) c.mainRef = c.refs[0].id
  return added
}

async function folderFiles(dir: string): Promise<{ videos: string[]; images: string[] }> {
  const names = (await fs.readdir(dir))
    .filter((n) => !n.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
    .map((n) => join(dir, n))
  return { videos: names.filter(isVideoFile), images: names.filter(isRefImage) }
}

/** 路径分成：文件夹（各自的视频和图片）、零散视频、零散图片；其他的记进 skipped */
async function sortInputs(inputs: string[], skipped: Skipped): Promise<{ folders: Array<{ name: string; videos: string[]; images: string[] }>; videos: string[]; images: string[] }> {
  const folders: Array<{ name: string; videos: string[]; images: string[] }> = []
  const videos: string[] = []
  const images: string[] = []
  for (const p of inputs) {
    let st
    try {
      st = await fs.stat(p)
    } catch {
      skipped.push({ path: p, reason: '找不到这个文件' })
      continue
    }
    if (st.isDirectory()) {
      const f = await folderFiles(p)
      if (f.videos.length + f.images.length === 0) skipped.push({ path: p, reason: '文件夹里没有视频（mp4 / mov）或人物图' })
      else folders.push({ name: basename(p), ...f })
    } else if (isVideoFile(p)) videos.push(p)
    else if (isRefImage(p)) images.push(p)
    else skipped.push({ path: p, reason: '只支持视频（mp4 / mov）和人物图（PNG / JPG / WebP）' })
  }
  return { folders, videos, images }
}

export interface ImportResult {
  created: SpriteCharacter[]
  /** 加进了已有角色（同名、或拖进当前角色） */
  merged: SpriteCharacter[]
  placed: Placed[]
  refs: number
  skipped: Skipped
}

export interface ImportTarget {
  id: ID
  actionId: ID | null
}

function blankCharacter(id: ID, name: string, height?: number): SpriteCharacter {
  const now = nowIso()
  return {
    id,
    name,
    settings: { ...DEFAULT_SPRITE_SETTINGS, ...(height ? { height: clampInt(height, 8, 512) } : {}) },
    refs: [],
    mainRef: null,
    description: '',
    view: 'side',
    promptExtra: '',
    frameSetup: { ...DEFAULT_FRAME_SETUP },
    groups: [],
    actions: [],
    exportPrefs: { dir: null, godotPrefix: null, updateAssets: true, toAssets2D: true, assets2dMode: 'character', skip: [], scale: 1, lastExportAt: null },
    assetIds: [],
    asset2dId: null,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 导入视频和人物图。每个文件夹是一个角色（视频是动作、图片是人物素材）。
 * 零散文件：给了 target（界面上选中的角色）时加进它，除非文件名正好是另一个已有角色的名字；
 * 没给 target 时算作一个角色。和已有角色同名时加进那个角色，导入过的跳过。height 是新角色的默认像素身高。
 */
export async function importFiles(owner: SpriteOwner, inputs: string[], opts: { height?: number; target?: ImportTarget | null } = {}): Promise<ImportResult> {
  const skipped: Skipped = []
  const { folders, videos, images } = await sortInputs(inputs, skipped)
  const existing = await listCharacters(owner)
  const jobs: Array<{ name: string | null; into: ID | null; videos: string[]; images: string[]; target: ID | null }> = []
  for (const f of folders) {
    const same = existing.find((c) => c.name.toLowerCase() === f.name.trim().toLowerCase())
    jobs.push({ name: f.name, into: same?.id ?? null, videos: f.videos, images: f.images, target: null })
  }
  if (videos.length + images.length) {
    const inferred = inferCharacterName([...videos, ...images])
    const same = inferred ? existing.find((c) => c.name.toLowerCase() === inferred.toLowerCase()) : undefined
    const into = same?.id ?? (opts.target && existing.some((c) => c.id === opts.target?.id) ? opts.target.id : null)
    const fallback = basename(dirname((videos[0] ?? images[0]) as string))
    jobs.push({ name: inferred ?? fallback, into, videos, images, target: into && into === opts.target?.id ? opts.target.actionId : null })
  }
  const created: SpriteCharacter[] = []
  const merged: SpriteCharacter[] = []
  const placed: Placed[] = []
  let refs = 0
  const takenNames = existing.map((c) => c.name)
  for (const job of jobs) {
    if (job.into) {
      const before = placed.length + refs
      const c = await mutate(owner, job.into, async (ch) => {
        refs += (await placeRefs(owner, ch, job.images, skipped)).length
        placed.push(...(await placeVideos(owner, ch, job.videos, job.target, skipped)))
      })
      if (placed.length + refs > before) merged.push(c)
      continue
    }
    const id = newId()
    const name = uniqueName((job.name ?? '').trim() || `角色 ${existing.length + created.length + 1}`, takenNames)
    const c = blankCharacter(id, name, opts.height)
    const r = (await placeRefs(owner, c, job.images, skipped)).length
    const p = await placeVideos(owner, c, job.videos, null, skipped)
    if (r + p.length === 0) {
      await fs.rm(spritePaths.dir(owner, id), { recursive: true, force: true })
      continue
    }
    takenNames.push(name)
    refs += r
    placed.push(...p)
    await writeJson(spritePaths.file(owner, id), c)
    created.push(c)
  }
  return { created, merged, placed, refs, skipped }
}

/** 给已有角色添加：视频按文件名归到动作，图片进人物素材；文件夹里的视频和图片一起加。actionId 是界面上选中的动作 */
export async function addToCharacter(owner: SpriteOwner, id: ID, inputs: string[], actionId: ID | null = null): Promise<{ character: SpriteCharacter; placed: Placed[]; refs: number; skipped: Skipped }> {
  const skipped: Skipped = []
  const { folders, videos, images } = await sortInputs(inputs, skipped)
  const allVideos = [...videos, ...folders.flatMap((f) => f.videos)]
  const allImages = [...images, ...folders.flatMap((f) => f.images)]
  let placed: Placed[] = []
  let refs = 0
  const character = await mutate(owner, id, async (c) => {
    refs = (await placeRefs(owner, c, allImages, skipped)).length
    placed = await placeVideos(owner, c, allVideos, actionId, skipped)
  })
  return { character, placed, refs, skipped }
}

/** 从 2D 资产新建角色：资产里的图片当人物素材（预览图当主图），导出时回写这个资产 */
export async function createFromImages(owner: SpriteOwner, name: string, images: string[], asset2dId: ID | null, height?: number): Promise<SpriteCharacter> {
  const existing = await listCharacters(owner)
  const id = newId()
  const c = blankCharacter(id, uniqueName(name.trim() || '角色', existing.map((x) => x.name)), height)
  c.asset2dId = asset2dId
  const skipped: Skipped = []
  await placeRefs(owner, c, images, skipped)
  if (c.refs.length === 0) {
    await fs.rm(spritePaths.dir(owner, id), { recursive: true, force: true })
    fail(skipped[0]?.reason ?? '没有可用的人物图')
  }
  await writeJson(spritePaths.file(owner, id), c)
  return c
}

/** 项目里新建角色的默认像素身高：项目配置的角色尺寸（高）；全局库用内置默认 */
export async function defaultHeight(owner: SpriteOwner): Promise<number | undefined> {
  if (owner === null) return undefined
  const h = (await getProject(owner)).sizes?.character?.h
  return typeof h === 'number' && Number.isFinite(h) && h >= 8 ? Math.min(512, Math.round(h)) : undefined
}

/** 项目选的美术风格的生图提示词（写进设定图提示词）；全局库或没选风格时为空 */
export async function stylePrompt(owner: SpriteOwner): Promise<string> {
  if (owner === null) return ''
  const p = await getProject(owner)
  if (!p.styleId) return ''
  const s = (await listStyles()).find((x) => x.id === p.styleId)
  return s ? s.prompt.trim() || s.desc.trim() : ''
}

/** 新建空角色：先写描述、复制设定图提示词去画，人物图和视频之后再加 */
export async function createBlank(owner: SpriteOwner, rawName: unknown, height?: number): Promise<SpriteCharacter> {
  const existing = await listCharacters(owner)
  const name = rawName === undefined || rawName === null ? '' : asLine(rawName, '角色名', 80).trim()
  const c = blankCharacter(newId(), uniqueName(name || `角色 ${existing.length + 1}`, existing.map((x) => x.name)), height)
  await writeJson(spritePaths.file(owner, c.id), c)
  return c
}

/** 一张图（粘贴的、生成的）加进人物素材；id 为 null 时用它新建角色。已经有同一张图时 added 为 0 */
export async function addRefImage(owner: SpriteOwner, id: ID | null, cand: Candidate, height?: number): Promise<{ character: SpriteCharacter; ref: SpriteRef | null }> {
  if (!SPRITE_REF_EXTENSIONS.includes(cand.info.ext)) fail('不是图片（只支持 PNG、JPG、WebP）')
  if (id === null) {
    const c = await createBlank(owner, null, height)
    const ref = await placeRefCandidate(owner, c, cand)
    await writeJson(spritePaths.file(owner, c.id), c)
    return { character: c, ref }
  }
  let ref: SpriteRef | null = null
  const character = await mutate(owner, id, async (c) => {
    ref = await placeRefCandidate(owner, c, cand)
  })
  return { character, ref }
}

/**
 * 视频文件加成动作的一个新版本（从「下载」收件、软件里生成）。
 * 动作还没有视频、或 activate 时切到这个版本。同一个视频已经收过时返回 null。
 */
export async function addTakeFile(owner: SpriteOwner, id: ID, actionId: ID, file: string, origin: TakeOrigin, activate: boolean): Promise<{ character: SpriteCharacter; action: SpriteAction; take: SpriteTake } | null> {
  let hit: { action: SpriteAction; take: SpriteTake } | null = null
  const character = await mutate(owner, id, async (c) => {
    const a = c.actions.find((x) => x.id === actionId)
    if (!a) fail('动作不存在了')
    const st = await fs.stat(file)
    if (alreadyHas(c, origin.sourceName ?? basename(file), st.size)) return
    const take = await copyVideo(owner, c.id, file, origin)
    a.takes.push(take)
    if (activate || !a.video) activateTake(a, take)
    hit = { action: a, take }
  })
  const r = hit as { action: SpriteAction; take: SpriteTake } | null
  return r ? { character, ...r } : null
}

/** 照搬另一个角色的动作清单：分组、动作名、动作说明、循环 / 单次（视频不搬），视角也照搬；已有的同名动作只补分组和说明 */
export async function applyActionList(owner: SpriteOwner, id: ID, fromOwner: SpriteOwner, fromId: ID): Promise<SpriteCharacter> {
  if (owner === fromOwner && id === fromId) fail('选的是同一个角色')
  const src = await getCharacter(fromOwner, fromId)
  if (src.actions.length === 0) fail(`「${src.name}」还没有动作`)
  return mutate(owner, id, (c) => {
    c.view = src.view
    for (const g of src.groups) ensureGroup(c, g.name)
    for (const sa of src.actions) {
      const gName = src.groups.find((g) => g.id === sa.group)?.name
      const group = gName ? ensureGroup(c, gName) : null
      const same = c.actions.find((a) => a.name.toLowerCase() === sa.name.toLowerCase())
      if (same) {
        if (!same.group) same.group = group
        if (!same.brief) same.brief = sa.brief
        if (same.params.kind === 'auto') same.params.kind = sa.params.kind
        continue
      }
      const a = newAction(sa.name, group, sa.brief)
      a.params.kind = sa.params.kind
      c.actions.push(a)
    }
  })
}

// ---------- 修改 ----------

function mutate(owner: SpriteOwner, id: ID, fn: (c: SpriteCharacter) => void | Promise<void>): Promise<SpriteCharacter> {
  const file = spritePaths.file(owner, id)
  return withLock(file, async () => {
    const c = await readCharacter(owner, id)
    if (!c) fail('角色不存在')
    await fn(c)
    c.updatedAt = nowIso()
    await writeJson(file, c)
    return c
  })
}

function normalizeGroups(v: unknown): SpriteGroup[] {
  if (!Array.isArray(v)) fail('分组必须是数组')
  const out: SpriteGroup[] = []
  for (const x of v.slice(0, 50)) {
    const o = asObject(x, '分组')
    const id = isSafeId(o['id']) ? (o['id'] as string) : newId()
    const name = typeof o['name'] === 'string' ? o['name'].trim().slice(0, 40) : ''
    if (!name || out.some((g) => g.id === id || g.name.toLowerCase() === name.toLowerCase())) continue
    out.push({ id, name })
  }
  return out
}

export function updateCharacter(owner: SpriteOwner, id: ID, patch: unknown): Promise<SpriteCharacter> {
  const p = asObject(patch, '角色修改')
  return mutate(owner, id, (c) => {
    if (has(p, 'name')) {
      const name = asLine(p['name'], '角色名', 80).trim()
      if (!name) fail('角色名不能为空')
      c.name = name
    }
    if (has(p, 'settings')) c.settings = normalizeSettings({ ...c.settings, ...asObject(p['settings'], '输出设置') })
    if (has(p, 'exportPrefs')) c.exportPrefs = normalizeExportPrefs({ ...c.exportPrefs, ...asObject(p['exportPrefs'], '导出设置') })
    if (has(p, 'mainRef')) {
      const ref = p['mainRef']
      if (ref !== null && !c.refs.some((r) => r.id === ref)) fail('这张人物图不存在了')
      c.mainRef = ref as ID | null
    }
    if (has(p, 'description')) c.description = asText(p['description'], '人物描述', 2000)
    if (has(p, 'promptExtra')) c.promptExtra = asText(p['promptExtra'], '补充要求', 2000)
    if (has(p, 'view')) c.view = asView(p['view'])
    if (has(p, 'frameSetup')) c.frameSetup = normalizeFrameSetup({ ...c.frameSetup, ...asObject(p['frameSetup'], '首帧图设置') })
    if (has(p, 'groups')) {
      c.groups = normalizeGroups(p['groups'])
      for (const a of c.actions) if (a.group && !c.groups.some((g) => g.id === a.group)) a.group = null
    }
  })
}

export function updateAction(owner: SpriteOwner, id: ID, actionId: ID, patch: unknown): Promise<SpriteCharacter> {
  const p = asObject(patch, '动作修改')
  return mutate(owner, id, (c) => {
    const a = c.actions.find((x) => x.id === actionId)
    if (!a) fail('动作不存在')
    if (has(p, 'name')) {
      const name = asLine(p['name'], '动作名', 40).trim()
      if (!name) fail('动作名不能为空')
      if (c.actions.some((x) => x !== a && x.name.toLowerCase() === name.toLowerCase())) fail(`已经有叫「${name}」的动作了`)
      a.name = name
    }
    if (has(p, 'params')) a.params = normalizeParams({ ...a.params, ...asObject(p['params'], '动作参数') })
    if (has(p, 'edits')) a.edits = normalizeEdits(p['edits'])
    if (has(p, 'brief')) a.brief = asText(p['brief'], '动作说明', 500)
    if (has(p, 'group')) {
      const g = p['group']
      if (g !== null && !c.groups.some((x) => x.id === g)) fail('分组不存在了')
      a.group = g as ID | null
    }
  })
}

/** 把一组参数应用到全部动作（片段起止、循环 / 单次、单独设的像素身高和颜色数、换帧记录除外） */
export function applyParamsToAll(owner: SpriteOwner, id: ID, params: unknown): Promise<SpriteCharacter> {
  const src = normalizeParams(asObject(params, '动作参数'))
  return mutate(owner, id, (c) => {
    for (const a of c.actions) {
      a.params = { ...src, start: a.params.start, end: a.params.end, kind: a.params.kind, height: a.params.height, colors: a.params.colors }
    }
  })
}

export function reorderActions(owner: SpriteOwner, id: ID, order: ID[]): Promise<SpriteCharacter> {
  return mutate(owner, id, (c) => {
    const rank = new Map(order.map((x, i) => [x, i]))
    c.actions.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9))
  })
}

/** 新建待生成的动作（还没有视频，先列在清单里） */
export function addPlanned(owner: SpriteOwner, id: ID, names: unknown, group: unknown): Promise<SpriteCharacter> {
  if (!Array.isArray(names)) fail('动作名必须是数组')
  return mutate(owner, id, (c) => {
    if (group !== null && !c.groups.some((g) => g.id === group)) fail('分组不存在了')
    for (const raw of names.slice(0, 100)) {
      const name = asLine(raw, '动作名', 40).trim()
      if (!name || c.actions.some((a) => a.name.toLowerCase() === name.toLowerCase())) continue
      c.actions.push(newAction(name, (group as ID | null) ?? ensureGroup(c, defaultGroupName(name))))
    }
  })
}

/** 套用动作清单模板：补上分组和还没有的动作（待生成）；已有的同名动作没分组时归进模板的分组；视角改成模板的 */
export function applyTemplate(owner: SpriteOwner, id: ID, templateId: unknown): Promise<SpriteCharacter> {
  const tpl = SPRITE_TEMPLATES.find((x) => x.id === templateId)
  if (!tpl) fail('没有这个模板')
  return mutate(owner, id, (c) => {
    c.view = tpl.view
    for (const ta of tpl.actions) {
      const group = ensureGroup(c, ta.group)
      const same = c.actions.find((a) => a.name.toLowerCase() === ta.name.toLowerCase())
      if (same) {
        if (!same.group) same.group = group
        continue
      }
      const a = newAction(ta.name, group, ta.brief ?? '')
      a.params.kind = ta.kind
      c.actions.push(a)
    }
  })
}

/** 切换动作当前用的视频版本 */
export function useTake(owner: SpriteOwner, id: ID, actionId: ID, takeId: ID): Promise<SpriteCharacter> {
  return mutate(owner, id, (c) => {
    const a = c.actions.find((x) => x.id === actionId)
    const t = a?.takes.find((x) => x.id === takeId)
    if (!a || !t) fail('这个版本不存在了')
    activateTake(a, t)
  })
}

/** 删掉一个视频版本；删的是当前版本时换成最近导入的另一个，删光了动作变回待生成 */
export async function deleteTake(owner: SpriteOwner, id: ID, actionId: ID, takeId: ID): Promise<SpriteCharacter> {
  let video: string | null = null
  const c = await mutate(owner, id, (ch) => {
    const a = ch.actions.find((x) => x.id === actionId)
    const t = a?.takes.find((x) => x.id === takeId)
    if (!a || !t) fail('这个版本不存在了')
    video = t.video
    const wasActive = a.video === t.video
    a.takes = a.takes.filter((x) => x !== t)
    if (!wasActive) return
    const next = a.takes[a.takes.length - 1]
    if (next) {
      a.video = ''
      activateTake(a, next)
    } else {
      a.video = ''
      a.sourceName = ''
      a.bytes = 0
      a.params = { ...a.params, start: null, end: null }
      a.edits = []
    }
  })
  if (video) await trashUnusedVideos(owner, c, [video])
  return c
}

/** 「从同一视频再抽一个动作」的几个动作共用一个视频文件：没有任何版本再用到时才扔进废纸篓 */
async function trashUnusedVideos(owner: SpriteOwner, c: SpriteCharacter, videos: string[]): Promise<void> {
  const used = new Set(c.actions.flatMap((a) => a.takes.map((t) => t.video)))
  for (const v of new Set(videos)) {
    if (!used.has(v) && isSafeVideoName(v)) await trash(join(spritePaths.videos(owner, c.id), v))
  }
}

/** 把一个版本拆成单独的动作（同一组，名字加编号） */
export function splitTake(owner: SpriteOwner, id: ID, actionId: ID, takeId: ID): Promise<SpriteCharacter> {
  return mutate(owner, id, (c) => {
    const a = c.actions.find((x) => x.id === actionId)
    const t = a?.takes.find((x) => x.id === takeId)
    if (!a || !t) fail('这个版本不存在了')
    if (a.takes.length < 2) fail('只有一个版本，不用拆')
    const wasActive = a.video === t.video
    if (wasActive) {
      // 当前版本的片段和换帧记录在动作上，先存回这个版本带走
      t.start = a.params.start
      t.end = a.params.end
      t.edits = a.edits
    }
    a.takes = a.takes.filter((x) => x !== t)
    if (wasActive) {
      a.video = ''
      activateTake(a, a.takes[a.takes.length - 1])
    }
    const b = newAction(uniqueName(a.name, c.actions.map((x) => x.name)), a.group, a.brief)
    b.params = { ...a.params }
    b.takes = [t]
    activateTake(b, t)
    c.actions.splice(c.actions.indexOf(a) + 1, 0, b)
  })
}

export async function deleteAction(owner: SpriteOwner, id: ID, actionId: ID): Promise<SpriteCharacter> {
  let videos: string[] = []
  const c = await mutate(owner, id, (ch) => {
    const a = ch.actions.find((x) => x.id === actionId)
    if (!a) fail('动作不存在')
    videos = a.takes.map((t) => t.video)
    ch.actions = ch.actions.filter((x) => x !== a)
  })
  await trashUnusedVideos(owner, c, videos)
  return c
}

/**
 * 从同一个视频再抽一个动作：新动作和原动作共用当前版本的视频文件，抠图等参数照搬，
 * 片段、换帧和循环 / 单次重新来，各自在时间轴上选自己那一段。插在原动作后面。
 */
export function extractAction(owner: SpriteOwner, id: ID, actionId: ID, rawName: unknown, rawGroup: unknown): Promise<SpriteCharacter> {
  const name = asLine(rawName, '动作名', 40).trim()
  if (!name) fail('请填写动作名')
  return mutate(owner, id, (c) => {
    const a = c.actions.find((x) => x.id === actionId)
    if (!a) fail('动作不存在')
    const take = a.takes.find((t) => t.video === a.video)
    if (!a.video || !take) fail('这个动作还没有视频')
    if (c.actions.some((x) => x.name.toLowerCase() === name.toLowerCase())) fail(`已经有叫「${name}」的动作了`)
    let group: ID | null
    if (rawGroup === undefined) group = a.group
    else if (rawGroup === null) group = null
    else if (rawGroup === 'auto') group = ensureGroup(c, defaultGroupName(name))
    else {
      group = asId(rawGroup, '分组 id')
      if (!c.groups.some((g) => g.id === group)) fail('分组不存在了')
    }
    const b = newAction(name, group)
    b.params = { ...a.params, kind: 'auto', start: null, end: null }
    const t: SpriteTake = { ...take, id: newId(), start: null, end: null, edits: [], addedAt: nowIso() }
    b.takes = [t]
    activateTake(b, t)
    c.actions.splice(c.actions.indexOf(a) + 1, 0, b)
  })
}

export async function deleteCharacter(owner: SpriteOwner, id: ID): Promise<void> {
  await trash(spritePaths.dir(owner, id))
}

/** 人物素材的原图路径；不存在时 null */
export async function refPath(owner: SpriteOwner, id: ID, refId: ID): Promise<string | null> {
  const c = await readCharacter(owner, id)
  const r = c?.refs.find((x) => x.id === refId)
  if (!r || !isSafeRefName(r.file)) return null
  const p = join(spritePaths.refs(owner, id), r.file)
  return (await exists(p)) ? p : null
}

export async function addRefs(owner: SpriteOwner, id: ID, files: string[]): Promise<{ character: SpriteCharacter; added: number; skipped: Skipped }> {
  const skipped: Skipped = []
  let added = 0
  const character = await mutate(owner, id, async (c) => {
    added = (await placeRefs(owner, c, files, skipped)).length
  })
  return { character, added, skipped }
}

export async function deleteRef(owner: SpriteOwner, id: ID, refId: ID): Promise<SpriteCharacter> {
  let file: string | null = null
  const c = await mutate(owner, id, (ch) => {
    const r = ch.refs.find((x) => x.id === refId)
    if (!r) fail('这张人物图不存在了')
    file = r.file
    ch.refs = ch.refs.filter((x) => x !== r)
    for (const x of ch.refs) if (x.from === refId) x.from = null
    if (ch.mainRef === refId) ch.mainRef = ch.refs[0]?.id ?? null
  })
  if (file && isSafeRefName(file)) await trash(join(spritePaths.refs(owner, id), file))
  return c
}

/**
 * 存一张定妆照（首帧图）：png 是界面做好的首帧图；为 null 时直接用 from 那张人物图（原图不动）。
 * 同一朝向原来的定妆照会删掉；原来那张是主图时，主图改成新的这张。
 */
export async function saveAnchor(owner: SpriteOwner, id: ID, rawFacing: unknown, rawFrom: unknown, png: Buffer | null): Promise<SpriteCharacter> {
  const facing = asFacing(rawFacing)
  const from = rawFrom === null || rawFrom === undefined ? null : asId(rawFrom, '人物图 id')
  if (!png && !from) fail('没有首帧图')
  let old: string | null = null
  const c = await mutate(owner, id, async (ch) => {
    const src = from ? ch.refs.find((r) => r.id === from) : null
    if (from && !src) fail('这张人物图不存在了')
    let buf: Buffer
    let ext: string
    if (png) {
      const info = imageInfo(png)
      if (!info || info.ext !== 'png') fail('首帧图不是 PNG')
      buf = png
      ext = 'png'
    } else {
      const s = src as SpriteRef
      if (!isSafeRefName(s.file)) fail('这张人物图不见了')
      buf = await fs.readFile(join(spritePaths.refs(owner, id), s.file))
      ext = extname(s.file).slice(1).toLowerCase()
    }
    const info = imageInfo(buf)
    if (!info?.width || !info.height) fail('读不出首帧图的尺寸')
    const prev = ch.refs.find((r) => r.facing === facing)
    const refId = newId()
    const file = `${refId}.${ext}`
    const dir = spritePaths.refs(owner, id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, file), buf)
    const ref: SpriteRef = {
      id: refId,
      file,
      name: `定妆照·${SPRITE_FACING_LABELS[facing]}`,
      width: info.width,
      height: info.height,
      bytes: buf.length,
      facing,
      from: from === prev?.id ? (prev?.from ?? null) : from,
      addedAt: nowIso()
    }
    if (prev) {
      old = prev.file
      ch.refs = ch.refs.map((r) => (r === prev ? ref : r))
      if (ch.mainRef === prev.id) ch.mainRef = refId
      for (const x of ch.refs) if (x.from === prev.id) x.from = ref.from
    } else ch.refs.push(ref)
    if (!ch.mainRef) ch.mainRef = refId
  })
  if (old && isSafeRefName(old)) await trash(join(spritePaths.refs(owner, id), old))
  return c
}

/** 往上找 project.godot，算出导出目录对应的 res:// 路径（角色文件夹在它下面）；不在 Godot 项目里返回 null */
export async function detectGodotPrefix(dir: string): Promise<string | null> {
  let cur = resolve(dir)
  for (let i = 0; i < 16; i++) {
    if (await exists(join(cur, 'project.godot'))) {
      const rel = relative(cur, resolve(dir)).split(sep).filter(Boolean).join('/')
      return `res://${rel}`
    }
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return null
}

// ---------- 校验与补全 ----------

function clampInt(v: unknown, min: number, max: number, fallback = min): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

function normalizeParams(raw: Record<string, unknown>): SpriteActionParams {
  const d = DEFAULT_SPRITE_PARAMS
  const optInt = (v: unknown, max: number): number | null => (v === null || v === undefined ? null : clampInt(v, 0, max))
  const wm = raw['watermark']
  let watermark: SpriteActionParams['watermark'] = d.watermark
  if (wm === 'auto' || wm === 'none') watermark = wm
  else if (Array.isArray(wm) && wm.length === 4 && wm.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    const [x0, y0, x1, y1] = (wm as number[]).map((x) => Math.min(1, Math.max(0, x)))
    if (x1 > x0 && y1 > y0) watermark = [x0, y0, x1, y1]
  }
  const start = optInt(raw['start'], 100000)
  let end = optInt(raw['end'], 100000)
  if (start !== null && end !== null && end <= start) end = start + 2
  const minPeriod = clampNum(raw['minPeriod'], 0.05, 10, d.minPeriod)
  return {
    start,
    end,
    kind: raw['kind'] === 'loop' || raw['kind'] === 'once' ? raw['kind'] : 'auto',
    minPeriod,
    maxPeriod: Math.max(minPeriod, clampNum(raw['maxPeriod'], 0.05, 20, d.maxPeriod)),
    fps: clampNum(raw['fps'], 1, 60, d.fps),
    frames: raw['frames'] === null || raw['frames'] === undefined ? null : clampInt(raw['frames'], 1, 240),
    key: raw['key'] === 'hue' || raw['key'] === 'dist' ? raw['key'] : 'auto',
    hueTol: clampNum(raw['hueTol'], 1, 180, d.hueTol),
    satMin: clampNum(raw['satMin'], 0, 1, d.satMin),
    valMin: clampNum(raw['valMin'], 0, 1, d.valMin),
    distTol: clampNum(raw['distTol'], 0.01, 1.8, d.distTol),
    open: clampInt(raw['open'], 0, 5, d.open),
    watermark,
    despill: typeof raw['despill'] === 'boolean' ? raw['despill'] : d.despill,
    alphaThreshold: clampNum(raw['alphaThreshold'], 0.05, 0.95, d.alphaThreshold),
    scaleTweak: clampNum(raw['scaleTweak'], 0.8, 1.2, d.scaleTweak),
    height: raw['height'] === null || raw['height'] === undefined ? null : clampInt(raw['height'], 8, 512),
    colors: raw['colors'] === null || raw['colors'] === undefined ? null : clampInt(raw['colors'], 2, 64)
  }
}

function normalizeSettings(raw: Record<string, unknown>): SpriteSettings {
  const d = DEFAULT_SPRITE_SETTINGS
  return {
    height: clampInt(raw['height'], 8, 512, d.height),
    colors: clampInt(raw['colors'], 2, 64, d.colors),
    outline: typeof raw['outline'] === 'boolean' ? raw['outline'] : d.outline,
    pad: clampInt(raw['pad'], 0, 16, d.pad),
    resample: raw['resample'] === 'box' ? 'box' : 'mode',
    cols: raw['cols'] === null || raw['cols'] === undefined ? null : clampInt(raw['cols'], 1, 64),
    unifiedCanvas: typeof raw['unifiedCanvas'] === 'boolean' ? raw['unifiedCanvas'] : d.unifiedCanvas,
    work: raw['work'] === null || raw['work'] === undefined ? null : clampInt(raw['work'], 160, 4096),
    paletteFrom: raw['paletteFrom'] === 'reference' ? 'reference' : 'video'
  }
}

function normalizeExportPrefs(raw: Record<string, unknown>): SpriteExportPrefs {
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 4096) : null)
  let prefix = str(raw['godotPrefix'])
  if (prefix && !prefix.startsWith('res://')) prefix = null
  return {
    dir: str(raw['dir']),
    godotPrefix: prefix,
    updateAssets: raw['updateAssets'] === undefined ? true : asBoolean(raw['updateAssets'], '同时更新项目资料'),
    toAssets2D: raw['toAssets2D'] === undefined ? true : asBoolean(raw['toAssets2D'], '存进 2D 资产库'),
    assets2dMode: raw['assets2dMode'] === 'action' ? 'action' : 'character',
    skip: Array.isArray(raw['skip']) ? [...new Set(raw['skip'].filter(isSafeId))].slice(0, 500) : [],
    scale: clampInt(raw['scale'], 1, 8, 1),
    lastExportAt: str(raw['lastExportAt'])
  }
}

function normalizeEdits(v: unknown): SpriteFrameEdit[] {
  if (!Array.isArray(v)) fail('换帧记录必须是数组')
  const out: SpriteFrameEdit[] = []
  for (const x of v.slice(0, 500)) {
    const o = asObject(x, '换帧记录')
    const from = clampInt(o['from'], 0, 100000)
    const to = o['to'] === null ? null : clampInt(o['to'], 0, 100000)
    if (out.some((e) => e.from === from)) continue
    if (to !== from) out.push({ from, to })
  }
  return out
}

/** 早期的角色文件没有分组：按动作名放进标准分组（分组 id 固定，读几次都一样） */
const LEGACY_GROUP_IDS: Record<string, string> = { 移动: 'grp-move', 攻击: 'grp-attack', 受击: 'grp-hit', 交互: 'grp-social', 其他: 'grp-other' }

function normalizeTake(raw: unknown): SpriteTake | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (!isSafeId(t['id']) || typeof t['video'] !== 'string' || !isSafeVideoName(t['video'])) return null
  const opt = (v: unknown): number | null => (v === null || v === undefined ? null : clampInt(v, 0, 100000))
  return {
    id: t['id'],
    video: t['video'],
    sourceName: typeof t['sourceName'] === 'string' ? t['sourceName'] : '',
    bytes: typeof t['bytes'] === 'number' ? t['bytes'] : 0,
    start: opt(t['start']),
    end: opt(t['end']),
    edits: Array.isArray(t['edits']) ? normalizeEdits(t['edits']) : [],
    prompt: typeof t['prompt'] === 'string' ? t['prompt'] : '',
    via: t['via'] === 'inbox' || t['via'] === 'generate' ? t['via'] : 'file',
    addedAt: typeof t['addedAt'] === 'string' ? t['addedAt'] : nowIso()
  }
}

function normalizeRef(raw: unknown): SpriteRef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isSafeId(r['id']) || typeof r['file'] !== 'string' || !isSafeRefName(r['file'])) return null
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
  return {
    id: r['id'],
    file: r['file'],
    name: typeof r['name'] === 'string' ? r['name'] : '',
    width: num(r['width']),
    height: num(r['height']),
    bytes: num(r['bytes']),
    facing: typeof r['facing'] === 'string' && r['facing'] in SPRITE_FACING_LABELS ? (r['facing'] as SpriteFacing) : null,
    from: isSafeId(r['from']) ? r['from'] : null,
    addedAt: typeof r['addedAt'] === 'string' ? r['addedAt'] : nowIso()
  }
}

function normalizeCharacter(raw: Record<string, unknown>, id: ID): SpriteCharacter {
  const actions = Array.isArray(raw['actions']) ? raw['actions'] : []
  const legacy = !Array.isArray(raw['groups'])
  const groups: SpriteGroup[] = legacy ? [] : normalizeGroups(raw['groups'])
  const refs = (Array.isArray(raw['refs']) ? raw['refs'] : []).map(normalizeRef).filter((r): r is SpriteRef => r !== null)
  // 每个朝向只留一张定妆照
  const facings = new Set<SpriteFacing>()
  for (const r of refs) {
    if (r.facing && facings.has(r.facing)) r.facing = null
    if (r.facing) facings.add(r.facing)
    if (r.from && !refs.some((x) => x.id === r.from)) r.from = null
  }
  const c: SpriteCharacter = {
    id,
    name: typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'] : '角色',
    settings: normalizeSettings((raw['settings'] as Record<string, unknown>) ?? {}),
    refs,
    mainRef: refs.find((r) => r.id === raw['mainRef'])?.id ?? refs[0]?.id ?? null,
    description: typeof raw['description'] === 'string' ? raw['description'] : '',
    view: raw['view'] === 'topdown' || raw['view'] === 'front' ? raw['view'] : 'side',
    promptExtra: typeof raw['promptExtra'] === 'string' ? raw['promptExtra'] : '',
    frameSetup: normalizeFrameSetup((raw['frameSetup'] as Record<string, unknown>) ?? {}),
    groups,
    actions: [],
    exportPrefs: normalizeExportPrefs((raw['exportPrefs'] as Record<string, unknown>) ?? {}),
    assetIds: Array.isArray(raw['assetIds']) ? raw['assetIds'].filter(isSafeId) : [],
    asset2dId: isSafeId(raw['asset2dId']) ? raw['asset2dId'] : null,
    createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : nowIso(),
    updatedAt: typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : nowIso()
  }
  for (const x of actions) {
    if (!x || typeof x !== 'object' || !isSafeId((x as Record<string, unknown>)['id'])) continue
    const a = x as Record<string, unknown>
    const video = typeof a['video'] === 'string' && isSafeVideoName(a['video']) ? a['video'] : ''
    const params = normalizeParams((a['params'] as Record<string, unknown>) ?? {})
    const edits = Array.isArray(a['edits']) ? normalizeEdits(a['edits']) : []
    const sourceName = typeof a['sourceName'] === 'string' ? a['sourceName'] : ''
    const bytes = typeof a['bytes'] === 'number' ? a['bytes'] : 0
    const addedAt = typeof a['addedAt'] === 'string' ? a['addedAt'] : nowIso()
    let takes = (Array.isArray(a['takes']) ? a['takes'] : []).map(normalizeTake).filter((t): t is SpriteTake => t !== null)
    // 早期的动作只有一个视频：当成唯一的版本
    if (video && !takes.some((t) => t.video === video)) {
      takes = [...takes, { id: a['id'] as string, video, sourceName, bytes, start: params.start, end: params.end, edits, prompt: '', via: 'file', addedAt }]
    }
    const name = typeof a['name'] === 'string' && a['name'] ? a['name'] : '动作'
    let group: ID | null = typeof a['group'] === 'string' && groups.some((g) => g.id === a['group']) ? a['group'] : null
    if (legacy) {
      const gname = defaultGroupName(name)
      const gid = LEGACY_GROUP_IDS[gname]
      if (!c.groups.some((g) => g.id === gid)) c.groups.push({ id: gid, name: gname })
      group = gid
    }
    c.actions.push({
      id: a['id'] as string,
      name,
      group,
      brief: typeof a['brief'] === 'string' ? a['brief'] : '',
      video,
      sourceName: video ? sourceName : '',
      bytes: video ? bytes : 0,
      takes,
      params,
      edits,
      asset2dId: isSafeId(a['asset2dId']) ? a['asset2dId'] : null,
      addedAt
    })
  }
  if (legacy) {
    const order = SPRITE_STANDARD_GROUPS as readonly string[]
    c.groups.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  }
  return c
}

// ---------- 导出 ----------

/** 界面送来的导出内容；角色名、Godot 路径、版本号由主进程补上 */
export type ExportPayload = Omit<SpriteExportBundle, 'name' | 'godotPrefix' | 'appVersion'>

function asExportPayload(v: unknown): ExportPayload {
  const o = asObject(v, '导出内容')
  const nums = (x: unknown, n: number, what: string): number[] => {
    if (!Array.isArray(x) || x.length !== n || !x.every((k) => typeof k === 'number' && Number.isFinite(k))) fail(`${what}格式不对`)
    return x as number[]
  }
  if (!Array.isArray(o['palette']) || !o['palette'].every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) fail('调色板格式不对')
  const canvas = asObject(o['canvas'], '公共画布')
  const actions = o['actions']
  if (!Array.isArray(actions) || actions.length === 0) fail('没有可导出的动作')
  for (const raw of actions) {
    const a = asObject(raw, '动作')
    if (typeof a['name'] !== 'string' || !a['name']) fail('动作名不能为空')
    if (!Array.isArray(a['frames']) || !a['frames'].every((f) => f instanceof Uint8Array)) fail(`动作「${a['name']}」的帧数据不对`)
    if (!Array.isArray(a['sourceFrames'])) fail(`动作「${a['name']}」缺少源帧号`)
    nums(a['pivot'], 2, '落脚点')
  }
  nums(canvas['pivot'], 2, '公共画布落脚点')
  return {
    palette: o['palette'] as string[],
    pixelScale: typeof o['pixelScale'] === 'number' ? o['pixelScale'] : 1,
    exportScale: clampInt(o['exportScale'], 1, 8, 1),
    canvas: canvas as unknown as ExportPayload['canvas'],
    actions: actions as SpriteExportAction[],
    report: o['report'] ?? null
  }
}

export interface ExportOutcome extends SpriteExportResult {
  /** 存进项目资料（全局库的角色是图片素材）的图片数；没开「同时存进资料」时为 0 */
  assets: number
  /** 这次存进 2D 资产库的资产（整个角色一个，或每个动作一个） */
  assets2d: LibAsset2D[]
  godotPrefix: string | null
  character: SpriteCharacter
}

/**
 * 导出到 dir/<角色名>/；dir 为 null 时只存进 2D 资产库。godotPrefix 没手动指定时，按导出目录往上找 project.godot 自动推算。
 * 开了「同时存进资料」时，把图集和各动作的动图存进项目资料（全局库的角色存进图片素材），替换上次导出的那几张。
 */
export function exportCharacter(owner: SpriteOwner, id: ID, payload: unknown, dir: string | null, appVersion: string, names?: unknown): Promise<ExportOutcome> {
  const n = asAssetNames(names)
  // 同一角色连续导出时，后一次要读到前一次存下的资产 id。
  return withLock(`${spritePaths.file(owner, id)}:export`, () => exportToTargets(owner, id, payload, dir, appVersion, n))
}

interface AssetNames {
  character: string | null
  actions: Map<ID, string>
}

/** 存进 2D 资产库时用的名称（空的不算，用默认名） */
function asAssetNames(raw: unknown): AssetNames {
  const out: AssetNames = { character: null, actions: new Map() }
  if (raw === undefined || raw === null) return out
  const o = asObject(raw, '资产名称')
  if (o['character'] !== undefined) out.character = asLine(o['character'], '资产名称', 80).trim() || null
  if (o['actions'] !== undefined) {
    for (const [k, v] of Object.entries(asObject(o['actions'], '资产名称')).slice(0, 500)) {
      const name = asLine(v, '资产名称', 80).trim()
      if (isSafeId(k) && name) out.actions.set(k, name)
    }
  }
  return out
}

/** 单个动作的导出内容：只留这个动作，report 里也只留它 */
function singleAction(bundle: SpriteExportBundle, a: SpriteExportAction, name: string): SpriteExportBundle {
  const report = bundle.report && typeof bundle.report === 'object' ? (bundle.report as Record<string, unknown>) : null
  const list = report && Array.isArray(report['actions']) ? (report['actions'] as Array<Record<string, unknown>>) : null
  return {
    ...bundle,
    name,
    actions: [a],
    report: report ? { ...report, ...(list && { actions: list.filter((x) => x['name'] === a.name) }) } : bundle.report
  }
}

async function exportToTargets(owner: SpriteOwner, id: ID, payload: unknown, dir: string | null, appVersion: string, names: AssetNames): Promise<ExportOutcome> {
  const c = await getCharacter(owner, id)
  if (dir === null && !c.exportPrefs.toAssets2D) fail('请选择导出位置，或开启「存进 2D 资产库」')
  const p = asExportPayload(payload)
  const target = dir === null ? null : resolve(dir)
  const godotPrefix = target === null ? null : c.exportPrefs.godotPrefix ?? (await detectGodotPrefix(target))
  const name = safeFileName(c.name)
  const bundle: SpriteExportBundle = { ...p, name, godotPrefix, appVersion }
  let result = target === null ? null : await writeSpriteExport(target, bundle)

  let assets = 0
  let assetIds = c.assetIds
  if (c.exportPrefs.updateAssets) {
    const atlas = composeAtlas(bundle)
    const candidates: Array<{ c: Candidate; label: string }> = []
    const push = (buf: Buffer, label: string): void => {
      const info = imageInfo(buf)
      if (info) candidates.push({ c: { buf, info, name: `${c.name} · ${label}` }, label })
    }
    push(encodePng(atlas.rgba, atlas.width, atlas.height), '图集')
    for (const a of bundle.actions) {
      const side = Math.max(a.frameWidth, a.frameHeight)
      push(actionPreviewGif(a, Math.min(8, Math.max(1, Math.round(256 / side)))), a.name)
    }
    const meta = { category: '角色' as const, tags: ['序列帧', c.name] }
    const results =
      owner === null
        ? await addLibraryImages(
            candidates.map((x) => x.c),
            () => meta
          )
        : await addProjectAssets(
            owner,
            candidates.map((x) => x.c),
            () => meta
          )
    assetIds = results.map((r) => r.item.id)
    for (const old of c.assetIds) {
      if (assetIds.includes(old)) continue
      try {
        if (owner === null) await deleteImage(old)
        else await deleteAsset(owner, old)
      } catch {
        // 用户已经在资料里删掉了
      }
    }
    assets = assetIds.length
  }
  const assets2d: LibAsset2D[] = []
  /** 每个动作单独存时：动作 id → 资产 id */
  const perAction = new Map<ID, ID>()
  let charAsset: ID | null = null
  if (c.exportPrefs.toAssets2D) {
    // 主图排第一
    const refs: Array<{ path: string; name: string }> = []
    for (const r of [...c.refs].sort((a, b) => Number(b.id === c.mainRef) - Number(a.id === c.mainRef))) {
      const path = await refPath(owner, id, r.id)
      if (path) refs.push({ path, name: r.name || 'ref' })
    }
    const base = { owner, characterId: id, refs, description: c.description }
    if (c.exportPrefs.assets2dMode === 'action') {
      for (const pa of bundle.actions) {
        const a = c.actions.find((x) => x.id === pa.actionId)
        if (!a) continue
        const label = names.actions.get(a.id)
        const asset = await saveSpriteAsset({
          ...base,
          name: label ?? `${c.name} · ${a.name}`,
          rename: label !== undefined,
          bundle: singleAction({ ...bundle, godotPrefix: null }, pa, safeFileName(`${c.name}_${a.name}`)),
          assetId: a.asset2dId
        })
        assets2d.push(asset)
        perAction.set(a.id, asset.id)
      }
    } else {
      const asset = await saveSpriteAsset({
        ...base,
        name: names.character ?? c.name,
        rename: names.character !== null,
        bundle: { ...bundle, godotPrefix: null },
        assetId: c.asset2dId
      })
      assets2d.push(asset)
      charAsset = asset.id
    }
  }
  if (!result && assets2d.length) result = { folder: assets2d.length === 1 ? asset2dDir(assets2d[0].id) : dirname(asset2dDir(assets2d[0].id)), files: assets2d.reduce((n, x) => n + x.fileCount, 0) }
  if (!result) fail('没有可导出的目标位置')
  const character = await mutate(owner, id, (ch) => {
    ch.assetIds = assetIds
    if (charAsset) ch.asset2dId = charAsset
    for (const a of ch.actions) if (perAction.has(a.id)) a.asset2dId = perAction.get(a.id) as ID
    ch.exportPrefs = { ...ch.exportPrefs, ...(target === null ? {} : { dir: target }), lastExportAt: nowIso() }
  })
  return { ...result, assets, assets2d, godotPrefix, character }
}
