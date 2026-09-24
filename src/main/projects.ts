// 项目：配置（project.json）、构思（notes/*.md）、资料（assets/ + assets.json）。
import { promises as fs } from 'fs'
import { ASSET_CATEGORIES, NOTE_CATEGORIES } from '@shared/types'
import type {
  AssetCategory,
  ID,
  ImageCategory,
  Note,
  Project,
  ProjectAsset,
  ProjectSizes,
  ProjectSummary,
  ScalingMode
} from '@shared/types'
import {
  addToStore,
  candidateFromClipboard,
  candidatesFromFiles,
  findInStore,
  listStore,
  removeFromStore,
  storedPath,
  updateInStore
} from './images'
import type { AddResult, Candidate, ImageStore } from './images'
import { getImage, libraryStore, listStyles } from './library'
import { asNoteCategory, asNoteTitle, normalizeBlocks, parseNote, serializeNote } from './notesmd'
import {
  exists,
  isNotFound,
  modifyJson,
  newId,
  nowIso,
  paths,
  readJson,
  trash,
  updateJson,
  withLock,
  writeFileAtomic,
  writeJson
} from './storage'
import { dropThumbs } from './thumbs'
import {
  asBoolean,
  asId,
  asIds,
  asInt,
  asLine,
  asObject,
  asOneOf,
  asString,
  asStringList,
  fail,
  has,
  isSafeId
} from './validate'

export function assetStore(projectId: ID): ImageStore {
  return { dir: paths.assetsDir(projectId), index: paths.assets(projectId), hashes: paths.assetHashes(projectId) }
}

// ---------- 项目 ----------

async function readProject(id: ID): Promise<Project> {
  const p = await readJson<Project | null>(paths.projectFile(id), null)
  if (!p) fail('项目不存在')
  return { ...p, id }
}

export async function assertProject(id: ID): Promise<void> {
  if (!(await exists(paths.projectFile(id)))) fail('项目不存在')
}

async function countNotes(projectId: ID): Promise<number> {
  try {
    return (await fs.readdir(paths.notesDir(projectId))).filter((n) => n.endsWith('.md') && !n.startsWith('.')).length
  } catch (err) {
    if (isNotFound(err)) return 0
    throw err
  }
}

