// 序列帧角色的存储：projects/<id>/sprites/<角色 id>/character.json，源视频拷进同目录的 videos/。
// 源视频拷一份进工作台：「下载」里的原文件被清理掉以后，照样能重新调整、重新导出。
import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import {
  DEFAULT_SPRITE_PARAMS,
  DEFAULT_SPRITE_SETTINGS,
  detectActionName,
  SPRITE_VIDEO_EXTENSIONS,
  type SpriteAction,
  type SpriteActionParams,
  safeFileName,
  type SpriteCharacter,
  type SpriteExportAction,
  type SpriteExportBundle,
  type SpriteExportPrefs,
  type SpriteExportResult,
  type SpriteFrameEdit,
  type SpriteSettings
} from '@shared/sprites'
import type { ID } from '@shared/types'
import { imageInfo, type Candidate } from './images'
import { addProjectAssets, deleteAsset } from './projects'
import { actionPreviewGif, composeAtlas, encodePng, writeSpriteExport } from './spriteExport'
import { exists, isNotFound, newId, nowIso, paths, readJson, trash, withLock, writeJson } from './storage'
import { asBoolean, asId, asLine, asObject, fail, has, isSafeId } from './validate'

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024

export const spritePaths = {
  root: (projectId: ID) => join(paths.project(projectId), 'sprites'),
  dir: (projectId: ID, id: ID) => join(spritePaths.root(projectId), asId(id, '角色 id')),
  file: (projectId: ID, id: ID) => join(spritePaths.dir(projectId, id), 'character.json'),
  videos: (projectId: ID, id: ID) => join(spritePaths.dir(projectId, id), 'videos')
}

export function isVideoFile(path: string): boolean {
  return SPRITE_VIDEO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())
}

// ---------- 读取 ----------

async function readCharacter(projectId: ID, id: ID): Promise<SpriteCharacter | null> {
  const raw = await readJson<unknown>(spritePaths.file(projectId, id), null)
  if (!raw || typeof raw !== 'object') return null
  return normalizeCharacter(raw as Record<string, unknown>, id)
}

