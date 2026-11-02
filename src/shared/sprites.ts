// 序列帧：把 AI 生成的「纯色背景、固定机位」角色动作视频提取成像素 Sprite Sheet。
// 每个项目、以及全局库，各有若干「角色」，一个角色有若干「动作」（每个动作一段视频）。
// 存在 projects/<id>/sprites/<角色 id>/character.json（全局库在 library/sprites/<角色 id>/），源视频拷贝在同目录的 videos/ 里。

import type { ID, ISODate } from './types'

/** 序列帧归属：项目 id；null 为全局库 */
export type SpriteOwner = ID | null

export const SPRITE_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v']

export type SpriteActionKind = 'auto' | 'loop' | 'once'
export type SpriteKeyMode = 'auto' | 'hue' | 'dist'
export type SpriteResample = 'mode' | 'box'
/** 水印区域：auto 自动检测（找不到时用固定区域）；none 不屏蔽；或 [x0, y0, x1, y1]（相对画面的 0–1 比例） */
export type SpriteWatermark = 'auto' | 'none' | [number, number, number, number]

/** 每个动作单独的参数（名称与命令行参考实现一致） */
export interface SpriteActionParams {
  /** 片段起始帧（含）；null 为自动 */
  start: number | null
  /** 片段结束帧（不含）；null 为自动 */
  end: number | null
  /** 循环 / 单次；auto 按动作名判断，判断不了再看首尾差异 */
  kind: SpriteActionKind
  /** 循环周期搜索范围（秒） */
  minPeriod: number
  maxPeriod: number
  /** 目标帧率 */
  fps: number
  /** 直接指定帧数（优先于 fps）；null 按 fps 算 */
  frames: number | null
  key: SpriteKeyMode
  /** 色相模式：色相容差（度）、背景最低饱和度、背景最低明度 */
  hueTol: number
  satMin: number
  valMin: number
  /** 距离模式容差（RGB 0–1 欧氏距离） */
  distTol: number
  /** 开运算次数 */
  open: number
  watermark: SpriteWatermark
  /** 去背景色溢出 */
  despill: boolean
  /** 缩小后的不透明阈值 */
  alphaThreshold: number
  /** 比例微调：1 不调，0.8–1.2；用于第 0 帧不是站姿的视频 */
  scaleTweak: number
  /** 只给这个动作用的像素身高；null 跟角色的「像素身高」 */
  height: number | null
  /** 只给这个动作用的颜色数（单独一套调色板）；null 和其他动作共用调色板 */
  colors: number | null
}

/** 整个角色共用的输出设置（像素身高、颜色数可以在动作参数里单独覆盖） */
export interface SpriteSettings {
  /** 像素身高：一个动作时指全部帧并集的高度；多个动作时指第 0 帧站姿身高 */
  height: number
  /** 调色板颜色数 */
  colors: number
  outline: boolean
  /** 每帧四周留白 */
  pad: number
  resample: SpriteResample
  /** 单个动作 sheet.png 的列数；null 一行排完 */
  cols: number | null
  /** 统一画布：所有动作用同一个单元格尺寸和落脚点 */
  unifiedCanvas: boolean
  /** 工作分辨率（长边）；null 自动 */
  work: number | null
}

/** 帧条上的手动改动：把源帧 from 换成 to；to 为 null 表示删掉这一帧 */
export interface SpriteFrameEdit {
  from: number
  to: number | null
}

export interface SpriteAction {
  id: ID
  /** 动作名：idle / run / 攻击…，也是导出时的动画名和文件夹名 */
  name: string
  /** videos/ 里的文件名 */
  video: string
  /** 导入时的原文件名 */
  sourceName: string
  bytes: number
  params: SpriteActionParams
  edits: SpriteFrameEdit[]
  addedAt: ISODate
}

export interface SpriteExportPrefs {
  /** 上次导出的目录（下次默认还导出到这里） */
  dir: string | null
  /** Godot 项目里的 res:// 目录；null 时按导出目录自动推算（往上找 project.godot），找不到写相对路径 */
  godotPrefix: string | null
  /** 导出时同时把图集和各动作动图存进项目资料（全局库的角色存进图片素材） */
  updateAssets: boolean
  /** 导出放大倍数：每个像素放大成 N×N（最近邻，不糊），1–8 */
  scale: number
  lastExportAt: ISODate | null
}

export interface SpriteCharacter {
  id: ID
  name: string
  settings: SpriteSettings
  actions: SpriteAction[]
  exportPrefs: SpriteExportPrefs
  /** 上次存进项目资料（或图片素材）的图片 id（再次导出时替换掉） */
  assetIds: ID[]
  createdAt: ISODate
  updatedAt: ISODate
}

export type SpriteCharacterPatch = Partial<Pick<SpriteCharacter, 'name' | 'settings' | 'exportPrefs'>>
export type SpriteActionPatch = Partial<Pick<SpriteAction, 'name' | 'params' | 'edits'>>

