// 序列帧「在软件里生成」：视频走本机的百炼命令行 bl（万相 3.0，定妆照当首帧，单次动作首尾帧都用它），
// 人物图走本机的 codex（ChatGPT 订阅自带的生图）。任务在内存里排队，关掉软件就清空；
// 已经交给百炼的任务中途取消、或关掉软件，百炼那边照样会算钱。
import { spawn, type ChildProcess } from 'child_process'
import { constants as fsConstants, promises as fs } from 'fs'
import { homedir, tmpdir } from 'os'
import { delimiter, dirname, join } from 'path'
import {
  DEFAULT_GEN_SETTINGS,
  estimateVideoCost,
  SPRITE_VIDEO_MODELS,
  SPRITE_VIDEO_RESOLUTIONS,
  type SpriteGenSettings,
  type SpriteGenTools,
  type SpriteJob,
  type SpriteJobState,
  type SpriteVideoModel,
  type SpriteVideoResolution
} from '@shared/spriteGen'
import {
  actionFacing,
  actionTag,
  buildAnchorPrompt,
  buildDesignPrompt,
  buildSpritePrompt,
  SPRITE_FACING_LABELS,
  type SpriteAspect,
  type SpriteFacing,
  type SpriteOwner
} from '@shared/sprites'
import type { ID } from '@shared/types'
import { candidateFromFile } from './images'
import { getSettings, patchSettings } from './settings'
import { spriteChanged, spriteEvent } from './spriteEvents'
import { addRefImage, addTakeFile, getCharacter, refPath, stylePrompt } from './sprites'
import { exists, newId, nowIso } from './storage'
import { asObject, fail } from './validate'

const NO_BL = '没找到百炼命令行 bl：先在终端安装并登录（npm i -g bailian-cli，然后 bl auth login --console）'
const NO_CODEX = '没找到 codex：先在终端安装并登录 ChatGPT（npm i -g @openai/codex，然后 codex login）'
/** 同时画几张人物图（codex 一张要一两分钟，多开容易被限流） */
const IMAGE_CONCURRENCY = 1

// ---------- 设置 ----------

export function normalizeGenSettings(raw: unknown): SpriteGenSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const int = (v: unknown, min: number, max: number, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d
  const models = Object.keys(SPRITE_VIDEO_MODELS) as SpriteVideoModel[]
  return {
    videoModel: models.includes(o['videoModel'] as SpriteVideoModel) ? (o['videoModel'] as SpriteVideoModel) : DEFAULT_GEN_SETTINGS.videoModel,
    resolution: SPRITE_VIDEO_RESOLUTIONS.includes(o['resolution'] as SpriteVideoResolution) ? (o['resolution'] as SpriteVideoResolution) : DEFAULT_GEN_SETTINGS.resolution,
    duration: int(o['duration'], 2, 10, DEFAULT_GEN_SETTINGS.duration),
    takes: int(o['takes'], 1, 4, DEFAULT_GEN_SETTINGS.takes),
    concurrency: int(o['concurrency'], 1, 4, DEFAULT_GEN_SETTINGS.concurrency),
    inbox: typeof o['inbox'] === 'boolean' ? o['inbox'] : DEFAULT_GEN_SETTINGS.inbox
  }
}

export async function genSettings(): Promise<SpriteGenSettings> {
  return normalizeGenSettings((await getSettings()).spriteGen)
}

export async function setGenSettings(patch: unknown): Promise<SpriteGenSettings> {
  const next = normalizeGenSettings({ ...(await genSettings()), ...asObject(patch, '生成设置') })
  await patchSettings({ spriteGen: next })
  pump()
  return next
}

// ---------- 找命令行工具 ----------