export async function listCharacters(projectId: ID): Promise<SpriteCharacter[]> {
  let names: string[]
  try {
    names = await fs.readdir(spritePaths.root(projectId))
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const out: SpriteCharacter[] = []
  for (const name of names) {
    if (!isSafeId(name)) continue
    try {
      const c = await readCharacter(projectId, name)
      if (c) out.push(c)
    } catch (err) {
      console.error(`[sprites] 跳过无法读取的角色 ${name}:`, err)
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

export async function getCharacter(projectId: ID, id: ID): Promise<SpriteCharacter> {
  const c = await readCharacter(projectId, id)
  if (!c) fail('角色不存在')
  return c
}

export async function countCharacters(projectId: ID): Promise<number> {
  try {
    const names = await fs.readdir(spritePaths.root(projectId))
    let n = 0
    for (const name of names) if (isSafeId(name) && (await exists(spritePaths.file(projectId, name)))) n++
    return n
  } catch {
    return 0
  }
}

/** 动作的源视频文件 */
export async function videoPath(projectId: ID, id: ID, actionId: ID): Promise<string | null> {
  const c = await readCharacter(projectId, id)
  const a = c?.actions.find((x) => x.id === actionId)
  if (!a || !isSafeVideoName(a.video)) return null
  return join(spritePaths.videos(projectId, id), a.video)
}

function isSafeVideoName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{2,4}$/.test(name)
}

// ---------- 导入 ----------

/** 从文件名里去掉动作词和平台前缀，剩下的当角色名 */
const GENERIC = /^(wan\d*(\.\d+)?|kling|hailuo|vidu|seedance|runway|veo\d*|sora|pika|ai|gen|video|output|final|clip|v\d+|\d+)$/i

function nameTokens(file: string): string[] {
  const stem = basename(file, extname(file))
  return stem
    .split(/[\s_\-.()（）[\]]+/)
    .filter(Boolean)
    .filter((t) => !GENERIC.test(t) && detectActionName(t) === null)
}

/** 几个文件共同的角色名；没有共同部分时返回 null */
export function inferCharacterName(files: string[]): string | null {
  const lists = files.map(nameTokens)
  if (lists.length === 0) return null
  const common = lists[0].filter((t) => lists.every((l) => l.some((x) => x.toLowerCase() === t.toLowerCase())))
  const name = common.join('_')
  return name || null
}

function actionNameOf(file: string): string {
  const stem = basename(file, extname(file))
  return detectActionName(stem) ?? (stem.slice(0, 40) || '动作')
}

function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name
  for (let i = 2; ; i++) {
    const n = `${name}_${i}`
    if (!taken.includes(n)) return n
  }
}

async function copyVideo(projectId: ID, charId: ID, file: string, taken: string[]): Promise<SpriteAction> {
  const st = await fs.stat(file)
  if (!st.isFile()) fail(`不是文件：${basename(file)}`)
  if (st.size > MAX_VIDEO_BYTES) fail(`视频太大了（超过 1 GB）：${basename(file)}`)
  const id = newId()
  const ext = extname(file).slice(1).toLowerCase()
  const video = `${id}.${ext}`
  const dir = spritePaths.videos(projectId, charId)
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(file, join(dir, video))
  return {
    id,
    name: uniqueName(actionNameOf(file), taken),
    video,
    sourceName: basename(file),
    bytes: st.size,
    params: { ...DEFAULT_SPRITE_PARAMS },
    edits: [],
    addedAt: nowIso()
  }
}

async function videosInFolder(dir: string): Promise<string[]> {
  const names = await fs.readdir(dir)
  return names
    .filter((n) => !n.startsWith('.') && isVideoFile(n))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
    .map((n) => join(dir, n))
}

export interface CreateResult {
  created: SpriteCharacter[]
  /** 和已有角色同名：动作加进了已有角色 */
  merged: SpriteCharacter[]
  skipped: Array<{ path: string; reason: string }>
}

/** 已经导入过的视频（同文件名、同大小）不重复导入 */
async function alreadyImported(c: SpriteCharacter, file: string): Promise<boolean> {
  const st = await fs.stat(file)
  return c.actions.some((a) => a.sourceName === basename(file) && a.bytes === st.size)
}

/**
 * 导入：每个文件夹是一个角色（里面每个视频是一个动作）；一起拖进来的零散视频算同一个角色。
 * 名字和已有角色相同时（比如后来补生成了 jump.mp4），动作加进已有角色，导入过的视频跳过。
 * height 是新角色的默认像素身高。
 */
export async function createCharacters(projectId: ID, inputs: string[], height?: number): Promise<CreateResult> {
  const skipped: CreateResult['skipped'] = []
  const groups: Array<{ name: string; files: string[] }> = []
  const loose: string[] = []
  for (const p of inputs) {
    let st
    try {
      st = await fs.stat(p)
    } catch {
      skipped.push({ path: p, reason: '找不到这个文件' })
      continue
    }
    if (st.isDirectory()) {
      const files = await videosInFolder(p)
      if (files.length === 0) skipped.push({ path: p, reason: '文件夹里没有视频（mp4 / mov）' })
      else groups.push({ name: basename(p), files })
    } else if (isVideoFile(p)) {
      loose.push(p)
    } else {
      skipped.push({ path: p, reason: '不是视频文件（只支持 mp4 / mov）' })
    }
  }
  if (loose.length) {
    groups.push({ name: inferCharacterName(loose) ?? basename(dirname(loose[0])), files: loose })
  }
  const existing = await listCharacters(projectId)
  const takenNames = existing.map((c) => c.name)
  const created: SpriteCharacter[] = []
  const merged: SpriteCharacter[] = []
  for (const g of groups) {
    const same = existing.find((c) => c.name.toLowerCase() === g.name.trim().toLowerCase())
    if (same) {
      const fresh: string[] = []
      for (const f of g.files) {
        if (await alreadyImported(same, f)) skipped.push({ path: f, reason: `「${same.name}」里已经有这个视频了` })
        else fresh.push(f)
      }
      if (fresh.length === 0) continue
      const r = await addActions(projectId, same.id, fresh)
      skipped.push(...r.skipped)
      if (r.added.length) merged.push(r.character)
      continue
    }
    const id = newId()
    const actions: SpriteAction[] = []
    for (const f of g.files) {
      try {
        actions.push(await copyVideo(projectId, id, f, actions.map((a) => a.name)))
      } catch (err) {
        skipped.push({ path: f, reason: err instanceof Error ? err.message : String(err) })
      }
    }
    if (actions.length === 0) continue
    const name = uniqueName(g.name.trim() || `角色 ${existing.length + created.length + 1}`, takenNames)
    takenNames.push(name)
    const now = nowIso()
    const c: SpriteCharacter = {
      id,
      name,
      settings: { ...DEFAULT_SPRITE_SETTINGS, ...(height ? { height: clampInt(height, 8, 512) } : {}) },
      actions,
      exportPrefs: { dir: null, godotPrefix: null, updateAssets: true, lastExportAt: null },
      assetIds: [],
      createdAt: now,
      updatedAt: now
    }
    await writeJson(spritePaths.file(projectId, id), c)
    created.push(c)
  }
  return { created, merged, skipped }
}

/** 给已有角色添加动作（视频文件，或文件夹里的视频） */
export async function addActions(projectId: ID, id: ID, inputs: string[]): Promise<{ character: SpriteCharacter; added: SpriteAction[]; skipped: CreateResult['skipped'] }> {
  const files: string[] = []
  const skipped: CreateResult['skipped'] = []
  for (const p of inputs) {
    try {
      const st = await fs.stat(p)
      if (st.isDirectory()) files.push(...(await videosInFolder(p)))
      else if (isVideoFile(p)) files.push(p)
      else skipped.push({ path: p, reason: '不是视频文件（只支持 mp4 / mov）' })
    } catch {
      skipped.push({ path: p, reason: '找不到这个文件' })
    }
  }
  const added: SpriteAction[] = []
  const character = await mutate(projectId, id, async (c) => {
    for (const f of files) {
      try {
        const a = await copyVideo(projectId, id, f, [...c.actions, ...added].map((x) => x.name))
        added.push(a)
      } catch (err) {
        skipped.push({ path: f, reason: err instanceof Error ? err.message : String(err) })
      }
    }
    c.actions.push(...added)
  })
  return { character, added, skipped }
}

// ---------- 修改 ----------

function mutate(projectId: ID, id: ID, fn: (c: SpriteCharacter) => void | Promise<void>): Promise<SpriteCharacter> {
  const file = spritePaths.file(projectId, id)
  return withLock(file, async () => {
    const c = await readCharacter(projectId, id)
    if (!c) fail('角色不存在')
    await fn(c)
    c.updatedAt = nowIso()
    await writeJson(file, c)
    return c
  })
}

export function updateCharacter(projectId: ID, id: ID, patch: unknown): Promise<SpriteCharacter> {
  const p = asObject(patch, '角色修改')
  return mutate(projectId, id, (c) => {
    if (has(p, 'name')) {
      const name = asLine(p['name'], '角色名', 80).trim()
      if (!name) fail('角色名不能为空')
      c.name = name
    }
    if (has(p, 'settings')) c.settings = normalizeSettings({ ...c.settings, ...asObject(p['settings'], '输出设置') })
    if (has(p, 'exportPrefs')) c.exportPrefs = normalizeExportPrefs({ ...c.exportPrefs, ...asObject(p['exportPrefs'], '导出设置') })
  })
}

export function updateAction(projectId: ID, id: ID, actionId: ID, patch: unknown): Promise<SpriteCharacter> {
  const p = asObject(patch, '动作修改')
  return mutate(projectId, id, (c) => {
    const a = c.actions.find((x) => x.id === actionId)
    if (!a) fail('动作不存在')
    if (has(p, 'name')) {
      const name = asLine(p['name'], '动作名', 40).trim()
      if (!name) fail('动作名不能为空')
      if (c.actions.some((x) => x !== a && x.name === name)) fail(`已经有叫「${name}」的动作了`)
      a.name = name
    }
    if (has(p, 'params')) a.params = normalizeParams({ ...a.params, ...asObject(p['params'], '动作参数') })
    if (has(p, 'edits')) a.edits = normalizeEdits(p['edits'])
  })
}

/** 把一组参数应用到全部动作（片段起止、换帧记录除外） */
export function applyParamsToAll(projectId: ID, id: ID, params: unknown): Promise<SpriteCharacter> {
  const src = normalizeParams(asObject(params, '动作参数'))
  return mutate(projectId, id, (c) => {
    for (const a of c.actions) a.params = { ...src, start: a.params.start, end: a.params.end, kind: a.params.kind }
  })
}

export function reorderActions(projectId: ID, id: ID, order: ID[]): Promise<SpriteCharacter> {
  return mutate(projectId, id, (c) => {
    const rank = new Map(order.map((x, i) => [x, i]))
    c.actions.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9))
  })
}

