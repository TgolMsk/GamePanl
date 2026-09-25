import { app, BrowserWindow, protocol, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { initStorage } from './storage'
import { registerIpc } from './ipc'
import { registerImageProtocol } from './protocol'
import { setupDevShot } from './devshot'
import { installMenu } from './menu'
import { APP_NAME, devIconPath } from './meta'
import { checkForUpdates, initUpdater, startAutoCheck } from './updater'
import { restoredBounds, trackWindowBounds } from './windowState'
import type { WindowBounds } from './settings'
import { APP_COMMAND_CHANNEL } from '@shared/api'
import type { AppCommand } from '@shared/types'

app.setName(APP_NAME)

// gp://image/... 用来把本地图片安全地交给界面显示（见 src/shared/api.ts 的 imageUrl）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gp',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

function createWindow(bounds: WindowBounds | null = null): BrowserWindow {
  const win = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: 'GamePanl',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())
  trackWindowBounds(win)

  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

setupDevShot()

app.whenReady().then(async () => {
  // 打包后的 .app 自带图标；开发模式下 Dock 里显示的是 Electron 默认图标，这里换成我们自己的
  if (process.platform === 'darwin' && !app.isPackaged && devIconPath && existsSync(devIconPath)) {
    app.dock?.setIcon(devIconPath)
  }
  /** 没有窗口时（macOS 关掉窗口后应用还在）先开一个，再执行 */
  const withWindow = (run: (win: BrowserWindow) => void): void => {
    const existing = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (existing) {
      run(existing)
      return
    }
    void restoredBounds().then((b) => {
      const win = createWindow(b)
      win.webContents.once('did-finish-load', () => run(win))
    })
  }
  installMenu({
    onCheckForUpdates: () => withWindow(() => void checkForUpdates(true)),
    sendCommand: (command: AppCommand) => withWindow((win) => win.webContents.send(APP_COMMAND_CHANNEL, command))
  })
  await initStorage()
  await initUpdater()
  registerImageProtocol()
  registerIpc()
  createWindow(await restoredBounds())
  startAutoCheck()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void restoredBounds().then(createWindow)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
