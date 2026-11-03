// 预加载脚本通过 contextBridge 暴露为 window.gp 的接口。
// 主进程在 src/main/ipc.ts 里按 IPC 通道名一一实现；界面只通过 window.gp 访问数据。

import type {
  AppCommand,
  AppInfo,
  DataChange,
  ID,
  ImageRef,
  LibImage,
  LibModel,
  LibAsset2D,
  Asset2DImportResult,
  MenuItemSpec,
  ModelImportResult,
  Note,
  Project,
  ProjectAsset,
  ProjectModel,
  ProjectAsset2D,
  ProjectSummary,
  Prompt,
  Style,
  UpdateState
} from './types'
import type { SpriteActionParams, SpriteActionPatch, SpriteCharacter, SpriteCharacterPatch, SpriteExportBundle, SpriteFacing, SpriteOwner } from './sprites'

export type LibImagePatch = Partial<Pick<LibImage, 'name' | 'category' | 'tags'>>
export type LibModelPatch = Partial<Pick<LibModel, 'name' | 'category' | 'tags'>>
export type LibAsset2DPatch = Partial<Pick<LibAsset2D, 'name' | 'category' | 'tags'>>
export type PromptInput = Pick<Prompt, 'title' | 'body' | 'category'>
export type PromptPatch = Partial<PromptInput>
export type StyleInput = Pick<Style, 'name' | 'desc' | 'palette' | 'prompt' | 'sampleImageId'>
export type StylePatch = Partial<StyleInput>
export type ProjectPatch = Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>
export type NoteInput = Partial<Pick<Note, 'title' | 'category' | 'blocks'>>
export type AssetPatch = Partial<Pick<ProjectAsset, 'name' | 'category' | 'tags'>>

/** 导入序列帧视频的结果 */
/** 一个视频放到了哪：new 新动作；filled 补上了待生成的动作；take 已有动作的新版本 */
export interface SpritePlaced {
  characterId: ID
  actionId: ID
  action: string
  how: 'new' | 'filled' | 'take'
}

export interface SpriteImportResult {
  created: SpriteCharacter[]
  /** 加进了已有角色（同名，或拖进当前选中的角色） */
  merged: SpriteCharacter[]
  placed: SpritePlaced[]
  /** 加进的人物图张数 */
  refs: number
  skipped: Array<{ path: string; reason: string }>
}

export interface SpriteAddResult {
  character: SpriteCharacter
  placed: SpritePlaced[]
  refs: number
  skipped: Array<{ path: string; reason: string }>
}

export interface SpriteRefsResult {
  character: SpriteCharacter
  added: number
  skipped: Array<{ path: string; reason: string }>
}

/** 界面送去导出的内容；角色名、Godot 路径、版本号由主进程补上 */
export type SpriteExportPayload = Omit<SpriteExportBundle, 'name' | 'godotPrefix' | 'appVersion'>

export interface SpriteExportOutcome {
  /** 写出的角色文件夹；仅存进 2D 资产库时为库里的目录 */
  folder: string
  files: number
  /** 存进项目资料的图片数 */
  assets: number
  /** 实际用的 res:// 目录；null 表示写的是相对路径 */
  godotPrefix: string | null
  character: SpriteCharacter
  /** 这次存进 2D 资产库的资产（整个角色一个，或每个动作一个） */
  assets2d: LibAsset2D[]
}

/** 存进 2D 资产库时用的名称；不填用默认（角色名 / 「角色名 · 动作名」），填了会改掉库里的名称 */
export interface SpriteAssetNames {
  character?: string
  /** 动作 id → 资产名称 */
  actions?: Record<ID, string>
}

export interface GpApi {
  app: {
    getInfo(): Promise<AppInfo>
    /** 在访达中打开数据目录 */
    revealDataRoot(): Promise<void>
    /** 把内置的示例内容（图片、提示词、风格、示例项目「雾港」）导入进来；已存在的不重复导入 */
    importSample(): Promise<void>
    /** 弹出系统文件夹选择框；取消返回 null */
    pickFolder(title: string, defaultPath?: string): Promise<string | null>
  }