const HOME = homedir()
const EXTRA_PATH = [join(HOME, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', join(HOME, '.npm-global/bin'), join(HOME, '.volta/bin'), join(HOME, '.bun/bin')]
/** 从登录 shell 里取的变量：PATH（bl、codex 都是 node 脚本）、代理、codex 和百炼自己的配置 */
const SHELL_KEYS = /^(PATH|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|https?_proxy|all_proxy|no_proxy|CODEX_HOME|DASHSCOPE_[A-Z0-9_]+|NODE_EXTRA_CA_CERTS)$/
let envCache: Promise<NodeJS.ProcessEnv> | null = null

/** 从程序坞打开的应用拿不到终端里配的 PATH 和代理：跑一次登录 shell 把这几个变量读出来 */
function toolEnv(): Promise<NodeJS.ProcessEnv> {
  envCache ??= (async () => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    const mark = '__GAMEPANL_ENV__'
    const r = await run(process.env['SHELL'] || '/bin/zsh', ['-ilc', `echo ${mark}; env; echo ${mark}`], { env: process.env, timeoutMs: 8000 }).catch(() => null)
    for (const line of (r?.stdout.split(mark)[1] ?? '').split('\n')) {
      const i = line.indexOf('=')
      if (i > 0 && SHELL_KEYS.test(line.slice(0, i))) env[line.slice(0, i)] = line.slice(i + 1)
    }
    env['PATH'] = [...new Set([...(env['PATH'] ?? '').split(delimiter), ...EXTRA_PATH])].filter(Boolean).join(delimiter)
    return env
  })()
  return envCache
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.X_OK)
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

async function findTool(name: 'bl' | 'codex'): Promise<string | null> {
  const override = process.env[name === 'bl' ? 'GAMEPANL_BL' : 'GAMEPANL_CODEX']
  if (override) return (await isExecutable(override)) ? override : null
  for (const dir of ((await toolEnv())['PATH'] ?? '').split(delimiter)) {
    if (dir && (await isExecutable(join(dir, name)))) return join(dir, name)
  }
  return null
}

export async function tools(): Promise<SpriteGenTools> {
  const [bl, codex] = await Promise.all([findTool('bl'), findTool('codex')])
  return { bl, codex }
}

// ---------- 跑子进程 ----------

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const MAX_OUTPUT = 4 * 1024 * 1024

function run(cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd?: string; timeoutMs: number; onSpawn?: (p: ChildProcess) => void; onLine?: (line: string) => void }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // 单独一个进程组：取消时连 bl、codex 起的子进程一起结束
    const p = spawn(cmd, args, { env: opts.env, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    opts.onSpawn?.(p)
    let stdout = ''
    let stderr = ''
    let partial = ''
    let timedOut = false
    p.stdout?.setEncoding('utf8').on('data', (d: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += d
      if (!opts.onLine) return
      const lines = (partial + d).split('\n')
      partial = lines.pop() ?? ''
      for (const l of lines) opts.onLine(l)
    })
    p.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr = (stderr + d).slice(-64 * 1024)
    })
    const timer = setTimeout(() => {
      timedOut = true
      killTree(p)
    }, opts.timeoutMs)
    p.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (partial && opts.onLine) opts.onLine(partial)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

function killTree(p: ChildProcess): void {
  if (p.exitCode !== null || p.signalCode !== null) return
  try {
    if (p.pid) process.kill(-p.pid, 'SIGTERM')
  } catch {
    p.kill('SIGTERM')
  }
}

/** 输出里最后一句有用的话（去掉 node 的实验特性警告） */
function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('(node:') && !l.startsWith('(Use `node') && !l.startsWith('Reading additional input'))
  return (lines[lines.length - 1] ?? '').slice(0, 300)
}

// ---------- 任务 ----------

interface TaskBase {
  job: SpriteJob
  /** 运行中被取消：结束子进程，结果作废 */
  canceled: boolean
}
interface VideoTask extends TaskBase {
  kind: 'video'
  model: SpriteVideoModel
  resolution: SpriteVideoResolution
  duration: number
}
interface ImageTask extends TaskBase {
  kind: 'image'
  mode: 'design' | 'anchor'
}
type Task = VideoTask | ImageTask

const tasks: Task[] = []
const procs = new Map<ID, ChildProcess>()

export function listJobs(): SpriteJob[] {
  return tasks.map((t) => ({ ...t.job }))
}

function emitJobs(): void {
  spriteEvent({ type: 'jobs', jobs: listJobs() })
}

function newJob(owner: SpriteOwner, characterId: ID, characterName: string, kind: SpriteJob['kind'], actionId: ID | null, facing: SpriteFacing | null, label: string, cost: number): SpriteJob {
  return { id: newId(), kind, owner, characterId, characterName, actionId, facing, label, state: 'queued', message: '排队中', cost, createdAt: nowIso(), startedAt: null, finishedAt: null, resultId: null }
}

