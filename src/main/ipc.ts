// IPC：按 src/shared/api.ts 的 GpApi 注册全部通道（通道名 `<模块>:<方法>`，与 src/preload/index.ts 一一对应）。
// 修改数据的操作完成后向所有窗口广播 DATA_CHANGED_CHANNEL。
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, systemPreferences } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'
import { DATA_CHANGED_CHANNEL } from '@shared/api'
import type { AppInfo, DataChange, ID, ImageRef, LibModel } from '@shared/types'
import { copyImageToClipboard, IMPORT_EXTENSIONS } from './images'
import * as library from './library'
import * as models from './models'
import * as projects from './projects'
import { resolveImage } from './protocol'
import type { ResolvedImage } from './protocol'
import { popupContextMenu } from './contextMenu'
import { extractPalette } from './palette'
import { importSample } from './sample'
import { dataRoot, exists, paths } from './storage'
import * as updater from './updater'
import { asBoolean, asId, asIds, asInt, asObject, asOptionalPaths, asString, fail } from './validate'

function emit(...changes: DataChange[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    for (const change of changes) win.webContents.send(DATA_CHANGED_CHANNEL, change)
  }
}

function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, fn)
}

/** 没给路径时弹出系统文件选择框 */
async function pickImages(event: IpcMainInvokeEvent, paths: string[] | undefined): Promise<string[]> {
  if (paths) return paths
  const options: OpenDialogOptions = {
    title: '添加图片',
    buttonLabel: '添加',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: IMPORT_EXTENSIONS }]
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return res.canceled ? [] : res.filePaths
}

/** 没给路径时弹出系统选择框：可以选 .glb / .gltf 文件，也可以选文件夹 */
async function pickModels(event: IpcMainInvokeEvent, paths: string[] | undefined): Promise<string[]> {
  if (paths) return paths
  const options: OpenDialogOptions = {
    title: '添加 3D 模型',
    message: '选择 .glb / .gltf 模型文件，或资产文件夹（含 asset.json 的 export 文件夹）',
    buttonLabel: '添加',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: '3D 模型', extensions: models.MODEL_EXTENSIONS }]
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return res.canceled ? [] : res.filePaths
}

async function findModel(id: unknown): Promise<LibModel> {
  const m = await models.getModel(asId(id, '模型 id'))
  if (!m) fail('模型不存在')
  return m
}

/** 上次「拷贝文件夹到…」选的位置，下次默认还在那里 */
let lastCopyDir: string | undefined

function asImageRef(v: unknown): ImageRef {
  const o = asObject(v, '图片引用')
  if (o['scope'] === 'library') return { scope: 'library', id: asId(o['id'], '图片 id') }
  if (o['scope'] === 'project') {
    return { scope: 'project', projectId: asId(o['projectId'], '项目 id'), id: asId(o['id'], '图片 id') }
  }
  fail('图片引用格式不对')
}

async function findImage(v: unknown): Promise<ResolvedImage> {
  const found = await resolveImage(asImageRef(v))
  if (!found) fail('图片不存在')
  return found
}

function accentColor(): string {
  if (process.platform === 'darwin') {
    try {
      const rgba = systemPreferences.getAccentColor()
      if (/^[0-9a-fA-F]{6}/.test(rgba)) return '#' + rgba.slice(0, 6).toUpperCase()
    } catch {
      // 取不到时用默认蓝色
    }
  }
  return '#0071E3'
}

const projectChanges = (projectId: ID): DataChange[] => [{ kind: 'project', projectId }, { kind: 'projects' }]

