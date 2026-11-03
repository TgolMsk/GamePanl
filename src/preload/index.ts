import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { GpApi } from '@shared/api'
import { APP_COMMAND_CHANNEL, DATA_CHANGED_CHANNEL, UPDATE_STATE_CHANNEL } from '@shared/api'
import type { AppCommand, DataChange, UpdateState } from '@shared/types'

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const api: GpApi = {
  app: {
    getInfo: call('app:getInfo') as GpApi['app']['getInfo'],
    revealDataRoot: call('app:revealDataRoot') as GpApi['app']['revealDataRoot'],
    importSample: call('app:importSample') as GpApi['app']['importSample'],
    pickFolder: call('app:pickFolder') as GpApi['app']['pickFolder']
  },
  library: {
    listImages: call('library:listImages') as GpApi['library']['listImages'],
    importImages: call('library:importImages') as GpApi['library']['importImages'],
    importImageFromClipboard: call('library:importImageFromClipboard') as GpApi['library']['importImageFromClipboard'],
    updateImage: call('library:updateImage') as GpApi['library']['updateImage'],
    deleteImage: call('library:deleteImage') as GpApi['library']['deleteImage'],
    extractPalette: call('library:extractPalette') as GpApi['library']['extractPalette'],
    listPrompts: call('library:listPrompts') as GpApi['library']['listPrompts'],
    createPrompt: call('library:createPrompt') as GpApi['library']['createPrompt'],
    updatePrompt: call('library:updatePrompt') as GpApi['library']['updatePrompt'],
    deletePrompt: call('library:deletePrompt') as GpApi['library']['deletePrompt'],
    markPromptUsed: call('library:markPromptUsed') as GpApi['library']['markPromptUsed'],
    listStyles: call('library:listStyles') as GpApi['library']['listStyles'],
    createStyle: call('library:createStyle') as GpApi['library']['createStyle'],
    updateStyle: call('library:updateStyle') as GpApi['library']['updateStyle'],
    deleteStyle: call('library:deleteStyle') as GpApi['library']['deleteStyle'],
    listModels: call('library:listModels') as GpApi['library']['listModels'],
    importModels: call('library:importModels') as GpApi['library']['importModels'],
    updateModel: call('library:updateModel') as GpApi['library']['updateModel'],
    deleteModel: call('library:deleteModel') as GpApi['library']['deleteModel'],
    setModelPreview: call('library:setModelPreview') as GpApi['library']['setModelPreview'],
    copyModelTo: call('library:copyModelTo') as GpApi['library']['copyModelTo'],
    listAssets2D: call('library:listAssets2D') as GpApi['library']['listAssets2D'],
    importAssets2D: call('library:importAssets2D') as GpApi['library']['importAssets2D'],
    updateAsset2D: call('library:updateAsset2D') as GpApi['library']['updateAsset2D'],
    deleteAsset2D: call('library:deleteAsset2D') as GpApi['library']['deleteAsset2D'],
    copyAsset2DTo: call('library:copyAsset2DTo') as GpApi['library']['copyAsset2DTo']
  },
  projects: {
    list: call('projects:list') as GpApi['projects']['list'],
    get: call('projects:get') as GpApi['projects']['get'],
    create: call('projects:create') as GpApi['projects']['create'],
    update: call('projects:update') as GpApi['projects']['update'],
    remove: call('projects:remove') as GpApi['projects']['remove'],
    reveal: call('projects:reveal') as GpApi['projects']['reveal'],
    listNotes: call('projects:listNotes') as GpApi['projects']['listNotes'],
    createNote: call('projects:createNote') as GpApi['projects']['createNote'],
    saveNote: call('projects:saveNote') as GpApi['projects']['saveNote'],
    deleteNote: call('projects:deleteNote') as GpApi['projects']['deleteNote'],
    listAssets: call('projects:listAssets') as GpApi['projects']['listAssets'],
    importAssets: call('projects:importAssets') as GpApi['projects']['importAssets'],
    importAssetFromClipboard: call('projects:importAssetFromClipboard') as GpApi['projects']['importAssetFromClipboard'],
    addAssetsFromLibrary: call('projects:addAssetsFromLibrary') as GpApi['projects']['addAssetsFromLibrary'],
    updateAsset: call('projects:updateAsset') as GpApi['projects']['updateAsset'],
    deleteAsset: call('projects:deleteAsset') as GpApi['projects']['deleteAsset'],
    listModels: call('projects:listModels') as GpApi['projects']['listModels'],
    addModels: call('projects:addModels') as GpApi['projects']['addModels'],
    removeModels: call('projects:removeModels') as GpApi['projects']['removeModels'],
    listAssets2D: call('projects:listAssets2D') as GpApi['projects']['listAssets2D'],
    addAssets2D: call('projects:addAssets2D') as GpApi['projects']['addAssets2D'],
    removeAssets2D: call('projects:removeAssets2D') as GpApi['projects']['removeAssets2D']
  },
  sprites: {
    list: call('sprites:list') as GpApi['sprites']['list'],
    create: call('sprites:create') as GpApi['sprites']['create'],
    addActions: call('sprites:addActions') as GpApi['sprites']['addActions'],
    addRefs: call('sprites:addRefs') as GpApi['sprites']['addRefs'],
    addRefsFromImages: call('sprites:addRefsFromImages') as GpApi['sprites']['addRefsFromImages'],
    deleteRef: call('sprites:deleteRef') as GpApi['sprites']['deleteRef'],
    copyRef: call('sprites:copyRef') as GpApi['sprites']['copyRef'],
    revealRef: call('sprites:revealRef') as GpApi['sprites']['revealRef'],
    dragRef: call('sprites:dragRef') as GpApi['sprites']['dragRef'],
    saveAnchor: call('sprites:saveAnchor') as GpApi['sprites']['saveAnchor'],
    addPlanned: call('sprites:addPlanned') as GpApi['sprites']['addPlanned'],
    applyTemplate: call('sprites:applyTemplate') as GpApi['sprites']['applyTemplate'],
    useTake: call('sprites:useTake') as GpApi['sprites']['useTake'],
    deleteTake: call('sprites:deleteTake') as GpApi['sprites']['deleteTake'],
    splitTake: call('sprites:splitTake') as GpApi['sprites']['splitTake'],
    extractAction: call('sprites:extractAction') as GpApi['sprites']['extractAction'],
    fromAsset2D: call('sprites:fromAsset2D') as GpApi['sprites']['fromAsset2D'],
    update: call('sprites:update') as GpApi['sprites']['update'],
    updateAction: call('sprites:updateAction') as GpApi['sprites']['updateAction'],
    applyParamsToAll: call('sprites:applyParamsToAll') as GpApi['sprites']['applyParamsToAll'],
    reorderActions: call('sprites:reorderActions') as GpApi['sprites']['reorderActions'],
    deleteAction: call('sprites:deleteAction') as GpApi['sprites']['deleteAction'],
    remove: call('sprites:remove') as GpApi['sprites']['remove'],
    export: call('sprites:export') as GpApi['sprites']['export'],
    detectGodot: call('sprites:detectGodot') as GpApi['sprites']['detectGodot'],
    reveal: call('sprites:reveal') as GpApi['sprites']['reveal'],
    copyImage: call('sprites:copyImage') as GpApi['sprites']['copyImage']
  },
  clipboard: {
    copyImage: call('clipboard:copyImage') as GpApi['clipboard']['copyImage'],
    copyText: call('clipboard:copyText') as GpApi['clipboard']['copyText']
  },
  shell: {
    revealImage: call('shell:revealImage') as GpApi['shell']['revealImage'],
    openImage: call('shell:openImage') as GpApi['shell']['openImage'],
    dragImage: call('shell:dragImage') as GpApi['shell']['dragImage'],
    revealModel: call('shell:revealModel') as GpApi['shell']['revealModel'],
    dragModel: call('shell:dragModel') as GpApi['shell']['dragModel'],
    revealAsset2D: call('shell:revealAsset2D') as GpApi['shell']['revealAsset2D'],
    dragAsset2D: call('shell:dragAsset2D') as GpApi['shell']['dragAsset2D']
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
  menu: {
    popup: call('menu:popup') as GpApi['menu']['popup']
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onCommand: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, command: AppCommand): void => listener(command)
    ipcRenderer.on(APP_COMMAND_CHANNEL, handler)
    return () => ipcRenderer.removeListener(APP_COMMAND_CHANNEL, handler)
  },
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