/** 用定妆照生成动作视频：每个动作 takes 个版本。动作要用的朝向必须有定妆照 */
export async function generateVideos(owner: SpriteOwner, id: ID, actionIds: ID[], takes?: number): Promise<SpriteJob[]> {
  if (actionIds.length === 0) fail('没有要生成的动作')
  if (actionIds.length > 60) fail('一次最多生成 60 个动作')
  if (!(await findTool('bl'))) fail(NO_BL)
  const s = await genSettings()
  const n = takes === undefined ? s.takes : Math.min(4, Math.max(1, Math.round(takes)))
  const ch = await getCharacter(owner, id)
  const list: VideoTask[] = []
  for (const actionId of [...new Set(actionIds)]) {
    const a = ch.actions.find((x) => x.id === actionId)
    if (!a) fail('动作不存在了')
    if (!buildSpritePrompt(ch, a).firstFrame) fail(`「${a.name}」要用的${SPRITE_FACING_LABELS[actionFacing(ch.view, a.name)]}定妆照还没做`)
    for (let k = 1; k <= n; k++) {
      const job = newJob(owner, ch.id, ch.name, 'video', a.id, null, n > 1 ? `${a.name} · ${k}/${n}` : a.name, estimateVideoCost(s, 1))
      list.push({ kind: 'video', job, canceled: false, model: s.videoModel, resolution: s.resolution, duration: s.duration })
    }
  }
  tasks.push(...list)
  emitJobs()
  pump()
  return list.map((t) => ({ ...t.job }))
}

/** 用 codex 画一张人物图：design 按人物描述（和项目风格）从零画设定图；anchor 照着主图画标准站姿的定妆照草稿 */
export async function generateImage(owner: SpriteOwner, id: ID, facing: SpriteFacing, mode: 'design' | 'anchor'): Promise<SpriteJob> {
  if (!(await findTool('codex'))) fail(NO_CODEX)
  const ch = await getCharacter(owner, id)
  if (mode === 'anchor' && ch.refs.length === 0) fail('先添加一张人物图，或改用「按描述画」')
  if (mode === 'design' && !ch.description.trim() && !(await stylePrompt(owner))) fail('先写人物描述（长相、服装、配色），AI 才知道画什么')
  const label = `${mode === 'design' ? '设定图' : '定妆照草稿'} · ${SPRITE_FACING_LABELS[facing]}`
  const t: ImageTask = { kind: 'image', job: newJob(owner, ch.id, ch.name, 'image', null, facing, label, 0), canceled: false, mode }
  tasks.push(t)
  emitJobs()
  pump()
  return { ...t.job }
}

export function cancelJob(jobId: ID): void {
  const t = tasks.find((x) => x.job.id === jobId)
  if (!t) return
  if (t.job.state === 'queued') {
    end(t, 'canceled', '已取消')
    pump()
  } else if (t.job.state === 'running') {
    t.canceled = true
    t.job.message = '正在取消…'
    emitJobs()
    const p = procs.get(jobId)
    if (p) killTree(p)
  }
}

/** 清掉已结束的任务 */
export function clearJobs(): void {
  for (let i = tasks.length - 1; i >= 0; i--) if (!['queued', 'running'].includes(tasks[i].job.state)) tasks.splice(i, 1)
  emitJobs()
}

/** 退出软件时结束还在跑的子进程 */
export function stopAllJobs(): void {
  for (const p of procs.values()) killTree(p)
}

function end(t: Task, state: SpriteJobState, message: string, resultId: ID | null = null): void {
  t.job.state = state
  t.job.message = message
  t.job.resultId = resultId
  t.job.finishedAt = nowIso()
  emitJobs()
}

function pump(): void {
  void genSettings().then((s) => {
    let videos = tasks.filter((t) => t.kind === 'video' && t.job.state === 'running').length
    let images = tasks.filter((t) => t.kind === 'image' && t.job.state === 'running').length
    for (const t of tasks) {
      if (t.job.state !== 'queued') continue
      if (t.kind === 'video' ? videos >= s.concurrency : images >= IMAGE_CONCURRENCY) continue
      if (t.kind === 'video') videos++
      else images++
      start(t)
    }
  })
}

