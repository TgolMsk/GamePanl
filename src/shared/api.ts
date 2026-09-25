// 预加载脚本通过 contextBridge 暴露为 window.gp 的接口。
// 主进程在 src/main/ipc.ts 里按 IPC 通道名一一实现；界面只通过 window.gp 访问数据。

import type {
  AppInfo,
  DataChange,
  ID,
  ImageRef,
  LibImage,
  Note,
  Project,
  ProjectAsset,
  ProjectSummary,
  Prompt,
  Style,
  UpdateState
} from './types'

export type LibImagePatch = Partial<Pick<LibImage, 'name' | 'category' | 'tags'>>
export type PromptInput = Pick<Prompt, 'title' | 'body' | 'category'>
export type PromptPatch = Partial<PromptInput>
export type StyleInput = Pick<Style, 'name' | 'desc' | 'palette' | 'prompt' | 'sampleImageId'>
export type StylePatch = Partial<StyleInput>
export type ProjectPatch = Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>
export type NoteInput = Partial<Pick<Note, 'title' | 'category' | 'blocks'>>
export type AssetPatch = Partial<Pick<ProjectAsset, 'name' | 'category' | 'tags'>>

export interface GpApi {
  app: {
    getInfo(): Promise<AppInfo>
    /** 在访达中打开数据目录 */
    revealDataRoot(): Promise<void>
    /** 把内置的示例内容（图片、提示词、风格、示例项目「雾港」）导入进来；已存在的不重复导入 */
    importSample(): Promise<void>
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
  }

  projects: {
    list(): Promise<ProjectSummary[]>
    get(id: ID): Promise<Project>
    create(name: string): Promise<Project>
    update(id: ID, patch: ProjectPatch): Promise<Project>
    /** 整个项目文件夹移到系统废纸篓 */
    remove(id: ID): Promise<void>

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
  }

  clipboard: {
    /** 把图片原图写进系统剪贴板（可直接粘贴到 ChatGPT、PS 等）；成功返回 true */
    copyImage(ref: ImageRef): Promise<boolean>
    copyText(text: string): Promise<void>
  }

  shell: {
    /** 在访达中显示这张图片的原文件 */
    revealImage(ref: ImageRef): Promise<void>
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

  /** 拖进窗口的 File 对象对应的本地路径（Electron webUtils） */
  pathForFile(file: File): string

  /** 订阅数据变化；返回取消订阅函数 */
  onDataChanged(listener: (change: DataChange) => void): () => void
  /** 订阅更新状态变化；返回取消订阅函数 */
  onUpdateState(listener: (state: UpdateState) => void): () => void
}

/** 图片地址：主进程注册的 gp:// 协议。thumb 给出缩略图的最长边像素，不给则是原图 */
export function imageUrl(ref: ImageRef, thumb?: number): string {
  const base =
    ref.scope === 'library'
      ? `gp://image/library/${encodeURIComponent(ref.id)}`
      : `gp://image/project/${encodeURIComponent(ref.projectId)}/${encodeURIComponent(ref.id)}`
  return thumb ? `${base}?thumb=${thumb}` : base
}

/** IPC 通道名：`<模块>:<方法>`，如 library:listImages。数据变化事件通道： */
export const DATA_CHANGED_CHANNEL = 'data:changed'
/** 更新状态变化事件通道 */
export const UPDATE_STATE_CHANNEL = 'update:state'