  library: {
    listImages(): Promise<LibImage[]>
    /** 不传 paths 时弹出系统文件选择框；返回新加入的图片（按内容去重，已存在的不再加入） */
    importImages(paths?: string[]): Promise<LibImage[]>
    /** 把系统剪贴板里的图片存进全局库；剪贴板里没有图片时返回 null */
    importImageFromClipboard(): Promise<LibImage | null>
    updateImage(id: ID, patch: LibImagePatch): Promise<LibImage>
    /** 移到系统废纸篓 */
    deleteImage(id: ID): Promise<void>
    /** 从一张图片里提取主色（默认 5 个），十六进制，按明度从深到浅；读不了时返回空数组 */
    extractPalette(imageId: ID, count?: number): Promise<string[]>

    listPrompts(): Promise<Prompt[]>
    createPrompt(input: PromptInput): Promise<Prompt>
    updatePrompt(id: ID, patch: PromptPatch): Promise<Prompt>
    deletePrompt(id: ID): Promise<void>
    /** 复制过一次，uses + 1 */
    markPromptUsed(id: ID): Promise<Prompt>

    listStyles(): Promise<Style[]>
    createStyle(input: StyleInput): Promise<Style>
    updateStyle(id: ID, patch: StylePatch): Promise<Style>
    deleteStyle(id: ID): Promise<void>

    listModels(): Promise<LibModel[]>
    /**
     * 导入 3D 模型：.glb / .gltf 文件，或资产文件夹（有 asset.json 的 export/、资产根目录、整个资产库都行）。
     * 不传 paths 时弹出系统选择框。按模型文件内容去重。
     */
    importModels(paths?: string[]): Promise<ModelImportResult>
    updateModel(id: ID, patch: LibModelPatch): Promise<LibModel>
    /** 整个模型文件夹移到系统废纸篓，并从各项目资料里去掉 */
    deleteModel(id: ID): Promise<void>
    /** 保存界面渲染的缩略图（PNG 数据） */
    setModelPreview(id: ID, png: Uint8Array): Promise<LibModel>
    /** 弹出文件夹选择框，把模型文件夹拷贝进去；取消返回 null，否则返回拷贝出来的文件夹路径 */
    copyModelTo(id: ID): Promise<string | null>

    listAssets2D(): Promise<LibAsset2D[]>
    /** 导入图片、JSON 图集或资产文件夹；不传 paths 时弹出系统选择框 */
    importAssets2D(paths?: string[]): Promise<Asset2DImportResult>
    updateAsset2D(id: ID, patch: LibAsset2DPatch): Promise<LibAsset2D>
    /** 整个文件夹移到废纸篓，并清除项目引用 */
    deleteAsset2D(id: ID): Promise<void>
    copyAsset2DTo(id: ID): Promise<string | null>
  }