/** 项目列表，按创建时间排 */
export async function listProjects(): Promise<ProjectSummary[]> {
  let names: string[]
  try {
    names = await fs.readdir(paths.projects())
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const rows: Array<{ summary: ProjectSummary; createdAt: string }> = []
  for (const name of names) {
    if (!isSafeId(name)) continue
    let p: Project
    try {
      p = await readProject(name)
    } catch (err) {
      console.error(`[projects] 跳过无法读取的项目 ${name}:`, err)
      continue
    }
    const assets = await listStore<ProjectAsset>(assetStore(name))
    rows.push({
      summary: {
        id: name,
        name: p.name,
        noteCount: await countNotes(name),
        assetCount: assets.length,
        coverAssetId: p.coverAssetId ?? null,
        updatedAt: p.updatedAt
      },
      createdAt: p.createdAt
    })
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  return rows.map((r) => r.summary)
}

export function getProject(id: ID): Promise<Project> {
  return readProject(id)
}

export function defaultSizes(): ProjectSizes {
  return {
    tile: { w: 16, h: 16 },
    character: { w: 32, h: 32 },
    boss: { w: 64, h: 64 },
    icon: { w: 16, h: 16 }
  }
}

export async function createProject(name: string, createdAt = nowIso()): Promise<Project> {
  const clean = asLine(name, '项目名称').trim() || '未命名项目'
  let id = newId()
  while (await exists(paths.project(id))) id = newId()
  const project: Project = {
    id,
    name: clean,
    pitch: '',
    genres: [],
    platforms: [],
    targetPlayers: '',
    sessionLength: '20–40 分钟',
    styleId: null,
    resolution: { w: 320, h: 180 },
    scaling: 'integer',
    sizes: defaultSizes(),
    coverAssetId: null,
    pinnedPromptIds: [],
    createdAt,
    updatedAt: createdAt
  }
  await fs.mkdir(paths.notesDir(id), { recursive: true })
  await fs.mkdir(paths.assetsDir(id), { recursive: true })
  await writeJson(paths.assets(id), [])
  await writeJson(paths.projectFile(id), project)
  return project
}

const SCALING: readonly ScalingMode[] = ['integer', 'fit', 'stretch']

function asSize(v: unknown, label: string, min: number): { w: number; h: number } {
  const o = asObject(v, label)
  return { w: asInt(o['w'], `${label}宽度`, min, 8192), h: asInt(o['h'], `${label}高度`, min, 8192) }
}

/** 校验项目修改内容；只取认识的字段 */
async function projectFields(projectId: ID, patch: unknown): Promise<Partial<Project>> {
  const p = asObject(patch, '修改内容')
  const out: Partial<Project> = {}
  if (has(p, 'name')) out.name = asLine(p['name'], '项目名称')
  if (has(p, 'pitch')) out.pitch = asLine(p['pitch'], '一句话介绍', 1000)
  if (has(p, 'genres')) out.genres = asStringList(p['genres'], '类型')
  if (has(p, 'platforms')) out.platforms = asStringList(p['platforms'], '平台')
  if (has(p, 'targetPlayers')) out.targetPlayers = asString(p['targetPlayers'], '目标玩家', 2000)
  if (has(p, 'sessionLength')) out.sessionLength = asLine(p['sessionLength'], '单局时长')
  if (p['styleId'] === null) out.styleId = null
  else if (has(p, 'styleId')) {
    const sid = asId(p['styleId'], '风格 id')
    if (!(await listStyles()).some((s) => s.id === sid)) fail('风格不存在')
    out.styleId = sid
  }
  if (has(p, 'resolution')) out.resolution = asSize(p['resolution'], '分辨率', 1)
  if (has(p, 'scaling')) out.scaling = asOneOf(p['scaling'], SCALING, '缩放方式')
  if (has(p, 'sizes')) {
    const s = asObject(p['sizes'], '尺寸')
    const labels: Record<keyof ProjectSizes, string> = { tile: '瓦片', character: '角色', boss: 'Boss', icon: '图标' }
    const sizes: Partial<ProjectSizes> = {}
    for (const key of Object.keys(labels) as Array<keyof ProjectSizes>) {
      if (has(s, key)) sizes[key] = asSize(s[key], labels[key], 0)
    }
    out.sizes = sizes as ProjectSizes // 与原有尺寸合并，见 updateProject
  }
  if (p['coverAssetId'] === null) out.coverAssetId = null
  else if (has(p, 'coverAssetId')) {
    const aid = asId(p['coverAssetId'], '封面 id')
    if (!(await findInStore(assetStore(projectId), aid))) fail('封面图片不在本项目资料里')
    out.coverAssetId = aid
  }
  if (has(p, 'pinnedPromptIds')) out.pinnedPromptIds = [...new Set(asIds(p['pinnedPromptIds'], '常用提示词'))]
  return out
}

export async function updateProject(id: ID, patch: unknown): Promise<Project> {
  await assertProject(id)
  const f = await projectFields(id, patch)
  return updateJson<Project | null, Project>(paths.projectFile(id), null, (p) => {
    if (!p) fail('项目不存在')
    const sizes = f.sizes ? { ...(p.sizes ?? defaultSizes()), ...f.sizes } : p.sizes
    Object.assign(p, f, { id, sizes, updatedAt: nowIso() })
    return p
  })
}

/** 整个项目文件夹移到废纸篓 */
export async function removeProject(id: ID): Promise<void> {
  await withLock(paths.projectFile(id), async () => {
    if (!(await exists(paths.project(id)))) fail('项目不存在')
    await trash(paths.project(id))
  })
  await dropThumbs(`prj.${id}.`)
}

/** 从各项目里去掉对某个提示词 / 风格的引用；返回改动过的项目 id */
export async function forgetLibraryRefs(ref: { promptId?: ID; styleId?: ID }): Promise<ID[]> {
  const changed: ID[] = []
  for (const s of await listProjects()) {
    const touched = await modifyJson<Project | null>(paths.projectFile(s.id), null, (p) => {
      if (!p) return false
      let hit = false
      if (ref.promptId && p.pinnedPromptIds?.includes(ref.promptId)) {
        p.pinnedPromptIds = p.pinnedPromptIds.filter((x) => x !== ref.promptId)
        hit = true
      }
      if (ref.styleId && p.styleId === ref.styleId) {
        p.styleId = null
        hit = true
      }
      return hit
    })
    if (touched) changed.push(s.id)
  }
  return changed
}

// ---------- 笔记 ----------

async function readNote(projectId: ID, noteId: ID): Promise<Note | null> {
  const file = paths.note(projectId, noteId)
  let text: string
  let mtime: Date
  try {
    ;[text, mtime] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file).then((s) => s.mtime)])
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  return parseNote(text, projectId, { id: noteId, fallbackDate: mtime.toISOString() })
}

