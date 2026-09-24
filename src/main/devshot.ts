// 开发截图：设置了环境变量 GAMEPANL_SHOT_DIR 时，窗口准备好后依次切到各个页面截图保存，然后退出。
//   GAMEPANL_SHOT_SAMPLE=1   先导入示例内容
//   GAMEPANL_LOG_CONSOLE=1   把界面的 console 消息和渲染进程异常打印到终端（不截图时也生效）
// 页面切换由界面提供的 window.__gpDev.go(route) 完成（projectId 省略 = 第一个项目）。
import { app } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'

const SHOTS: Array<{ name: string; route: Record<string, string> }> = [
  { name: 'library-images', route: { view: 'library', tab: 'images' } },
  { name: 'library-prompts', route: { view: 'library', tab: 'prompts' } },
  { name: 'library-styles', route: { view: 'library', tab: 'styles' } },
  { name: 'project-config', route: { view: 'project', tab: 'config' } },
  { name: 'project-notes', route: { view: 'project', tab: 'notes' } },
  { name: 'project-assets', route: { view: 'project', tab: 'assets' } }
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

async function capture(win: BrowserWindow, dir: string): Promise<void> {
  const wc = win.webContents
  await fs.mkdir(dir, { recursive: true })
  await wc.insertCSS(SHOT_CSS)
  if (process.env['GAMEPANL_SHOT_SAMPLE'] === '1') {
    await wc.executeJavaScript('window.gp.app.importSample()')
  }
  await delay(1500)
  if (!(await wc.executeJavaScript('typeof window.__gpDev === "object" && window.__gpDev !== null'))) {
    console.warn('[devshot] 界面没有提供 window.__gpDev，截到的都是当前页面')
  }
  for (const shot of SHOTS) {
    await wc.executeJavaScript(`window.__gpDev && window.__gpDev.go(${JSON.stringify(shot.route)})`)
    await delay(900)
    await waitForImages(win)
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