  projects: {
    list(): Promise<ProjectSummary[]>
    get(id: ID): Promise<Project>
    create(name: string): Promise<Project>
    update(id: ID, patch: ProjectPatch): Promise<Project>
    /** 整个项目文件夹移到系统废纸篓 */
    remove(id: ID): Promise<void>
    /** 在访达中打开项目文件夹 */
    reveal(id: ID): Promise<void>

    listNotes(projectId: ID): Promise<Note[]>
    createNote(projectId: ID, input?: NoteInput): Promise<Note>
    /** 整条保存（标题、分类、完成、正文块） */
    saveNote(projectId: ID, note: Note): Promise<Note>
    deleteNote(projectId: ID, noteId: ID): Promise<void>

    listAssets(projectId: ID): Promise<ProjectAsset[]>
    importAssets(projectId: ID, paths?: string[]): Promise<ProjectAsset[]>
    importAssetFromClipboard(projectId: ID): Promise<ProjectAsset | null>
    /** 从全局库复制图片到本项目资料 */
    addAssetsFromLibrary(projectId: ID, libraryImageIds: ID[]): Promise<ProjectAsset[]>
    updateAsset(projectId: ID, id: ID, patch: AssetPatch): Promise<ProjectAsset>
    deleteAsset(projectId: ID, id: ID): Promise<void>

    /** 本项目引用的全局库模型（新加的在前） */
    listModels(projectId: ID): Promise<ProjectModel[]>
    /** 引用全局库模型（不复制文件）；返回新加的 */
    addModels(projectId: ID, modelIds: ID[]): Promise<ProjectModel[]>
    /** 去掉引用（全局库里的模型不动） */
    removeModels(projectId: ID, modelIds: ID[]): Promise<void>

    listAssets2D(projectId: ID): Promise<ProjectAsset2D[]>
    /** 引用全局库 2D 资产，不复制文件 */
    addAssets2D(projectId: ID, asset2dIds: ID[]): Promise<ProjectAsset2D[]>
    removeAssets2D(projectId: ID, asset2dIds: ID[]): Promise<void>
  }

  /**
   * 序列帧：AI 绿幕动作视频 → 像素序列帧（每个项目、以及全局库，各有若干角色，每个角色若干动作）。
   * 第一个参数 owner 是项目 id；null 为全局库。
   */
  sprites: {
    list(owner: SpriteOwner): Promise<SpriteCharacter[]>
    /**
     * 导入视频和人物图：每个文件夹一个角色（视频是动作、图片是人物素材）；零散文件给了 target（选中的角色）时加进它，
     * 否则算一个角色。和已有角色同名时加进那个角色。没给路径时弹出选择框
     */
    create(owner: SpriteOwner, paths?: string[], opts?: { height?: number; target?: { id: ID; actionId: ID | null } | null }): Promise<SpriteImportResult>
    /** 给角色添加视频（按文件名归到动作；对不上又只有一个时放进 actionId）和人物图。没给路径时弹出选择框 */
    addActions(owner: SpriteOwner, id: ID, paths?: string[], actionId?: ID | null): Promise<SpriteAddResult>
    /** 添加人物图（立绘、三视图、配件参考）。没给路径时弹出选择框 */
    addRefs(owner: SpriteOwner, id: ID, paths?: string[]): Promise<SpriteRefsResult>
    /** 从全局库图片 / 项目资料添加人物图 */
    addRefsFromImages(owner: SpriteOwner, id: ID, refs: ImageRef[]): Promise<SpriteRefsResult>
    deleteRef(owner: SpriteOwner, id: ID, refId: ID): Promise<SpriteCharacter>
    /** 人物图原图写进剪贴板（粘贴到生成网站）；成功返回 true */
    copyRef(owner: SpriteOwner, id: ID, refId: ID): Promise<boolean>
    revealRef(owner: SpriteOwner, id: ID, refId: ID): Promise<void>
    /** 原生拖出人物图原文件（拖到浏览器上传框、访达） */
    dragRef(owner: SpriteOwner, id: ID, refId: ID): Promise<void>
    /** 存定妆照（首帧图）：png 为界面做好的 PNG；为 null 时直接用 from 那张人物图 */
    saveAnchor(owner: SpriteOwner, id: ID, facing: SpriteFacing, from: ID | null, png: Uint8Array | null): Promise<SpriteCharacter>
    /** 新建待生成的动作；group 为 null 时按动作名自动归组 */
    addPlanned(owner: SpriteOwner, id: ID, names: string[], group: ID | null): Promise<SpriteCharacter>
    /** 套用动作清单模板（SPRITE_TEMPLATES 的 id） */
    applyTemplate(owner: SpriteOwner, id: ID, templateId: string): Promise<SpriteCharacter>
    useTake(owner: SpriteOwner, id: ID, actionId: ID, takeId: ID): Promise<SpriteCharacter>
    deleteTake(owner: SpriteOwner, id: ID, actionId: ID, takeId: ID): Promise<SpriteCharacter>
    /** 把一个版本拆成单独的动作 */
    splitTake(owner: SpriteOwner, id: ID, actionId: ID, takeId: ID): Promise<SpriteCharacter>
    /** 用同一个视频再建一个动作（各自在时间轴上选片段）；group 为 undefined 时和原动作同组，'auto' 按动作名归组 */
    extractAction(owner: SpriteOwner, id: ID, actionId: ID, name: string, group?: ID | null | 'auto'): Promise<SpriteCharacter>
    /** 用 2D 资产里的图片新建角色（人物素材），导出时回写这个资产 */
    fromAsset2D(owner: SpriteOwner, assetId: ID): Promise<SpriteCharacter>
    update(owner: SpriteOwner, id: ID, patch: SpriteCharacterPatch): Promise<SpriteCharacter>
    updateAction(owner: SpriteOwner, id: ID, actionId: ID, patch: SpriteActionPatch): Promise<SpriteCharacter>
    /** 把一套参数用到全部动作（片段起止、循环 / 单次各自保留） */
    applyParamsToAll(owner: SpriteOwner, id: ID, params: SpriteActionParams): Promise<SpriteCharacter>
    reorderActions(owner: SpriteOwner, id: ID, order: ID[]): Promise<SpriteCharacter>
    deleteAction(owner: SpriteOwner, id: ID, actionId: ID): Promise<SpriteCharacter>
    remove(owner: SpriteOwner, id: ID): Promise<void>
    /** 导出到 dir/<角色名>/；dir 为 null 时只存进 2D 资产库，仍可同步图集和动图到资料 / 图片素材 */
    export(owner: SpriteOwner, id: ID, payload: SpriteExportPayload, dir: string | null, names?: SpriteAssetNames): Promise<SpriteExportOutcome>
    /** 这个目录在不在 Godot 项目里；在的话返回对应的 res:// 路径 */
    detectGodot(dir: string): Promise<string | null>
    /** 在访达中显示导出的文件夹 */
    reveal(path: string): Promise<void>
    /** 把一张 RGBA 图写进系统剪贴板 */
    copyImage(rgba: Uint8Array, width: number, height: number): Promise<void>
  }

