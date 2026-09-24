// 数据目录与底层读写：路径、JSON 原子写（同一文件排队）、读写锁、id、移到废纸篓。
import { shell } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { asId } from './validate'

let root = ''

/** 数据根目录：环境变量 GAMEPANL_DATA_ROOT，默认 ~/GamePanl */
export function dataRoot(): string {
  if (!root) root = resolve(process.env['GAMEPANL_DATA_ROOT'] || join(homedir(), 'GamePanl'))
  return root
}

export const paths = {
  library: () => join(dataRoot(), 'library'),
  libImagesDir: () => join(dataRoot(), 'library', 'images'),
  libImages: () => join(dataRoot(), 'library', 'images.json'),
  libHashes: () => join(dataRoot(), 'library', 'hashes.json'),
  prompts: () => join(dataRoot(), 'library', 'prompts.json'),
  styles: () => join(dataRoot(), 'library', 'styles.json'),
  projects: () => join(dataRoot(), 'projects'),
  project: (id: string) => join(dataRoot(), 'projects', asId(id, '项目 id')),
  projectFile: (id: string) => join(paths.project(id), 'project.json'),
  notesDir: (id: string) => join(paths.project(id), 'notes'),
  note: (id: string, noteId: string) => join(paths.notesDir(id), `${asId(noteId, '笔记 id')}.md`),
  assetsDir: (id: string) => join(paths.project(id), 'assets'),
  assets: (id: string) => join(paths.project(id), 'assets.json'),
  assetHashes: (id: string) => join(paths.project(id), 'hashes.json'),
  thumbs: () => join(dataRoot(), '.cache', 'thumbs')
}

export async function initStorage(): Promise<void> {
  await fs.mkdir(paths.libImagesDir(), { recursive: true })
  await fs.mkdir(paths.projects(), { recursive: true })
  await fs.mkdir(paths.thumbs(), { recursive: true })
  for (const file of [paths.libImages(), paths.prompts(), paths.styles()]) {
    if (!(await exists(file))) await writeJson(file, [])
  }
}

// ---------- 基础工具 ----------

export function nowIso(): string {
  return new Date().toISOString()
}

/** 新 id：randomUUID 的前 12 位十六进制（只含 [a-z0-9]），与已有 id 重复时重取 */
export function newId(taken?: (id: string) => boolean): string {
  for (;;) {
    const id = randomUUID().replace(/-/g, '').slice(0, 12)
    if (!taken || !taken(id)) return id
  }
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

export function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** 移到系统废纸篓；文件已经不在时什么也不做 */
export async function trash(path: string): Promise<void> {
  if (await exists(path)) await shell.trashItem(path)
}

// ---------- 锁与原子写 ----------

const locks = new Map<string, Promise<void>>()

/** 同一个 key 上的操作依次执行（读-改-写整段加锁，避免并发时丢更新） */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  locks.set(key, tail)
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key)
  })
  return run
}

const writeQueues = new Map<string, Promise<void>>()

/** 原子写：先写同目录的临时文件再 rename；同一文件的写入排队执行 */
export function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const prev = writeQueues.get(file) ?? Promise.resolve()
  const run = prev.then(async () => {
    const dir = dirname(file)
    await fs.mkdir(dir, { recursive: true })
    const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`)
    try {
      await fs.writeFile(tmp, data)
      await fs.rename(tmp, file)
    } catch (err) {
      await fs.rm(tmp, { force: true })
      throw err
    }
  })
  const tail = run.catch(() => undefined)
  writeQueues.set(file, tail)
  void tail.then(() => {
    if (writeQueues.get(file) === tail) writeQueues.delete(file)
  })
  return run
}

// ---------- JSON ----------

interface CacheEntry {
  ino: number
  mtimeMs: number
  size: number
  data: unknown
}

// 读缓存：以 inode + 修改时间 + 大小判断文件是否变过（原子写每次都会换 inode）
const jsonCache = new Map<string, CacheEntry>()

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let st
  try {
    st = await fs.stat(file)
  } catch (err) {
    if (isNotFound(err)) return fallback
    throw err
  }
  const hit = jsonCache.get(file)
  if (hit && hit.ino === st.ino && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    return structuredClone(hit.data) as T
  }
  const text = await fs.readFile(file, 'utf8')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`数据文件格式错误，无法读取：${file}`)
  }
  jsonCache.set(file, { ino: st.ino, mtimeMs: st.mtimeMs, size: st.size, data })
  return structuredClone(data) as T
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n')
  jsonCache.delete(file)
}

/** 加锁读-改-写一个 JSON 文件；fn 返回 false 时不写回 */
export function modifyJson<T>(file: string, fallback: T, fn: (data: T) => boolean | Promise<boolean>): Promise<boolean> {
  return withLock(file, async () => {
    const data = await readJson(file, fallback)
    const changed = await fn(data)
    if (changed) await writeJson(file, data)
    return changed
  })
}

/** 加锁读-改-写一个 JSON 文件 */
export function updateJson<T, R>(file: string, fallback: T, fn: (data: T) => R | Promise<R>): Promise<R> {
  return withLock(file, async () => {
    const data = await readJson(file, fallback)
    const result = await fn(data)
    await writeJson(file, data)
    return result
  })
}
