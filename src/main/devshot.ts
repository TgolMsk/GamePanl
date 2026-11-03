// 开发截图：设置了环境变量 GAMEPANL_SHOT_DIR 时，窗口准备好后依次切到各个页面截图保存，然后退出。
//   GAMEPANL_SHOT_SAMPLE=1   先导入示例内容
//   GAMEPANL_SHOT_LAYOUT=1   额外截三种尺寸和序列帧弹出面板，检查布局并保存 layout-report.txt
//   GAMEPANL_LOG_CONSOLE=1   把界面的 console 消息和渲染进程异常打印到终端（不截图时也生效）
//   GAMEPANL_SHOT_ASSETS2D=<文件夹路径，多个用逗号分隔>   先导入 2D 资产，加入第一个项目，截图时选中第一项
//   GAMEPANL_SHOT_SPRITES=<视频或文件夹路径，多个用逗号分隔>   先导入到第一个项目和全局库的序列帧（截序列帧页面时等处理完）
//   GAMEPANL_SHOT_SPRITES_EXPORT=<目录>   截完序列帧页面后点「导出…」导出到这个目录
//   GAMEPANL_SHOT_SPRITES_REF=<人物图路径>   配合下一项：加进人物素材，在人物素材页做定妆照（拍定妆照面板）
//   GAMEPANL_SHOT_SPRITES_SCENE=<视频路径，多个用逗号分隔>   全局库第一个角色套用「横版动作」模板、把这些视频加成新版本，
//                                      再多截三张：人物素材页、待生成动作的生成面板、有多个版本的动作
// 页面切换由界面提供的 window.__gpDev.go(route) 完成（projectId 省略 = 第一个项目）。
import { app } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'

