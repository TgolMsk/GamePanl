import { app, BrowserWindow, protocol, shell } from 'electron'
import { join } from 'path'
import { initStorage } from './storage'
import { registerIpc } from './ipc'
import { registerImageProtocol } from './protocol'
import { setupDevShot } from './devshot'

// gp://image/... 用来把本地图片安全地交给界面显示（见 src/shared/api.ts 的 imageUrl）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gp',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
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
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(app.getAppPath(), 'build', 'icon.png'))
  }
  await initStorage()
  registerImageProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