export async function deleteAction(projectId: ID, id: ID, actionId: ID): Promise<SpriteCharacter> {
  let video: string | null = null
  const c = await mutate(projectId, id, (ch) => {
    const a = ch.actions.find((x) => x.id === actionId)
    if (!a) fail('动作不存在')
    video = a.video
    ch.actions = ch.actions.filter((x) => x !== a)
  })
  if (video && isSafeVideoName(video)) await trash(join(spritePaths.videos(projectId, id), video))
  return c
}

export async function deleteCharacter(projectId: ID, id: ID): Promise<void> {
  await trash(spritePaths.dir(projectId, id))
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
    scaleTweak: clampNum(raw['scaleTweak'], 0.8, 1.2, d.scaleTweak)
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
    work: raw['work'] === null || raw['work'] === undefined ? null : clampInt(raw['work'], 160, 4096)
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

function normalizeCharacter(raw: Record<string, unknown>, id: ID): SpriteCharacter {
  const actions = Array.isArray(raw['actions']) ? raw['actions'] : []
  return {
    id,
    name: typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'] : '角色',
    settings: normalizeSettings((raw['settings'] as Record<string, unknown>) ?? {}),
    actions: actions
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && isSafeId((a as Record<string, unknown>)['id']))
      .map((a) => ({
        id: a['id'] as string,
        name: typeof a['name'] === 'string' && a['name'] ? a['name'] : '动作',
        video: typeof a['video'] === 'string' ? a['video'] : '',
        sourceName: typeof a['sourceName'] === 'string' ? a['sourceName'] : '',
        bytes: typeof a['bytes'] === 'number' ? a['bytes'] : 0,
        params: normalizeParams((a['params'] as Record<string, unknown>) ?? {}),
        edits: Array.isArray(a['edits']) ? normalizeEdits(a['edits']) : [],
        addedAt: typeof a['addedAt'] === 'string' ? a['addedAt'] : nowIso()
      })),
    exportPrefs: normalizeExportPrefs((raw['exportPrefs'] as Record<string, unknown>) ?? {}),
    assetIds: Array.isArray(raw['assetIds']) ? raw['assetIds'].filter(isSafeId) : [],
    createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : nowIso(),
    updatedAt: typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : nowIso()
  }
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
    canvas: canvas as unknown as ExportPayload['canvas'],
    actions: actions as SpriteExportAction[],
    report: o['report'] ?? null
  }
}

