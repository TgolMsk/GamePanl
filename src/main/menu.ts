// 应用菜单（macOS）：关于、检查更新、编辑（剪贴板快捷键靠它）、显示、窗口、帮助。
import { app, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'fs'
import { APP_NAME, COPYRIGHT, devIconPath, ISSUES_URL, RELEASES_URL, REPO_URL } from './meta'
import { dataRoot } from './storage'

export interface MenuHooks {
  onCheckForUpdates: () => void
}

function appMenu(hooks: MenuHooks): MenuItemConstructorOptions {
  return {
    label: APP_NAME,
    submenu: [
      { role: 'about', label: `关于 ${APP_NAME}` },
      { label: '检查更新…', click: hooks.onCheckForUpdates },
      { type: 'separator' },
      { label: '打开数据文件夹', click: () => void shell.openPath(dataRoot()) },
      { type: 'separator' },
      { role: 'services', label: '服务' },
      { type: 'separator' },
      { role: 'hide', label: `隐藏 ${APP_NAME}` },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      { role: 'quit', label: `退出 ${APP_NAME}` }
    ]
  }
}

const editMenu: MenuItemConstructorOptions = {
  label: '编辑',
  submenu: [
    { role: 'undo', label: '撤销' },
    { role: 'redo', label: '重做' },
    { type: 'separator' },
    { role: 'cut', label: '剪切' },
    { role: 'copy', label: '拷贝' },
    { role: 'paste', label: '粘贴' },
    { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
    { role: 'delete', label: '删除' },
    { role: 'selectAll', label: '全选' }
  ]
}

function viewMenu(): MenuItemConstructorOptions {
  const dev: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ role: 'reload', label: '重新载入' }, { role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' }]
  return {
    label: '显示',
    submenu: [
      ...dev,
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '进入 / 退出全屏' }
    ]
  }
}

const windowMenu: MenuItemConstructorOptions = {
  label: '窗口',
  role: 'windowMenu',
  submenu: [
    { role: 'minimize', label: '最小化' },
    { role: 'zoom', label: '缩放' },
    { type: 'separator' },
    { role: 'front', label: '前置全部窗口' }
  ]
}

function helpMenu(hooks: MenuHooks): MenuItemConstructorOptions {
  return {
    label: '帮助',
    role: 'help',
    submenu: [
      { label: 'GitHub 仓库', click: () => void shell.openExternal(REPO_URL) },
      { label: '版本发布记录', click: () => void shell.openExternal(RELEASES_URL) },
      { label: '反馈问题…', click: () => void shell.openExternal(ISSUES_URL) },
      { type: 'separator' },
      { label: '检查更新…', click: hooks.onCheckForUpdates }
    ]
  }
}

/** app ready 之后调用 */
export function installMenu(hooks: MenuHooks): void {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: COPYRIGHT,
    credits: '游戏策划工作台',
    website: REPO_URL,
    // 打包后的 .app 自带图标；开发时指给自己的图标文件
    iconPath: devIconPath && existsSync(devIconPath) ? devIconPath : undefined
  })
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [appMenu(hooks)] : []),
    editMenu,
    viewMenu(),
    windowMenu,
    helpMenu(hooks)
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