export const DEFAULT_SPRITE_PARAMS: SpriteActionParams = {
  start: null,
  end: null,
  kind: 'auto',
  minPeriod: 0.3,
  maxPeriod: 2.0,
  fps: 12,
  frames: null,
  key: 'auto',
  hueTol: 35,
  satMin: 0.25,
  valMin: 0.2,
  distTol: 0.15,
  open: 1,
  watermark: 'auto',
  despill: true,
  alphaThreshold: 0.5,
  scaleTweak: 1,
  height: null,
  colors: null
}

export const DEFAULT_SPRITE_SETTINGS: SpriteSettings = {
  height: 64,
  colors: 16,
  outline: true,
  pad: 1,
  resample: 'mode',
  cols: null,
  unifiedCanvas: false,
  work: null
}

/** 自动检测失败时用的固定水印区域（右下角） */
export const FALLBACK_WATERMARK: [number, number, number, number] = [0.62, 0.82, 1, 1]

// ---------- 动作名识别 ----------

export const LOOP_ACTIONS = ['idle', 'walk', 'run'] as const
export const ONCE_ACTIONS = ['jump', 'attack', 'hit', 'death'] as const

const ACTION_WORDS: ReadonlyArray<[string, RegExp]> = [
  ['idle', /idle|stand|待机|站立|呼吸/i],
  ['walk', /walk|行走|走路|步行/i],
  ['run', /run|sprint|跑步|奔跑|跑/i],
  ['jump', /jump|跳跃|起跳|跳/i],
  ['attack', /attack|atk|slash|攻击|挥砍|砍/i],
  ['hit', /hit|hurt|damage|受击|受伤|被击/i],
  ['death', /death|die|dead|死亡|倒地|阵亡/i]
]

/** 从文件名认出标准动作名；认不出返回 null */
export function detectActionName(fileName: string): string | null {
  const stem = fileName.replace(/\.[^.]+$/, '')
  // 英文按词边界匹配（run 不能匹配 brunt），中文直接包含
  for (const [name, re] of ACTION_WORDS) {
    const m = stem.match(re)
    if (!m) continue
    const i = m.index ?? 0
    const isAscii = /^[a-z]+$/i.test(m[0])
    if (!isAscii) return name
    const before = i === 0 ? '' : stem[i - 1]
    const after = stem[i + m[0].length] ?? ''
    if (!/[a-z]/i.test(before) && !/[a-z]/i.test(after)) return name
  }
  return null
}

/** 动作名属于循环类 / 单次类；都不是返回 null（由首尾差异判断） */
export function actionKindOfName(name: string): 'loop' | 'once' | null {
  const n = detectActionName(name) ?? name.toLowerCase()
  if ((LOOP_ACTIONS as readonly string[]).includes(n)) return 'loop'
  if ((ONCE_ACTIONS as readonly string[]).includes(n)) return 'once'
  return null
}

/** 死亡动作不要求回到备战姿势 */
export function isDeathAction(name: string): boolean {
  return (detectActionName(name) ?? name.toLowerCase()) === 'death'
}

/** 文件、文件夹名里不能用的字符换成下划线 */
export function safeFileName(name: string, fallback = 'sprite'): string {
  const s = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80)
  return s || fallback
}

// ---------- 导出（界面算好像素和元数据，主进程写文件） ----------

export interface SpriteExportAction {
  /** 动作名：动画名、文件夹名 */
  name: string
  loop: boolean
  /** 播放帧率 */
  fps: number
  frameWidth: number
  frameHeight: number
  /** 单元格内的落脚点（整数像素） */
  pivot: [number, number]
  /** 单动作 sheet.png 的列数 */
  cols: number
  /** 每帧 RGBA（frameWidth × frameHeight × 4），Alpha 只有 0 和 255，透明像素 RGB 为 0 */
  frames: Uint8Array[]
  /** 每帧对应的源视频帧号 */
  sourceFrames: number[]
  /** 原样写进通用 JSON 这个动作的条目里（源视频、片段、背景色、循环检测结果等） */
  meta: Record<string, unknown>
}

export interface SpriteExportBundle {
  /** 角色名（已经是安全的文件名） */
  name: string
  /** 共享调色板 '#rrggbb'（单独设了颜色数的动作，调色板在它的 meta.palette 里） */
  palette: string[]
  /** 输出像素 ÷ 源像素（含导出放大倍数） */
  pixelScale: number
  /** 导出放大倍数（帧尺寸、落脚点都已经乘过） */
  exportScale: number
  /** 所有动作对齐用的公共画布：每个动作的单元格放进去时落脚点重合 */
  canvas: { width: number; height: number; pivot: [number, number] }
  actions: SpriteExportAction[]
  /** 质检结果，写成 report.json */
  report: unknown
  /** Godot 的 res:// 目录（如 res://art/hero）；null 时 .tres / .tscn 里写相对路径 */
  godotPrefix: string | null
  appVersion: string
}

export interface SpriteExportResult {
  /** 写出的角色文件夹 */
  folder: string
  files: number
}