function start(t: Task): void {
  t.job.state = 'running'
  t.job.startedAt = nowIso()
  t.job.message = t.kind === 'video' ? '生成中，一般要几分钟' : '画图中，一般要一两分钟'
  emitJobs()
  const work = t.kind === 'video' ? runVideo(t) : runImage(t)
  work.then(
    (resultId) => end(t, 'done', '', resultId),
    (err) => end(t, t.canceled ? 'canceled' : 'failed', t.canceled ? '已取消' : err instanceof Error ? err.message : String(err))
  ).finally(pump)
}

async function jobDir(jobId: ID): Promise<string> {
  const dir = join(tmpdir(), 'gamepanl-gen', jobId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function runTool(t: Task, exe: string, args: string[], cwd: string, timeoutMs: number, onLine?: (line: string) => void): Promise<RunResult> {
  if (t.canceled) throw new Error('已取消')
  const base = await toolEnv()
  // bl、codex 是 node 脚本：把它们所在的目录放到 PATH 最前面，找到同一套 node
  const env = { ...base, PATH: [dirname(exe), base['PATH']].filter(Boolean).join(delimiter), NODE_NO_WARNINGS: '1' }
  try {
    return await run(exe, args, { env, cwd, timeoutMs, onLine, onSpawn: (p) => procs.set(t.job.id, p) })
  } finally {
    procs.delete(t.job.id)
  }
}

// ---------- 视频：bl video generate ----------

/** bl 的退出码 */
const BL_EXIT: Record<number, string> = {
  3: '百炼没登录或密钥失效：在终端运行 bl auth login --console',
  4: '百炼额度不够或请求太频繁，稍后再试',
  5: '百炼那边等太久超时了',
  6: '连不上百炼，检查一下网络',
  7: '百炼要求先确认：在终端里运行一次 bl 看看提示',
  10: '内容审核没通过：改改人物描述或动作说明再试'
}

function blError(r: RunResult): string {
  if (r.timedOut) return '等了 40 分钟还没生成完，已停止'
  let detail = lastLine(r.stderr) || lastLine(r.stdout)
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.lastIndexOf('{"'))) as { error?: { message?: string } | string; message?: string }
    detail = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? detail
  } catch {
    // 不是 JSON，用最后一行
  }
  const known = r.code === null ? undefined : BL_EXIT[r.code]
  if (known) return detail ? `${known}（${detail}）` : known
  return detail || `bl 出错了（退出码 ${r.code}）`
}