  clipboard: {
    /** 把图片原图写进系统剪贴板（可直接粘贴到 ChatGPT、PS 等）；成功返回 true */
    copyImage(ref: ImageRef): Promise<boolean>
    copyText(text: string): Promise<void>
  }

  shell: {
    /** 在访达中显示这张图片的原文件 */
    revealImage(ref: ImageRef): Promise<void>
    /** 用系统默认应用（预览、Photoshop…）打开原图 */
    openImage(ref: ImageRef): Promise<void>
    /** 开始一次系统原生拖拽：把原图文件拖到访达、ChatGPT、PS 等任何能接收文件的地方。在 dragstart 里 preventDefault 后调用 */
    dragImage(ref: ImageRef): Promise<void>
    /** 在访达中显示模型文件夹（选中里面的模型文件） */
    revealModel(id: ID): Promise<void>
    /** 原生拖拽整个模型文件夹（拖到访达、游戏项目里就是拷贝一份）。在 dragstart 里 preventDefault 后调用 */
    dragModel(id: ID): Promise<void>
    revealAsset2D(id: ID): Promise<void>
    /** 原生拖出整个 2D 资产文件夹 */
    dragAsset2D(id: ID): Promise<void>
  }

  /** 在线更新：到 GitHub Releases 按版本号检测，安装包下载到「下载」文件夹后由用户打开安装 */
  update: {
    getState(): Promise<UpdateState>
    /** 手动检查（忽略「跳过的版本」） */
    check(): Promise<UpdateState>
    download(): Promise<void>
    cancelDownload(): Promise<void>
    openDownloaded(): Promise<void>
    revealDownloaded(): Promise<void>
    openReleasePage(): Promise<void>
    skipVersion(version: string): Promise<void>
    setAutoCheck(on: boolean): Promise<void>
  }