/** 笔记列表，最近修改的在前 */
export async function listNotes(projectId: ID): Promise<Note[]> {
  await assertProject(projectId)
  let names: string[]
  try {
    names = await fs.readdir(paths.notesDir(projectId))
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const notes: Note[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    if (!isSafeId(id)) continue
    const note = await readNote(projectId, id)
    if (note) notes.push(note)
  }
  notes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return notes
}

async function writeNote(projectId: ID, note: Note): Promise<void> {
  await writeFileAtomic(paths.note(projectId, note.id), serializeNote(note))
}

export async function createNote(
  projectId: ID,
  input: unknown,
  /** 示例导入时指定的完成状态和时间 */
  preset: { createdAt?: string; updatedAt?: string; done?: boolean } = {}
): Promise<Note> {
  await assertProject(projectId)
  const o = input === undefined || input === null ? {} : asObject(input, '笔记')
  const now = nowIso()
  let id = newId()
  while (await exists(paths.note(projectId, id))) id = newId()
  const note: Note = {
    id,
    title: has(o, 'title') ? asNoteTitle(o['title']) : '新笔记',
    category: has(o, 'category') ? asNoteCategory(o['category']) : NOTE_CATEGORIES[0],
    done: preset.done ?? false,
    blocks: has(o, 'blocks') ? normalizeBlocks(o['blocks'], projectId) : normalizeBlocks([{ type: 'p', text: '' }], projectId),
    createdAt: preset.createdAt ?? now,
    updatedAt: preset.updatedAt ?? preset.createdAt ?? now
  }
  await withLock(paths.note(projectId, id), () => writeNote(projectId, note))
  return note
}

/** 整条保存；创建时间保持文件里原来的，修改时间记为现在 */
export async function saveNote(projectId: ID, note: unknown): Promise<Note> {
  await assertProject(projectId)
  const o = asObject(note, '笔记')
  const id = asId(o['id'], '笔记 id')
  const title = asNoteTitle(o['title'])
  const category = asNoteCategory(o['category'])
  const done = asBoolean(o['done'], '完成')
  const blocks = normalizeBlocks(o['blocks'], projectId)
  return withLock(paths.note(projectId, id), async () => {
    const old = await readNote(projectId, id)
    if (!old) fail('笔记不存在')
    const saved: Note = { id, title, category, done, blocks, createdAt: old.createdAt, updatedAt: nowIso() }
    await writeNote(projectId, saved)
    return saved
  })
}

export async function deleteNote(projectId: ID, noteId: ID): Promise<void> {
  await assertProject(projectId)
  await withLock(paths.note(projectId, noteId), async () => {
    if (!(await exists(paths.note(projectId, noteId)))) fail('笔记不存在')
    await trash(paths.note(projectId, noteId))
  })
}

// ---------- 资料 ----------

export async function listAssets(projectId: ID): Promise<ProjectAsset[]> {
  await assertProject(projectId)
  return listStore<ProjectAsset>(assetStore(projectId))
}

export interface AssetMeta {
  name?: string
  category?: AssetCategory
  tags?: string[]
  addedAt?: string
  sourceLibraryId?: ID | null
}

/** 把图片加入项目资料；dedupe 为 true 时按内容去重 */
export async function addProjectAssets(
  projectId: ID,
  candidates: Candidate[],
  meta: (c: Candidate, index: number) => AssetMeta = () => ({}),
  dedupe = true
): Promise<AddResult<ProjectAsset>[]> {
  await assertProject(projectId)
  const metaOf = new Map(candidates.map((c, i) => [c, meta(c, i)]))
  return addToStore<ProjectAsset>(
    assetStore(projectId),
    candidates,
    (c, id, file) => {
      const m = metaOf.get(c) ?? {}
      return {
        id,
        name: m.name ?? c.name,
        file,
        category: m.category ?? '其他',
        tags: m.tags ?? [],
        width: c.info.width,
        height: c.info.height,
        format: c.info.format,
        bytes: c.buf.length,
        addedAt: m.addedAt ?? nowIso(),
        sourceLibraryId: m.sourceLibraryId ?? null
      }
    },
    dedupe
  )
}

export async function importAssets(projectId: ID, files: string[]): Promise<ProjectAsset[]> {
  await assertProject(projectId)
  const results = await addProjectAssets(projectId, await candidatesFromFiles(files))
  return results.filter((r) => r.isNew).map((r) => r.item)
}

export async function importAssetFromClipboard(projectId: ID): Promise<AddResult<ProjectAsset> | null> {
  await assertProject(projectId)
  const c = await candidateFromClipboard()
  if (!c) return null
  const [r] = await addProjectAssets(projectId, [c])
  return r
}

/** 全局库分类对应到资料分类 */
const LIB_TO_ASSET: Record<ImageCategory, AssetCategory> = {
  角色: '角色',
  怪物: '角色',
  场景: '场景',
  UI: 'UI',
  图标: '概念图',
  瓦片: '概念图',
  参考: '参考',
  其他: '其他'
}

/** 从全局库复制图片到本项目资料（记下来源；内容相同的不重复添加） */
export async function addAssetsFromLibrary(projectId: ID, libraryIds: ID[]): Promise<ProjectAsset[]> {
  await assertProject(projectId)
  const lib = libraryStore()
  const candidates: Candidate[] = []
  const meta = new Map<Candidate, AssetMeta>()
  for (const libId of [...new Set(libraryIds)]) {
    const img = await getImage(libId)
    if (!img) fail('全局库里没有这张图片')
    const buf = await fs.readFile(storedPath(lib, img))
    const c: Candidate = {
      buf,
      info: { format: img.format, ext: img.file.split('.').pop() ?? 'png', width: img.width, height: img.height },
      name: img.name
    }
    candidates.push(c)
    meta.set(c, { category: LIB_TO_ASSET[img.category] ?? '其他', tags: [...img.tags], sourceLibraryId: img.id })
  }
  const results = await addProjectAssets(projectId, candidates, (c) => meta.get(c) ?? {})
  return results.filter((r) => r.isNew).map((r) => r.item)
}

export async function updateAsset(projectId: ID, id: ID, patch: unknown): Promise<ProjectAsset> {
  await assertProject(projectId)
  const p = asObject(patch, '修改内容')
  const name = has(p, 'name') ? asLine(p['name'], '名称').trim() : undefined
  if (name !== undefined && !name) fail('名称不能为空')
  const category = has(p, 'category') ? asOneOf(p['category'], ASSET_CATEGORIES, '分类') : undefined
  const tags = has(p, 'tags') ? asStringList(p['tags'], '标签') : undefined
  return updateInStore<ProjectAsset>(assetStore(projectId), id, '资料不存在', (a) => ({
    ...a,
    ...(name !== undefined && { name }),
    ...(category !== undefined && { category }),
    ...(tags !== undefined && { tags })
  }))
}

/** 删除资料（原图移到废纸篓）；是封面时清掉封面。返回项目配置是否改动 */
export async function deleteAsset(projectId: ID, id: ID): Promise<{ projectChanged: boolean }> {
  await assertProject(projectId)
  await removeFromStore<ProjectAsset>(assetStore(projectId), id, '资料不存在')
  await dropThumbs(`prj.${projectId}.${id}.`)
  const projectChanged = await modifyJson<Project | null>(paths.projectFile(projectId), null, (p) => {
    if (!p || p.coverAssetId !== id) return false
    p.coverAssetId = null
    p.updatedAt = nowIso()
    return true
  })
  return { projectChanged }
}
