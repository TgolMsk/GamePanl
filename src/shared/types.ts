// 主进程、预加载脚本和界面共用的数据类型。
// 数据全部存在本地：~/GamePanl/library（全局库）和 ~/GamePanl/projects/<id>（各个项目）。

export type ID = string

/** ISO 8601 时间字符串 */
export type ISODate = string

export type ImageFormat = 'PNG' | 'JPG' | 'WEBP' | 'GIF'

// ---------- 全局库 ----------

export const IMAGE_CATEGORIES = ['角色', '怪物', '场景', 'UI', '图标', '瓦片', '参考', '其他'] as const
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number]

/** 全局库里的一张图片。原文件存在 library/images/<file> */
export interface LibImage {
  id: ID
  name: string
  file: string
  category: ImageCategory
  tags: string[]
  width: number
  height: number
  format: ImageFormat
  bytes: number
  addedAt: ISODate
}

export const PROMPT_CATEGORIES = ['风格', '用途', '约束', '构图', '负面词'] as const
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]

export interface Prompt {
  id: ID
  title: string
  body: string
  category: PromptCategory
  uses: number
  createdAt: ISODate
  updatedAt: ISODate
}

export interface Style {
  id: ID
  name: string
  /** 一句描述 */
  desc: string
  /** 5 个十六进制色值，如 #1b1f3a */
  palette: string[]
  /** 这个风格的生图提示词 */
  prompt: string
  /** 样张：全局库里一张图片的 id，没有则为 null */
  sampleImageId: ID | null
  createdAt: ISODate
  updatedAt: ISODate
}

// ---------- 项目 ----------

export const GENRE_OPTIONS = [
  '2D 横版动作',
  '轻解谜',
  '银河城',
  'Roguelite',
  '平台跳跃',
  '叙事冒险',
  '模拟经营',
  '卡牌构筑',
  '休闲益智'
] as const

export const PLATFORM_OPTIONS = [
  'PC（Steam）',
  'Switch',
  'iOS / Android',
  '微信小游戏',
  'PlayStation',
  'Xbox'
] as const

export const SESSION_OPTIONS = ['5–10 分钟', '20–40 分钟', '1 小时以上'] as const

export const RESOLUTION_OPTIONS: ReadonlyArray<{ w: number; h: number }> = [
  { w: 320, h: 180 },
  { w: 384, h: 216 },
  { w: 480, h: 270 },
  { w: 640, h: 360 },
  { w: 1280, h: 720 },
  { w: 1920, h: 1080 }
]

export type ScalingMode = 'integer' | 'fit' | 'stretch'

export interface Size2 {
  w: number
  h: number
}

export interface ProjectSizes {
  tile: Size2
  character: Size2
  boss: Size2
  icon: Size2
}

/** 项目配置，存在 projects/<id>/project.json */
export interface Project {
  id: ID
  name: string
  /** 一句话介绍 */
  pitch: string
  genres: string[]
  platforms: string[]
  targetPlayers: string
  sessionLength: string
  /** 选用的全局库风格 id */
  styleId: ID | null
  resolution: Size2
  scaling: ScalingMode
  sizes: ProjectSizes
  /** 封面：本项目资料里一张图的 id */
  coverAssetId: ID | null
  /** 常用提示词（全局库提示词 id） */
  pinnedPromptIds: ID[]
  createdAt: ISODate
  updatedAt: ISODate
}

export interface ProjectSummary {
  id: ID
  name: string
  noteCount: number
  assetCount: number
  coverAssetId: ID | null
  updatedAt: ISODate
}

export const NOTE_CATEGORIES = ['玩法', '故事', '关卡', '角色', '美术', '音频', '其他'] as const
export type NoteCategory = (typeof NOTE_CATEGORIES)[number]

/** 图片引用：指向全局库或某个项目资料里的图片 */
export type ImageRef =
  | { scope: 'library'; id: ID }
  | { scope: 'project'; projectId: ID; id: ID }

export type NoteBlock =
  | { id: ID; type: 'p'; text: string }
  | { id: ID; type: 'todo'; text: string; checked: boolean }
  | { id: ID; type: 'image'; image: ImageRef }

/** 一条笔记，存在 projects/<id>/notes/<noteId>.md（Markdown + 文件头字段） */
export interface Note {
  id: ID
  title: string
  category: NoteCategory
  done: boolean
  blocks: NoteBlock[]
  createdAt: ISODate
  updatedAt: ISODate
}

export const ASSET_CATEGORIES = ['概念图', '角色', '场景', '截图', '参考', 'UI', '其他'] as const
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

/** 项目资料里的一张图片。原文件存在 projects/<id>/assets/<file> */
export interface ProjectAsset {
  id: ID
  name: string
  file: string
  category: AssetCategory
  tags: string[]
  width: number
  height: number
  format: ImageFormat
  bytes: number
  addedAt: ISODate
  /** 从全局库添加时记录来源 */
  sourceLibraryId: ID | null
}

export interface AppInfo {
  version: string
  dataRoot: string
  /** macOS 系统强调色，如 #007AFF */
  accentColor: string
  platform: string
  /** 全局库是否还是空的（首次启动时用于提示导入示例内容） */
  libraryEmpty: boolean
}

/** 主进程在数据变化后广播的事件，界面据此刷新 */
export type DataChange =
  | { kind: 'library-images' }
  | { kind: 'library-prompts' }
  | { kind: 'library-styles' }
  | { kind: 'projects' }
  | { kind: 'project'; projectId: ID }
  | { kind: 'notes'; projectId: ID }
  | { kind: 'assets'; projectId: ID }