  menu: {
    /** 在鼠标位置弹出系统原生右键菜单；返回点中项的 id，没选返回 null */
    popup(items: MenuItemSpec[]): Promise<string | null>
  }

  /** 拖进窗口的 File 对象对应的本地路径（Electron webUtils） */
  pathForFile(file: File): string

  /** 订阅数据变化；返回取消订阅函数 */
  onDataChanged(listener: (change: DataChange) => void): () => void
  /** 订阅更新状态变化；返回取消订阅函数 */
  onUpdateState(listener: (state: UpdateState) => void): () => void
  /** 订阅应用菜单发来的命令（新建项目、新建笔记、添加图片、查找）；返回取消订阅函数 */
  onCommand(listener: (command: AppCommand) => void): () => void
}

/** 图片地址：主进程注册的 gp:// 协议。thumb 给出缩略图的最长边像素，不给则是原图 */
export function imageUrl(ref: ImageRef, thumb?: number): string {
  const base =
    ref.scope === 'library'
      ? `gp://image/library/${encodeURIComponent(ref.id)}`
      : `gp://image/project/${encodeURIComponent(ref.projectId)}/${encodeURIComponent(ref.id)}`
  return thumb ? `${base}?thumb=${thumb}` : base
}

/**
 * 模型地址：gp://model/<id>/file/<文件夹里的相对路径>；预览图 gp://model/<id>/preview（thumb 同上）。
 * v 用来在缩略图重新渲染后让界面换掉缓存。
 */
export function modelFileUrl(id: ID, file: string): string {
  return `gp://model/${encodeURIComponent(id)}/file/${file.split('/').map(encodeURIComponent).join('/')}`
}

/** 2D 资产文件地址；相对路径的每一段分别编码 */
export function asset2dFileUrl(id: ID, rel: string): string {
  return `gp://asset2d/${encodeURIComponent(id)}/file/${rel.split('/').map(encodeURIComponent).join('/')}`
}

/** 序列帧动作的源视频（owner 为 null 是全局库的角色） */
export function spriteVideoUrl(owner: SpriteOwner, id: ID, actionId: ID, takeId?: ID): string {
  const scope = owner === null ? 'library' : `project/${encodeURIComponent(owner)}`
  const base = `gp://sprite/${scope}/${encodeURIComponent(id)}/${encodeURIComponent(actionId)}`
  return takeId ? `${base}?take=${encodeURIComponent(takeId)}` : base
}

/** 序列帧角色的人物图；thumb 同上 */
export function spriteRefUrl(owner: SpriteOwner, id: ID, refId: ID, thumb?: number): string {
  const scope = owner === null ? 'library' : `project/${encodeURIComponent(owner)}`
  const base = `gp://sprite-ref/${scope}/${encodeURIComponent(id)}/${encodeURIComponent(refId)}`
  return thumb ? `${base}?thumb=${thumb}` : base
}

export function modelPreviewUrl(model: { id: ID; preview: string | null; rendered: boolean }, thumb?: number): string {
  const q = new URLSearchParams()
  if (thumb) q.set('thumb', String(thumb))
  if (model.preview === null) q.set('v', model.rendered ? '1' : '0')
  const qs = q.toString()
  return `gp://model/${encodeURIComponent(model.id)}/preview${qs ? `?${qs}` : ''}`
}

/** IPC 通道名：`<模块>:<方法>`，如 library:listImages。数据变化事件通道： */
export const DATA_CHANGED_CHANNEL = 'data:changed'
/** 更新状态变化事件通道 */
export const UPDATE_STATE_CHANNEL = 'update:state'
/** 应用菜单命令事件通道 */
export const APP_COMMAND_CHANNEL = 'app:command'
