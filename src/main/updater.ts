// 在线更新：到 GitHub Releases 查最新版本号，比当前版本新就通知界面；安装包下载到「下载」文件夹后由用户打开安装。
// 只做“检测 + 下载”：没有 Developer ID 签名和公证的应用，macOS 不允许在后台静默替换自己。
import { app, BrowserWindow, net, session, shell } from 'electron'
import type { DownloadItem } from 'electron'
import { basename, extname, join } from 'path'
import { UPDATE_STATE_CHANNEL } from '@shared/api'
import type { UpdateAsset, UpdateRelease, UpdateState } from '@shared/types'
import { LATEST_RELEASE_API, RELEASES_URL } from './meta'
import { getSettings, patchSettings } from './settings'
import { exists, nowIso } from './storage'
import { fail } from './validate'

const CHECK_TIMEOUT = 15_000
const AUTO_CHECK_DELAY = 8_000
const AUTO_CHECK_INTERVAL = 6 * 60 * 60_000

// ---------- 版本号 ----------

interface ParsedVersion {
  main: [number, number, number]
  pre: string[] | null
}

export function parseVersion(v: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return null
  return { main: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : null }
}

/** 语义化版本比较：a 比 b 旧返回 -1，新返回 1。预发布版本（1.2.0-beta.1）比同号正式版旧。 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return a.localeCompare(b)
  for (let i = 0; i < 3; i++) {
    if (pa.main[i] !== pb.main[i]) return pa.main[i] < pb.main[i] ? -1 : 1
  }
  if (!pa.pre && !pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  const n = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (nx) return -1
    else if (ny) return 1
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** 开发时可以用 GAMEPANL_FAKE_VERSION 假装成旧版本，方便看到「有新版本」的界面 */
function currentVersion(): string {
  const fake = process.env['GAMEPANL_FAKE_VERSION']
  return (!app.isPackaged && fake) || app.getVersion()
}

// ---------- GitHub 接口 ----------

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GhRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string | null
  assets: GhAsset[]
}

function isGhRelease(v: unknown): v is GhRelease {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o['tag_name'] === 'string' && typeof o['html_url'] === 'string' && Array.isArray(o['assets'])
}

/** 挑适合这台机器的安装包：先按芯片（arm64 / x64）匹配的 dmg，其次任意 dmg */
function pickAsset(assets: GhAsset[]): UpdateAsset | null {
  if (process.platform !== 'darwin') return null
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const other = arch === 'arm64' ? 'x64' : 'arm64'
  const dmgs = assets.filter((a) => /\.dmg$/i.test(a.name) && typeof a.browser_download_url === 'string')
  const mine =
    dmgs.find((a) => a.name.toLowerCase().includes(arch)) ??
    dmgs.find((a) => !a.name.toLowerCase().includes(other)) ??
    dmgs[0]
  return mine ? { name: mine.name, url: mine.browser_download_url, bytes: Number(mine.size) || 0 } : null
}

function toRelease(gh: GhRelease): UpdateRelease {
  const version = gh.tag_name.replace(/^v/i, '')
  return {
    version,
    name: gh.name?.trim() || `GamePanl ${version}`,
    notes: (gh.body ?? '').replace(/\r\n/g, '\n').trim(),
    url: gh.html_url,
    publishedAt: gh.published_at ?? nowIso(),
    asset: pickAsset(gh.assets)
  }
}

async function fetchLatestRelease(): Promise<UpdateRelease | null> {
  const res = await net.fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `GamePanl/${app.getVersion()}`
    },
    signal: AbortSignal.timeout(CHECK_TIMEOUT)
  })
  // 仓库还没有发布过任何正式版本
  if (res.status === 404) return null
  if (res.status === 403 || res.status === 429) throw new Error('向 GitHub 查询太频繁，请稍后再试')
  if (!res.ok) throw new Error(`GitHub 返回了 ${res.status}`)
  const json: unknown = await res.json()
  if (!isGhRelease(json)) throw new Error('GitHub 返回的数据格式不对')
  return toRelease(json)
}

function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/abort|timeout/i.test(msg)) return '连接 GitHub 超时，请稍后再试'
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|fetch failed|ENOTFOUND|ECONN/i.test(msg)) {
    return '无法连接到 GitHub，请检查网络'
  }
  return msg
}

// ---------- 状态 ----------

let state: UpdateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  release: null,
  progress: null,
  filePath: null,
  error: null,
  manual: false,
  autoCheck: true,
  lastCheckAt: null,
  skippedVersion: null
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(UPDATE_STATE_CHANNEL, state)
  }
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

export function getState(): UpdateState {
  return state
}

/** app ready 之后调用一次：读设置、接管本应用发起的下载 */
export async function initUpdater(): Promise<void> {
  const s = await getSettings()
  state = {
    ...state,
    currentVersion: currentVersion(),
    autoCheck: s.autoCheckUpdates,
    lastCheckAt: s.lastUpdateCheckAt,
    skippedVersion: s.skippedVersion
  }
  session.defaultSession.on('will-download', onWillDownload)
}

// ---------- 检查 ----------

let checking: Promise<UpdateState> | null = null

