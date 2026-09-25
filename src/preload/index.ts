import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { GpApi } from '@shared/api'
import { DATA_CHANGED_CHANNEL, UPDATE_STATE_CHANNEL } from '@shared/api'
import type { DataChange, UpdateState } from '@shared/types'

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const api: GpApi = {
  app: {
    getInfo: call('app:getInfo') as GpApi['app']['getInfo'],
    revealDataRoot: call('app:revealDataRoot') as GpApi['app']['revealDataRoot'],
    importSample: call('app:importSample') as GpApi['app']['importSample']
  },
  library: {
    listImages: call('library:listImages') as GpApi['library']['listImages'],
    importImages: call('library:importImages') as GpApi['library']['importImages'],
    importImageFromClipboard: call('library:importImageFromClipboard') as GpApi['library']['importImageFromClipboard'],
    updateImage: call('library:updateImage') as GpApi['library']['updateImage'],
    deleteImage: call('library:deleteImage') as GpApi['library']['deleteImage'],
    listPrompts: call('library:listPrompts') as GpApi['library']['listPrompts'],
    createPrompt: call('library:createPrompt') as GpApi['library']['createPrompt'],
    updatePrompt: call('library:updatePrompt') as GpApi['library']['updatePrompt'],
    deletePrompt: call('library:deletePrompt') as GpApi['library']['deletePrompt'],
    markPromptUsed: call('library:markPromptUsed') as GpApi['library']['markPromptUsed'],
    listStyles: call('library:listStyles') as GpApi['library']['listStyles'],
    createStyle: call('library:createStyle') as GpApi['library']['createStyle'],
    updateStyle: call('library:updateStyle') as GpApi['library']['updateStyle'],
    deleteStyle: call('library:deleteStyle') as GpApi['library']['deleteStyle']
  },
  projects: {
    list: call('projects:list') as GpApi['projects']['list'],
    get: call('projects:get') as GpApi['projects']['get'],
    create: call('projects:create') as GpApi['projects']['create'],
    update: call('projects:update') as GpApi['projects']['update'],
    remove: call('projects:remove') as GpApi['projects']['remove'],
    listNotes: call('projects:listNotes') as GpApi['projects']['listNotes'],
    createNote: call('projects:createNote') as GpApi['projects']['createNote'],
    saveNote: call('projects:saveNote') as GpApi['projects']['saveNote'],
    deleteNote: call('projects:deleteNote') as GpApi['projects']['deleteNote'],
    listAssets: call('projects:listAssets') as GpApi['projects']['listAssets'],
    importAssets: call('projects:importAssets') as GpApi['projects']['importAssets'],
    importAssetFromClipboard: call('projects:importAssetFromClipboard') as GpApi['projects']['importAssetFromClipboard'],
    addAssetsFromLibrary: call('projects:addAssetsFromLibrary') as GpApi['projects']['addAssetsFromLibrary'],
    updateAsset: call('projects:updateAsset') as GpApi['projects']['updateAsset'],
    deleteAsset: call('projects:deleteAsset') as GpApi['projects']['deleteAsset']
  },
  clipboard: {
    copyImage: call('clipboard:copyImage') as GpApi['clipboard']['copyImage'],
    copyText: call('clipboard:copyText') as GpApi['clipboard']['copyText']
  },
  shell: {
    revealImage: call('shell:revealImage') as GpApi['shell']['revealImage']
  },
  update: {
    getState: call('update:getState') as GpApi['update']['getState'],
    check: call('update:check') as GpApi['update']['check'],
    download: call('update:download') as GpApi['update']['download'],
    cancelDownload: call('update:cancelDownload') as GpApi['update']['cancelDownload'],
    openDownloaded: call('update:openDownloaded') as GpApi['update']['openDownloaded'],
    revealDownloaded: call('update:revealDownloaded') as GpApi['update']['revealDownloaded'],
    openReleasePage: call('update:openReleasePage') as GpApi['update']['openReleasePage'],
    skipVersion: call('update:skipVersion') as GpApi['update']['skipVersion'],
    setAutoCheck: call('update:setAutoCheck') as GpApi['update']['setAutoCheck']
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onDataChanged: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, change: DataChange): void => listener(change)
    ipcRenderer.on(DATA_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DATA_CHANGED_CHANNEL, handler)
  },
  onUpdateState: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, state: UpdateState): void => listener(state)
    ipcRenderer.on(UPDATE_STATE_CHANNEL, handler)
    return () => ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, handler)
  }
}

contextBridge.exposeInMainWorld('gp', api)