export function registerIpc(): void {
  // ---------- app ----------
  handle(
    'app:getInfo',
    async (): Promise<AppInfo> => ({
      version: app.getVersion(),
      dataRoot: dataRoot(),
      accentColor: accentColor(),
      platform: process.platform,
      libraryEmpty: await library.libraryEmpty()
    })
  )
  handle('app:revealDataRoot', async () => {
    const error = await shell.openPath(dataRoot())
    if (error) fail(error)
  })
  handle('app:importSample', async () => {
    const { projectId } = await importSample()
    emit({ kind: 'library-images' }, { kind: 'library-prompts' }, { kind: 'library-styles' }, { kind: 'projects' })
    if (projectId) emit({ kind: 'project', projectId }, { kind: 'notes', projectId }, { kind: 'assets', projectId })
  })

  handle('app:pickFolder', async (event, title, defaultPath) => {
    const options: OpenDialogOptions = {
      title: asString(title, '标题', 200),
      buttonLabel: '选择',
      defaultPath: defaultPath === undefined || defaultPath === null ? undefined : asString(defaultPath, '默认路径', 4096),
      properties: ['openDirectory', 'createDirectory']
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  // ---------- 全局库 · 图片 ----------
  handle('library:listImages', () => library.listImages())
  handle('library:importImages', async (event, paths) => {
    const added = await library.importImages(await pickImages(event, asOptionalPaths(paths)))
    if (added.length) emit({ kind: 'library-images' })
    return added
  })
  handle('library:importImageFromClipboard', async () => {
    const r = await library.importImageFromClipboard()
    if (r?.isNew) emit({ kind: 'library-images' })
    return r ? r.item : null
  })
  handle('library:updateImage', async (_e, id, patch) => {
    const img = await library.updateImage(asId(id), patch)
    emit({ kind: 'library-images' })
    return img
  })
  handle('library:deleteImage', async (_e, id) => {
    const { stylesChanged } = await library.deleteImage(asId(id))
    emit({ kind: 'library-images' })
    if (stylesChanged) emit({ kind: 'library-styles' })
  })
  handle('library:extractPalette', async (_e, id, count) => {
    const img = await findImage({ scope: 'library', id: asId(id, '图片 id') })
    const n = count === undefined ? 5 : asInt(count, '颜色数', 2, 12)
    return extractPalette(img.path, n)
  })

  // ---------- 全局库 · 提示词 ----------
  handle('library:listPrompts', () => library.listPrompts())
  handle('library:createPrompt', async (_e, input) => {
    const p = await library.createPrompt(input)
    emit({ kind: 'library-prompts' })
    return p
  })
  handle('library:updatePrompt', async (_e, id, patch) => {
    const p = await library.updatePrompt(asId(id), patch)
    emit({ kind: 'library-prompts' })
    return p
  })
  handle('library:deletePrompt', async (_e, id) => {
    const pid = asId(id)
    await library.deletePrompt(pid)
    const touched = await projects.forgetLibraryRefs({ promptId: pid })
    emit({ kind: 'library-prompts' }, ...touched.map((projectId): DataChange => ({ kind: 'project', projectId })))
  })
  handle('library:markPromptUsed', async (_e, id) => {
    const p = await library.markPromptUsed(asId(id))
    emit({ kind: 'library-prompts' })
    return p
  })

  // ---------- 全局库 · 风格 ----------
  handle('library:listStyles', () => library.listStyles())
  handle('library:createStyle', async (_e, input) => {
    const s = await library.createStyle(input)
    emit({ kind: 'library-styles' })
    return s
  })
  handle('library:updateStyle', async (_e, id, patch) => {
    const s = await library.updateStyle(asId(id), patch)
    emit({ kind: 'library-styles' })
    return s
  })
  handle('library:deleteStyle', async (_e, id) => {
    const sid = asId(id)
    await library.deleteStyle(sid)
    const touched = await projects.forgetLibraryRefs({ styleId: sid })
    emit({ kind: 'library-styles' }, ...touched.map((projectId): DataChange => ({ kind: 'project', projectId })))
  })

  // ---------- 全局库 · 3D 模型 ----------
  handle('library:listModels', () => models.listModels())
  handle('library:importModels', async (event, paths) => {
    const r = await models.importModels(await pickModels(event, asOptionalPaths(paths)))
    if (r.added.length) emit({ kind: 'library-models' })
    return r
  })
  handle('library:updateModel', async (_e, id, patch) => {
    const m = await models.updateModel(asId(id, '模型 id'), patch)
    emit({ kind: 'library-models' })
    return m
  })
  handle('library:deleteModel', async (_e, id) => {
    const mid = asId(id, '模型 id')
    await models.deleteModel(mid)
    const touched = await projects.forgetModelRefs(mid)
    emit({ kind: 'library-models' }, ...touched.map((projectId): DataChange => ({ kind: 'models', projectId })))
    if (touched.length) emit({ kind: 'projects' })
  })
  handle('library:setModelPreview', async (_e, id, png) => {
    if (!(png instanceof Uint8Array)) fail('缩略图数据格式不对')
    const m = await models.setModelPreview(asId(id, '模型 id'), Buffer.from(png.buffer, png.byteOffset, png.byteLength))
    emit({ kind: 'library-models' })
    return m
  })
  handle('library:copyModelTo', async (event, id) => {
    const m = await findModel(id)
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: `拷贝「${m.name}」到…`,
      message: `会在选中的文件夹里新建「${m.id}」文件夹，里面是完整的模型资产`,
      buttonLabel: '拷贝到这里',
      defaultPath: lastCopyDir,
      properties: ['openDirectory', 'createDirectory']
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const dest = res.canceled ? undefined : res.filePaths[0]
    if (!dest) return null
    lastCopyDir = dest
    let replace = false
    if (await models.copyTargetExists(m.id, dest)) {
      const box = {
        type: 'warning' as const,
        message: `这里已经有「${m.id}」了`,
        detail: '替换会把原来的文件夹移到废纸篓。',
        buttons: ['替换', '保留两者', '取消'],
        defaultId: 1,
        cancelId: 2
      }
      const { response } = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
      if (response === 2) return null
      replace = response === 0
    }
    return models.copyModelTo(m.id, dest, replace)
  })

  // ---------- 项目 ----------
  handle('projects:list', () => projects.listProjects())
  handle('projects:get', (_e, id) => projects.getProject(asId(id)))
  handle('projects:create', async (_e, name) => {
    const p = await projects.createProject(asString(name, '项目名称', 500))
    emit({ kind: 'projects' })
    return p
  })
  handle('projects:update', async (_e, id, patch) => {
    const p = await projects.updateProject(asId(id), patch)
    emit(...projectChanges(p.id))
    return p
  })
  handle('projects:remove', async (_e, id) => {
    await projects.removeProject(asId(id))
    emit({ kind: 'projects' })
  })
  handle('projects:reveal', async (_e, id) => {
    const pid = asId(id)
    await projects.assertProject(pid)
    const error = await shell.openPath(paths.project(pid))
    if (error) fail(error)
  })

  // ---------- 项目 · 笔记 ----------
  handle('projects:listNotes', (_e, projectId) => projects.listNotes(asId(projectId)))
  handle('projects:createNote', async (_e, projectId, input) => {
    const pid = asId(projectId)
    const note = await projects.createNote(pid, input)
    emit({ kind: 'notes', projectId: pid }, { kind: 'projects' })
    return note
  })
  handle('projects:saveNote', async (_e, projectId, note) => {
    const pid = asId(projectId)
    const saved = await projects.saveNote(pid, note)
    emit({ kind: 'notes', projectId: pid })
    return saved
  })
  handle('projects:deleteNote', async (_e, projectId, noteId) => {
    const pid = asId(projectId)
    await projects.deleteNote(pid, asId(noteId))
    emit({ kind: 'notes', projectId: pid }, { kind: 'projects' })
  })

  // ---------- 项目 · 资料 ----------
  handle('projects:listAssets', (_e, projectId) => projects.listAssets(asId(projectId)))
  handle('projects:importAssets', async (event, projectId, paths) => {
    const pid = asId(projectId)
    const files = asOptionalPaths(paths)
    await projects.assertProject(pid) // 项目不存在时先报错，不弹文件选择框
    const added = await projects.importAssets(pid, await pickImages(event, files))
    if (added.length) emit({ kind: 'assets', projectId: pid }, { kind: 'projects' })
    return added
  })
  handle('projects:importAssetFromClipboard', async (_e, projectId) => {
    const pid = asId(projectId)
    const r = await projects.importAssetFromClipboard(pid)
    if (r?.isNew) emit({ kind: 'assets', projectId: pid }, { kind: 'projects' })
    return r ? r.item : null
  })
  handle('projects:addAssetsFromLibrary', async (_e, projectId, ids) => {
    const pid = asId(projectId)
    if (!Array.isArray(ids)) fail('图片 id 列表必须是数组')
    const added = await projects.addAssetsFromLibrary(
      pid,
      ids.map((x) => asId(x, '图片 id'))
    )
    if (added.length) emit({ kind: 'assets', projectId: pid }, { kind: 'projects' })
    return added
  })
  handle('projects:updateAsset', async (_e, projectId, id, patch) => {
    const pid = asId(projectId)
    const a = await projects.updateAsset(pid, asId(id), patch)
    emit({ kind: 'assets', projectId: pid })
    return a
  })
  handle('projects:deleteAsset', async (_e, projectId, id) => {
    const pid = asId(projectId)
    const { projectChanged } = await projects.deleteAsset(pid, asId(id))
    emit({ kind: 'assets', projectId: pid }, { kind: 'projects' })
    if (projectChanged) emit({ kind: 'project', projectId: pid })
  })

  // ---------- 项目 · 3D 模型 ----------
  handle('projects:listModels', async (_e, projectId) => {
    const pid = asId(projectId)
    await projects.assertProject(pid)
    return projects.listProjectModels(pid)
  })
  handle('projects:addModels', async (_e, projectId, ids) => {
    const pid = asId(projectId)
    const added = await projects.addProjectModels(pid, asIds(ids, '模型 id'))
    if (added.length) emit({ kind: 'models', projectId: pid }, { kind: 'projects' })
    return added
  })
  handle('projects:removeModels', async (_e, projectId, ids) => {
    const pid = asId(projectId)
    await projects.removeProjectModels(pid, asIds(ids, '模型 id'))
    emit({ kind: 'models', projectId: pid }, { kind: 'projects' })
  })

  // ---------- 剪贴板 / 访达 ----------
  handle('clipboard:copyImage', async (_e, ref) => {
    const img = await findImage(ref)
    return copyImageToClipboard(img.path, img.width, img.height)
  })
  handle('clipboard:copyText', async (_e, text) => {
    await clipboard.writeText(asString(text, '文字', 1_000_000))
  })
  handle('shell:revealImage', async (_e, ref) => {
    shell.showItemInFolder((await findImage(ref)).path)
  })
  handle('shell:openImage', async (_e, ref) => {
    const error = await shell.openPath((await findImage(ref)).path)
    if (error) fail(error)
  })
  handle('shell:dragImage', async (event, ref) => {
    const img = await findImage(ref)
    // 拖动时跟着鼠标的小图：取一张 96px 缩略图，取不到就用空图（系统会显示默认文件图标）
    let icon = nativeImage.createEmpty()
    try {
      icon = await nativeImage.createThumbnailFromPath(img.path, { width: 96, height: 96 })
    } catch {
      // 用默认图标
    }
    event.sender.startDrag({ file: img.path, icon })
  })

  handle('shell:revealModel', async (_e, id) => {
    const m = await findModel(id)
    const file = models.modelFilePath(m.id, m.file)
    shell.showItemInFolder((await exists(file)) ? file : models.modelDir(m.id))
  })
  handle('shell:dragModel', async (event, id) => {
    const m = await findModel(id)
    const dir = models.modelDir(m.id)
    if (!(await exists(dir))) fail('模型文件夹不见了')
    // 跟着鼠标的小图：预览图缩成 96px，没有就用系统的文件夹图标
    let icon = nativeImage.createEmpty()
    const preview = await models.modelPreviewPath(m)
    if (preview) {
      const img = nativeImage.createFromPath(preview)
      if (!img.isEmpty()) icon = img.resize({ width: 96 })
    }
    if (icon.isEmpty()) icon = await app.getFileIcon(dir, { size: 'normal' })
    event.sender.startDrag({ file: dir, icon })
  })

  // ---------- 右键菜单 ----------
  handle('menu:popup', (event, items) => popupContextMenu(event, items))

  // ---------- 在线更新 ----------
  handle('update:getState', () => updater.getState())
  handle('update:check', () => updater.checkForUpdates(true))
  handle('update:download', () => updater.downloadUpdate())
  handle('update:cancelDownload', () => updater.cancelDownload())
  handle('update:openDownloaded', () => updater.openDownloaded())
  handle('update:revealDownloaded', () => updater.revealDownloaded())
  handle('update:openReleasePage', () => updater.openReleasePage())
  handle('update:skipVersion', (_e, version) => updater.skipVersion(asString(version, '版本号', 100)))
  handle('update:setAutoCheck', (_e, on) => updater.setAutoCheck(asBoolean(on, '自动检查更新')))
}