export function checkForUpdates(manual: boolean): Promise<UpdateState> {
  if (checking) return checking
  checking = runCheck(manual).finally(() => {
    checking = null
  })
  return checking
}

async function runCheck(manual: boolean): Promise<UpdateState> {
  // 正在下载或已经下载好时不打断
  if (state.phase === 'downloading' || state.phase === 'downloaded') {
    if (manual) setState({ manual: true })
    return state
  }
  setState({ phase: 'checking', manual, error: null })
  try {
    const release = await fetchLatestRelease()
    const lastCheckAt = nowIso()
    await patchSettings({ lastUpdateCheckAt: lastCheckAt })
    const newer = release !== null && compareVersions(release.version, state.currentVersion) > 0
    // 自动检查时尊重「跳过这个版本」；用户手动检查则照常提示
    const skipped = !manual && release !== null && release.version === state.skippedVersion
    if (newer && !skipped) {
      setState({ phase: 'available', release, lastCheckAt, progress: null, filePath: null })
    } else {
      setState({ phase: 'none', release: null, lastCheckAt, progress: null, filePath: null })
    }
  } catch (err) {
    setState({ phase: 'error', error: describeError(err), release: null, progress: null })
  }
  console.log(`[update] ${state.phase}${state.release ? ` ${state.release.version}` : ''}${state.error ? ` ${state.error}` : ''}`)
  return state
}

/** 启动后延迟检查一次，之后每 6 小时检查一次。开发时默认不检查（GAMEPANL_UPDATE_CHECK=1 打开，延迟 1.5 秒） */
export function startAutoCheck(): void {
  if (process.env['GAMEPANL_SHOT_DIR']) return
  if (!app.isPackaged && process.env['GAMEPANL_UPDATE_CHECK'] !== '1') return
  const run = (): void => {
    if (!state.autoCheck) return
    if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'downloaded') return
    void checkForUpdates(false)
  }
  setTimeout(run, app.isPackaged ? AUTO_CHECK_DELAY : 1500)
  setInterval(run, AUTO_CHECK_INTERVAL)
}

// ---------- 下载 ----------

let currentItem: DownloadItem | null = null
let pendingUrl: string | null = null
let pendingPath = ''

async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const stem = basename(name, ext)
  for (let i = 1; ; i++) {
    const candidate = join(dir, i === 1 ? name : `${stem} ${i}${ext}`)
    if (!(await exists(candidate))) return candidate
  }
}

export async function downloadUpdate(): Promise<void> {
  const release = state.release
  if (!release?.asset) fail('这个版本没有可下载的安装包')
  if (state.phase === 'downloading') return
  if (state.phase === 'downloaded' && state.filePath && (await exists(state.filePath))) return
  pendingUrl = release.asset.url
  pendingPath = await uniquePath(app.getPath('downloads'), release.asset.name)
  setState({ phase: 'downloading', progress: { received: 0, total: release.asset.bytes }, error: null, filePath: null })
  session.defaultSession.downloadURL(release.asset.url)
}

function onWillDownload(_event: Electron.Event, item: DownloadItem): void {
  // 只接管本模块发起的下载（GitHub 会重定向，所以看整条地址链）
  if (!pendingUrl || !item.getURLChain().includes(pendingUrl)) return
  pendingUrl = null
  currentItem = item
  item.setSavePath(pendingPath)
  const total = item.getTotalBytes() || state.progress?.total || 0
  let lastAt = 0
  item.on('updated', (_e, status) => {
    if (status !== 'progressing') return
    const now = Date.now()
    if (now - lastAt < 100) return
    lastAt = now
    setState({ progress: { received: item.getReceivedBytes(), total } })
  })
  item.once('done', (_e, status) => {
    currentItem = null
    if (status === 'completed') {
      setState({ phase: 'downloaded', filePath: item.getSavePath(), progress: { received: total, total } })
    } else if (status === 'cancelled') {
      setState({ phase: 'available', progress: null })
    } else {
      setState({ phase: 'error', progress: null, error: '下载中断了，请重试' })
    }
  })
}

export function cancelDownload(): void {
  currentItem?.cancel()
}

export async function openDownloaded(): Promise<void> {
  const file = state.filePath
  if (!file || !(await exists(file))) {
    setState({ phase: 'available', filePath: null, progress: null })
    fail('安装包不在了，请重新下载')
  }
  const error = await shell.openPath(file)
  if (error) fail(error)
}

export async function revealDownloaded(): Promise<void> {
  const file = state.filePath
  if (!file || !(await exists(file))) {
    setState({ phase: 'available', filePath: null, progress: null })
    fail('安装包不在了，请重新下载')
  }
  shell.showItemInFolder(file)
}

export async function openReleasePage(): Promise<void> {
  await shell.openExternal(state.release?.url ?? RELEASES_URL)
}

// ---------- 设置 ----------

export async function skipVersion(version: string): Promise<void> {
  await patchSettings({ skippedVersion: version })
  const patch: Partial<UpdateState> = { skippedVersion: version }
  if (state.phase === 'available' && state.release?.version === version) {
    patch.phase = 'none'
    patch.release = null
  }
  setState(patch)
}

export async function setAutoCheck(on: boolean): Promise<void> {
  await patchSettings({ autoCheckUpdates: on })
  setState({ autoCheck: on })
}