async function runVideo(t: VideoTask): Promise<ID> {
  const { job } = t
  const bl = await findTool('bl')
  if (!bl) throw new Error(NO_BL)
  const ch = await getCharacter(job.owner, job.characterId)
  const a = ch.actions.find((x) => x.id === job.actionId)
  if (!a) throw new Error('动作不存在了')
  const p = buildSpritePrompt(ch, a)
  if (!p.firstFrame) throw new Error('这个动作要用的定妆照没有了')
  const image = await refPath(job.owner, ch.id, p.firstFrame.id)
  if (!image) throw new Error('定妆照文件不见了')
  const dir = await jobDir(job.id)
  const out = join(dir, 'video.mp4')
  const args = [
    'video', 'generate',
    '--model', t.model,
    ...(t.model === 'wan3.0-video-prime' ? ['--prime'] : []),
    '--prompt', p.prompt,
    '--negative-prompt', p.negative,
    '--image', image,
    ...(p.lastFrame ? ['--last-frame', image] : []),
    '--resolution', t.resolution,
    '--duration', String(t.duration),
    '--prompt-extend', 'false',
    '--watermark', 'false',
    '--download', out,
    '--output', 'json',
    '--timeout', '2400'
  ]
  try {
    const r = await runTool(t, bl, args, dir, 40 * 60_000)
    if (t.canceled) throw new Error('已取消')
    if (r.code !== 0) throw new Error(blError(r))
    if (!(await exists(out))) throw new Error('百炼说生成好了，但视频没下载下来')
    const added = await addTakeFile(job.owner, ch.id, a.id, out, { prompt: p.prompt, via: 'generate', sourceName: `wan-${actionTag(a)}-${job.id.slice(0, 6)}.mp4` }, false)
    if (!added) throw new Error('这个视频已经在动作里了')
    spriteChanged(job.owner)
    return added.take.id
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

// ---------- 人物图：codex exec ----------

/** 画幅 → 让 codex 画的尺寸 */
const IMAGE_SIZE: Record<SpriteAspect, string> = {
  '16:9': 'landscape 16:9, 1536x864',
  '9:16': 'portrait 9:16, 864x1536',
  '1:1': 'square 1:1, 1024x1024',
  '4:3': 'landscape 4:3, 1365x1024',
  '3:4': 'portrait 3:4, 1024x1365'
}

function threadId(line: string): string {
  if (!line.includes('thread.started')) return ''
  try {
    const j = JSON.parse(line) as { type?: string; thread_id?: string }
    return j.type === 'thread.started' && typeof j.thread_id === 'string' && /^[\w-]+$/.test(j.thread_id) ? j.thread_id : ''
  } catch {
    return ''
  }
}

/** codex 把生成的图存在 ~/.codex/generated_images/<会话 id>/ 下；找不到时看输出里提到的 png 路径 */
async function findCodexImage(thread: string, stdout: string): Promise<string | null> {
  const home = (await toolEnv())['CODEX_HOME'] || join(HOME, '.codex')
  if (thread) {
    const dir = join(home, 'generated_images', thread)
    const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
    let best: { path: string; at: number } | null = null
    for (const n of names) {
      const st = await fs.stat(join(dir, n)).catch(() => null)
      if (st?.isFile() && (!best || st.mtimeMs > best.at)) best = { path: join(dir, n), at: st.mtimeMs }
    }
    if (best) return best.path
  }
  for (const m of stdout.matchAll(/\/[^\s"'\\]+\.png/g)) if (await exists(m[0])) return m[0]
  return null
}

function codexError(r: RunResult): string {
  if (r.timedOut) return '画了 10 分钟还没画完，已停止'
  for (const line of r.stdout.split('\n').reverse()) {
    if (!line.includes('"error"') && !line.includes('turn.failed')) continue
    try {
      const j = JSON.parse(line) as { message?: string; error?: { message?: string } }
      const msg = j.error?.message ?? j.message
      if (msg) return `codex 出错了：${msg.slice(0, 300)}`
    } catch {
      // 跳过
    }
  }
  const detail = lastLine(r.stderr)
  return detail ? `codex 出错了：${detail}` : `codex 出错了（退出码 ${r.code}）`
}

async function runImage(t: ImageTask): Promise<ID> {
  const { job } = t
  const facing = job.facing as SpriteFacing
  const codex = await findTool('codex')
  if (!codex) throw new Error(NO_CODEX)
  const ch = await getCharacter(job.owner, job.characterId)
  let source: string | null = null
  if (t.mode === 'anchor') {
    const ref = ch.refs.find((r) => r.id === ch.mainRef) ?? ch.refs[0]
    if (!ref) throw new Error('人物素材里没有图了')
    source = await refPath(job.owner, ch.id, ref.id)
    if (!source) throw new Error('人物图文件不见了')
  }
  const prompt = t.mode === 'design' ? buildDesignPrompt(ch, facing, await stylePrompt(job.owner)) : buildAnchorPrompt(ch, facing)
  const instruction = [
    `Use your built-in image generation tool to create exactly one image (${IMAGE_SIZE[ch.frameSetup.aspect]}).`,
    source ? 'The attached image shows the character: keep the same character design (face, hair, outfit, colors, body proportions).' : '',
    'Do not run shell commands and do not create or edit files. After the image is generated, reply only DONE.',
    'Image description (in Chinese):',
    prompt
  ]
    .filter(Boolean)
    .join('\n')
  const dir = await jobDir(job.id)
  let thread = ''
  const args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '-C', dir, '-c', 'model_reasoning_effort="low"', '--json', instruction, ...(source ? ['-i', source] : [])]
  try {
    const r = await runTool(t, codex, args, dir, 10 * 60_000, (line) => {
      thread ||= threadId(line)
    })
    if (t.canceled) throw new Error('已取消')
    if (r.code !== 0) throw new Error(codexError(r))
    const file = await findCodexImage(thread, r.stdout)
    if (!file) throw new Error('codex 没有画出图：可能没调用生图，或 ChatGPT 的生图额度用完了')
    const cand = await candidateFromFile(file)
    if (!cand) throw new Error('读不出 codex 画的图')
    const { ref } = await addRefImage(job.owner, ch.id, { ...cand, name: job.label.replace(' · ', '·') })
    if (!ref) throw new Error('这张图已经在人物素材里了')
    spriteChanged(job.owner)
    return ref.id
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