const SHOTS: Array<{ name: string; route: Record<string, string> }> = [
  { name: 'library-images', route: { view: 'library', tab: 'images' } },
  { name: 'library-models', route: { view: 'library', tab: 'models' } },
  { name: 'library-assets2d', route: { view: 'library', tab: 'assets2d' } },
  { name: 'library-sprites', route: { view: 'library', tab: 'sprites' } },
  { name: 'library-prompts', route: { view: 'library', tab: 'prompts' } },
  { name: 'library-styles', route: { view: 'library', tab: 'styles' } },
  { name: 'project-config', route: { view: 'project', tab: 'config' } },
  { name: 'project-notes', route: { view: 'project', tab: 'notes' } },
  { name: 'project-assets', route: { view: 'project', tab: 'assets' } },
  { name: 'project-models', route: { view: 'project', tab: 'models' } },
  { name: 'project-assets2d', route: { view: 'project', tab: 'assets2d' } },
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

// 只读取页面布局。按控件「实际露出来的部分」判断：滚动区里滚出去的、被底栏盖住滚动内容的不算问题；
// 故意的省略号（text-overflow: ellipsis、多行截断）不算文字被裁；同一个父元素里绝对定位叠上去的按钮（卡片上的小按钮）不算重叠。
// 分组表单行的标签（.rowi > .k）也参与重叠检查，用来发现标签和控件挤在一起。
const LAYOUT_CHECK = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0 && (el.checkVisibility?.() ?? true)
  }
  const describe = (el, r = el.getBoundingClientRect()) => {
    const classes = [...el.classList].slice(0, 3).map((c) => '.' + c).join('')
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 20)
    const rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    return el.tagName.toLowerCase() + classes + ' ' + JSON.stringify(label) + ' ' + JSON.stringify(rect)
  }
  const clipsAny = (s) => s.overflowX !== 'visible' || s.overflowY !== 'visible'
  const innerBox = (el) => {
    const p = el.getBoundingClientRect()
    return { left: p.left + el.clientLeft, top: p.top + el.clientTop, right: p.left + el.clientLeft + el.clientWidth, bottom: p.top + el.clientTop + el.clientHeight }
  }
  const meet = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) })
  const empty = (r) => r.right - r.left <= 1 || r.bottom - r.top <= 1
  /** 被各级会裁剪的祖先裁过之后露出来的部分 */
  const shown = (el) => {
    let r = el.getBoundingClientRect()
    r = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    for (let p = el.parentElement; p; p = p.parentElement) if (clipsAny(getComputedStyle(p))) r = meet(r, innerBox(p))
    return r
  }
  const intentional = (el) => {
    const s = getComputedStyle(el)
    return s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')
  }
  const abs = (el) => ['absolute', 'fixed'].includes(getComputedStyle(el).position)
  // 打开了面板（sheet）时只看最上层面板里的控件，背后被遮住的不算
  const sheets = [...document.querySelectorAll('.sheet[role="dialog"]')].filter(visible)
  const root = sheets[sheets.length - 1] ?? document
  const controls = [...root.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="switch"], [role="slider"], [role="checkbox"], .rowi > .k')]
    .filter(visible).map((el) => ({ el, rect: el.getBoundingClientRect(), vis: shown(el) })).filter((c) => !empty(c.vis))
  const issues = []
  for (let i = 0; i < controls.length; i++) {
    const { el, rect: r, vis } = controls[i]
    const description = describe(el, r)
    for (let j = i + 1; j < controls.length; j++) {
      const { el: other, vis: ov } = controls[j]
      if (el.contains(other) || other.contains(el)) continue
      if (el.parentElement === other.parentElement && (abs(el) || abs(other))) continue
      if (!empty(meet(vis, ov))) issues.push('重叠：' + description + ' ↔ ' + describe(other))
    }
    // 文字放不下（排除输入框和故意的省略号）
    if (!el.matches('input, select, textarea')) {
      let clipped = el.scrollWidth > el.clientWidth + 1 && !intentional(el)
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      while (!clipped && walker.nextNode()) {
        const node = walker.currentNode
        const parent = node.parentElement
        if (!node.textContent.trim() || !parent || !visible(parent) || intentional(parent)) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        clipped = [...range.getClientRects()].some((t) => t.width > 0 && t.height > 0 && (t.left < r.left - 1 || t.right > r.right + 1 || t.top < r.top - 1 || t.bottom > r.bottom + 1))
      }
      if (clipped) issues.push('文字被裁：' + description)
    }
    // 被不能滚动的容器切掉一部分
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const s = getComputedStyle(parent)
      if (!clipsAny(s)) continue
      const box = innerBox(parent)
      const cutX = r.left < box.left - 1 || r.right > box.right + 1
      const cutY = r.top < box.top - 1 || r.bottom > box.bottom + 1
      const stuckX = ['hidden', 'clip'].includes(s.overflowX) || parent.scrollWidth <= parent.clientWidth
      const stuckY = ['hidden', 'clip'].includes(s.overflowY) || parent.scrollHeight <= parent.clientHeight
      if ((cutX && stuckX) || (cutY && stuckY)) issues.push('超出容器：' + description + '；容器 ' + describe(parent))
      break
    }
    if (vis.right > innerWidth + 1 || vis.bottom > innerHeight + 1 || vis.left < -1 || vis.top < -1) issues.push('超出窗口：' + description)
  }
  return issues
})()`

// 序列帧右栏的折叠组全部展开，参数行也要检查
const OPEN_DISCLOSURES = `(() => { document.querySelectorAll('.sp-disc.closed').forEach((b) => b.click()); return true })()`

type LayoutGroup = { name: string; width: number; height: number; issues: string[] }

async function captureLayout(win: BrowserWindow, dir: string, name: string, width: number, height: number): Promise<LayoutGroup> {
  const wc = win.webContents
  const file = join(dir, `${name}@${width}.png`)
  await fs.writeFile(file, (await wc.capturePage()).toPNG())
  const issues: string[] = await wc.executeJavaScript(LAYOUT_CHECK)
  console.log(`[devshot] ${file}`)
  return { name, width, height, issues }
}

async function checkLayout(win: BrowserWindow, dir: string, name: string): Promise<LayoutGroup[]> {
  const wc = win.webContents
  const originalSize = win.getContentSize()
  const groups: LayoutGroup[] = []
  try {
    if (name.endsWith('-sprites')) {
      await wc.executeJavaScript(OPEN_DISCLOSURES)
      await delay(300)
    }
    for (const [width, height] of [[1080, 680], [1280, 800], [1440, 900]]) {
      win.setContentSize(width, height)
      wc.sendInputEvent({ type: 'mouseMove', x: 260, y: 26 })
      await delay(400)
      await waitForImages(win)
      groups.push(await captureLayout(win, dir, name, width, height))
    }
    if (name.endsWith('-sprites')) {
      win.setContentSize(1280, 800)
      await delay(400)
      // 只打开面板查看，Escape 退出；不点导出或保存，也不展开会写入偏好设置的分组
      for (const panel of [
        { text: '导出…', scope: '.toolbar', name: `${name}-export` },
        { text: '框选…', scope: '.sp-insp', name: `${name}-watermark` }
      ]) {
        const opened: boolean = await wc.executeJavaScript(`(() => {
          const b = [...document.querySelectorAll(${JSON.stringify(panel.scope)} + ' button')].find((x) =>
            x.textContent.trim() === ${JSON.stringify(panel.text)} && !x.disabled && x.getBoundingClientRect().width > 0 && (x.checkVisibility?.() ?? true))
          if (b) b.click()
          return !!b
        })()`)
        if (!opened) {
          console.warn(`[devshot] 找不到可用的「${panel.text}」按钮，跳过布局检查`)
          continue
        }
        try {
          await delay(800)
          await waitForImages(win)
          groups.push(await captureLayout(win, dir, panel.name, 1280, 800))
        } finally {
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
          await delay(500)
        }
      }
    }
  } finally {
    // 恢复原尺寸，原来的无尺寸截图和显式导出仍走原流程
    win.setContentSize(originalSize[0], originalSize[1])
    await delay(400)
  }
  return groups
}

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

/** 人物素材、待生成、多版本三种页面：选中状态写进 localStorage，切走再切回来让页面重新读取 */
async function spriteScene(win: BrowserWindow, dir: string, takes: string[], layout: boolean, refFile: string | null): Promise<LayoutGroup[]> {
  const wc = win.webContents
  const groups: LayoutGroup[] = []
  const ids = (await wc.executeJavaScript(`(async () => {
    const cs = await window.gp.sprites.list(null)
    const c = cs[0]
    if (!c) return null
    await window.gp.sprites.applyTemplate(null, c.id, 'side-action')
    await window.gp.sprites.update(null, c.id, { description: '银发剑士，蓝色上衣，右手持长剑，像素游戏风格' })
    const refFile = ${JSON.stringify(refFile)}
    if (refFile && !c.refs.some((r) => !r.facing)) await window.gp.sprites.addRefs(null, c.id, [refFile])
    const r = await window.gp.sprites.addActions(null, c.id, ${JSON.stringify(takes)})
    const ch = r.character
    const run = ch.actions.find((a) => a.takes.length > 1) ?? ch.actions.find((a) => a.video)
    const todo = ch.actions.find((a) => !a.video)
    // 同一个视频再抽一个动作，导出面板里就有好几个动作可选
    if (run && !ch.actions.some((a) => a.name === 'run_fast')) await window.gp.sprites.extractAction(null, ch.id, run.id, 'run_fast')
    return { c: ch.id, run: run && run.id, todo: todo && todo.id }
  })()`)) as { c: string; run: string | null; todo: string | null } | null
  if (!ids) {
    console.warn('[devshot] 全局库没有序列帧角色，跳过场景截图')
    return groups
  }
  const pages: Array<[string, string | null]> = [['library-sprites-refs', 'refs'], ['library-sprites-generate', ids.todo], ['library-sprites-takes', ids.run]]
  for (const [name, a] of pages) {
    await wc.executeJavaScript(`localStorage.setItem('gamepanl.sprites.sel.library', ${JSON.stringify(JSON.stringify({ c: ids.c, a }))})`)
    await wc.executeJavaScript(`window.__gpDev && window.__gpDev.go({ view: 'library', tab: 'images' })`)
    await delay(400)
    await wc.executeJavaScript(`window.__gpDev && window.__gpDev.go({ view: 'library', tab: 'sprites' })`)
    await delay(900)
    await waitForImages(win)
    if (name === 'library-sprites-takes') await waitForSprites(win)
    if (layout) groups.push(...(await checkLayout(win, dir, name)))
    wc.sendInputEvent({ type: 'mouseMove', x: 260, y: 26 })
    await delay(150)
    const file = join(dir, `${name}.png`)
    await fs.writeFile(file, (await wc.capturePage()).toPNG())
    console.log(`[devshot] ${file}`)
    // 人物素材页：做定妆照（真实的抠图、摆放、保存），之后的待生成页和多版本页都按有定妆照显示
    if (name === 'library-sprites-refs' && refFile) {
      await wc.executeJavaScript(`document.querySelector('.sp-anchor-tile')?.click()`)
      await delay(2500)
      if (layout) groups.push(...(await checkLayout(win, dir, 'library-sprites-anchor')))
      const sheetFile = join(dir, 'library-sprites-anchor.png')
      await fs.writeFile(sheetFile, (await wc.capturePage()).toPNG())
      console.log(`[devshot] ${sheetFile}`)
      await wc.executeJavaScript(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.trim() === '存为定妆照')?.click()`)
      await delay(1500)
      await waitForImages(win)
      const after = join(dir, 'library-sprites-refs-anchor.png')
      await fs.writeFile(after, (await wc.capturePage()).toPNG())
      console.log(`[devshot] ${after}`)
    }
  }
  // 停在「多版本」那一页：再抽一个动作的面板、每个动作单独存的导出面板
  const sheets: Array<[string, string]> = [
    ['library-sprites-extract', `[...document.querySelectorAll('.sp-tl button')].find((b) => b.textContent.includes('再抽一个动作'))?.click()`],
    ['library-sprites-export', `[...document.querySelectorAll('.toolbar button, button')].find((b) => b.textContent.trim() === '导出…' && !b.disabled)?.click()`]
  ]
  await wc.executeJavaScript(`window.gp.sprites.update(null, ${JSON.stringify(ids.c)}, { exportPrefs: { assets2dMode: 'action' } })`)
  for (const [name, click] of sheets) {
    await waitForSprites(win)
    await wc.executeJavaScript(click)
    await delay(500)
    if (name === 'library-sprites-extract') {
      wc.insertText('dash')
      await delay(200)
    }
    if (layout) groups.push(...(await checkLayout(win, dir, name)))
    const file = join(dir, `${name}.png`)
    await fs.writeFile(file, (await wc.capturePage()).toPNG())
    console.log(`[devshot] ${file}`)
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await delay(400)
  }
  return groups
}