export interface ExportOutcome extends SpriteExportResult {
  /** 存进项目资料的图片数（没开「同时更新项目资料」时为 0） */
  assets: number
  godotPrefix: string | null
  character: SpriteCharacter
}

/**
 * 导出到 dir/<角色名>/。godotPrefix 没手动指定时，按导出目录往上找 project.godot 自动推算。
 * 开了「同时更新项目资料」时，把图集和各动作的动图存进项目资料（替换上次导出的那几张）。
 */
export async function exportCharacter(projectId: ID, id: ID, payload: unknown, dir: string, appVersion: string): Promise<ExportOutcome> {
  const c = await getCharacter(projectId, id)
  const p = asExportPayload(payload)
  const target = resolve(dir)
  const godotPrefix = c.exportPrefs.godotPrefix ?? (await detectGodotPrefix(target))
  const name = safeFileName(c.name)
  const bundle: SpriteExportBundle = { ...p, name, godotPrefix, appVersion }
  const result = await writeSpriteExport(target, bundle)

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
    const results = await addProjectAssets(
      projectId,
      candidates.map((x) => x.c),
      () => ({ category: '角色', tags: ['序列帧', c.name] })
    )
    assetIds = results.map((r) => r.item.id)
    for (const old of c.assetIds) {
      if (assetIds.includes(old)) continue
      try {
        await deleteAsset(projectId, old)
      } catch {
        // 用户已经在资料里删掉了
      }
    }
    assets = assetIds.length
  }
  const character = await mutate(projectId, id, (ch) => {
    ch.assetIds = assetIds
    ch.exportPrefs = { ...ch.exportPrefs, dir: target, lastExportAt: nowIso() }
  })
  return { ...result, assets, godotPrefix, character }
}
