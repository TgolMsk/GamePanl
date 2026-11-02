// 开发截图：设置了环境变量 GAMEPANL_SHOT_DIR 时，窗口准备好后依次切到各个页面截图保存，然后退出。
//   GAMEPANL_SHOT_SAMPLE=1   先导入示例内容
//   GAMEPANL_LOG_CONSOLE=1   把界面的 console 消息和渲染进程异常打印到终端（不截图时也生效）
//   GAMEPANL_SHOT_SPRITES=<视频或文件夹路径，多个用逗号分隔>   先导入到第一个项目的序列帧（截序列帧页面时等处理完）
//   GAMEPANL_SHOT_SPRITES_EXPORT=<目录>   截完序列帧页面后点「导出…」导出到这个目录
// 页面切换由界面提供的 window.__gpDev.go(route) 完成（projectId 省略 = 第一个项目）。
import { app } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'

const SHOTS: Array<{ name: string; route: Record<string, string> }> = [
  { name: 'library-images', route: { view: 'library', tab: 'images' } },
  { name: 'library-models', route: { view: 'library', tab: 'models' } },
  { name: 'library-prompts', route: { view: 'library', tab: 'prompts' } },
  { name: 'library-styles', route: { view: 'library', tab: 'styles' } },
  { name: 'project-config', route: { view: 'project', tab: 'config' } },
  { name: 'project-notes', route: { view: 'project', tab: 'notes' } },
  { name: 'project-assets', route: { view: 'project', tab: 'assets' } },
  { name: 'project-models', route: { view: 'project', tab: 'models' } },
  { name: 'project-sprites', route: { view: 'project', tab: 'sprites' } }
]

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// capturePage 截不到窗口的毛玻璃（vibrancy），透明的侧栏会变成黑色；截图时侧栏换成不透明的备用底色
const SHOT_CSS = '.sidebar { background: var(--side-fallback) !important; }'

// 屏幕上的图片都加载完（缩略图第一次要现生成），最多等 10 秒
const IMAGES_READY = `(() => {
  const inView = (img) => {
    const r = img.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  }
  return [...document.images].filter(inView).every((img) => img.complete)
})()`

async function waitForImages(win: BrowserWindow): Promise<void> {
  for (let waited = 0; waited < 10_000; waited += 200) {
    if (await win.webContents.executeJavaScript(IMAGES_READY)) return
    await delay(200)
  }
  console.warn('[devshot] 有图片 10 秒内没加载完')
}

// 序列帧页面：等处理完（帧条出现、没有「正在…」提示），最多等 30 秒
async function waitForSprites(win: BrowserWindow): Promise<void> {
  const ready = `!!document.querySelector('.sp-fr') && !document.querySelector('.sp-view .sp-msg')`
  for (let waited = 0; waited < 30_000; waited += 300) {
    if (await win.webContents.executeJavaScript(ready)) {
      await delay(600)
      return
    }
    await delay(300)
  }
  console.warn('[devshot] 序列帧 30 秒内没处理完')
}

// 在界面上点「导出…」→「导出」（导出位置先写进角色的导出设置）
async function exportSprites(win: BrowserWindow, dir: string): Promise<void> {
  const wc = win.webContents
  await wc.executeJavaScript(`(async () => {
    const ps = await window.gp.projects.list()
    const cs = await window.gp.sprites.list(ps[0].id)
    await window.gp.sprites.update(ps[0].id, cs[0].id, { exportPrefs: { ...cs[0].exportPrefs, dir: ${JSON.stringify(dir)} } })
  })()`)
  await delay(800)
  const click = (text: string, scope: string): Promise<boolean> =>
    wc.executeJavaScript(
      `(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled); if (b) b.click(); return !!b })()`
    )
  if (!(await click('导出…', '.toolbar'))) console.warn('[devshot] 找不到「导出…」按钮')
  await delay(1200)
  const shotFile = join(resolve(process.env['GAMEPANL_SHOT_DIR'] ?? '.'), 'project-sprites-export.png')
  await fs.writeFile(shotFile, (await wc.capturePage()).toPNG())
  if (!(await click('导出', '.sheet'))) console.warn('[devshot] 找不到导出面板的「导出」按钮')
  await delay(3000)
  console.log(`[devshot] 导出到 ${dir}`)
}

async function capture(win: BrowserWindow, dir: string): Promise<void> {
  const wc = win.webContents
  await fs.mkdir(dir, { recursive: true })
  await wc.insertCSS(SHOT_CSS)
  if (process.env['GAMEPANL_SHOT_SAMPLE'] === '1') {
    await wc.executeJavaScript('window.gp.app.importSample()')
  }
  const spritePaths = process.env['GAMEPANL_SHOT_SPRITES']
  if (spritePaths) {
    await wc.executeJavaScript(
      `window.gp.projects.list().then((ps) => ps[0] && window.gp.sprites.create(ps[0].id, ${JSON.stringify(spritePaths.split(','))}))`
    )
  }
  await delay(1500)
  if (!(await wc.executeJavaScript('typeof window.__gpDev === "object" && window.__gpDev !== null'))) {
    console.warn('[devshot] 界面没有提供 window.__gpDev，截到的都是当前页面')
  }
  for (const shot of SHOTS) {
    await wc.executeJavaScript(`window.__gpDev && window.__gpDev.go(${JSON.stringify(shot.route)})`)
    await delay(900)
    await waitForImages(win)
    if (shot.name === 'project-sprites') await waitForSprites(win)
    const exportDir = process.env['GAMEPANL_SHOT_SPRITES_EXPORT']
    if (shot.name === 'project-sprites' && exportDir) await exportSprites(win, exportDir)
    // 鼠标恰好停在窗口上时会带出卡片的悬停状态；截图前把指针挪到工具栏标题上
    wc.sendInputEvent({ type: 'mouseMove', x: 260, y: 26 })
    await delay(150)
    const image = await wc.capturePage()
    const file = join(dir, `${shot.name}.png`)
    await fs.writeFile(file, image.toPNG())
    console.log(`[devshot] ${file}`)
  }
}

function logConsole(wc: WebContents): void {
  wc.on('console-message', (e) => {
    const where = e.sourceId ? ` (${e.sourceId}:${e.lineNumber})` : ''
    console.log(`[renderer:${e.level}] ${e.message}${where}`)
  })
  wc.on('preload-error', (_e, path, error) => console.error(`[preload] ${path}:`, error))
  wc.on('render-process-gone', (_e, details) => console.error('[renderer] 进程退出:', details.reason))
  wc.on('did-fail-load', (_e, code, desc, url) => console.error(`[renderer] 加载失败 ${code} ${desc}: ${url}`))
}

/** 在 app ready 之前调用 */
export function setupDevShot(): void {
  if (process.env['GAMEPANL_LOG_CONSOLE'] === '1') {
    app.on('browser-window-created', (_event, win) => logConsole(win.webContents))
  }
  const dirEnv = process.env['GAMEPANL_SHOT_DIR']
  if (!dirEnv) return
  const dir = resolve(dirEnv)
  // 窗口被别的窗口挡住时页面会被当成不可见，懒加载的图片就不加载了
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.once('browser-window-created', (_event, win) => {
    win.setSize(1440, 900)
    win.setResizable(false)
    win.once('ready-to-show', () => {
      capture(win, dir).then(
        () => app.quit(),
        (err: unknown) => {
          console.error('[devshot] 截图失败:', err)
          app.exit(1)
        }
      )
    })
  })
}