async function capture(win: BrowserWindow, dir: string): Promise<void> {
  const wc = win.webContents
  const layout = process.env['GAMEPANL_SHOT_LAYOUT'] === '1'
  const layoutGroups: LayoutGroup[] = []
  await fs.mkdir(dir, { recursive: true })
  await wc.insertCSS(SHOT_CSS)
  if (process.env['GAMEPANL_SHOT_SAMPLE'] === '1') {
    await wc.executeJavaScript('window.gp.app.importSample()')
  }
  const asset2dPath = process.env['GAMEPANL_SHOT_ASSETS2D']
  if (asset2dPath) {
    await wc.executeJavaScript(`(async () => {
      const r = await window.gp.library.importAssets2D(${JSON.stringify(asset2dPath.split(','))})
      const ps = await window.gp.projects.list()
      const ids = [...new Set([...r.added, ...r.existing].map((a) => a.id))]
      if (ps[0] && ids.length) await window.gp.projects.addAssets2D(ps[0].id, ids)
    })()`)
  }
  const spritePaths = process.env['GAMEPANL_SHOT_SPRITES']
  if (spritePaths) {
    await wc.executeJavaScript(
      `Promise.all([window.gp.projects.list().then((ps) => ps[0] && window.gp.sprites.create(ps[0].id, ${JSON.stringify(spritePaths.split(','))})), window.gp.sprites.create(null, ${JSON.stringify(spritePaths.split(','))})])`
    )
  }
  await delay(1500)
  if (!(await wc.executeJavaScript('typeof window.__gpDev === "object" && window.__gpDev !== null'))) {
    console.warn('[devshot] 界面没有提供 window.__gpDev，截到的都是当前页面')
  }
  for (const shot of SHOTS) {
    await wc.executeJavaScript(`window.__gpDev && window.__gpDev.go(${JSON.stringify(shot.route)})`)
    await delay(900)
    if (shot.name.endsWith('-assets2d')) {
      await wc.executeJavaScript(`document.querySelector('.a2d-card .hit')?.click()`)
      for (let waited = 0; waited < 10_000; waited += 200) {
        const ready = await wc.executeJavaScript(`!document.querySelector('.a2d-player-message')`)
        if (ready) break
        await delay(200)
      }
      await delay(300)
    }
    await waitForImages(win)
    if (shot.name.endsWith('-sprites')) await waitForSprites(win)
    if (layout) layoutGroups.push(...await checkLayout(win, dir, shot.name))
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
  const scene = process.env['GAMEPANL_SHOT_SPRITES_SCENE']
  if (scene) layoutGroups.push(...(await spriteScene(win, dir, scene.split(','), layout, process.env['GAMEPANL_SHOT_SPRITES_REF'] ?? null)))
  if (layout) {
    const total = layoutGroups.reduce((sum, group) => sum + group.issues.length, 0)
    const report = layoutGroups.map((group) =>
      `${group.name} @ ${group.width}×${group.height}\n${group.issues.length ? group.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n') : '无'}`
    ).join('\n\n')
    const file = join(dir, 'layout-report.txt')
    await fs.writeFile(file, `${report}\n\n问题总数：${total}\n`, 'utf8')
    console.log(`[devshot] 布局报告 ${file}，问题总数：${total}`)
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
