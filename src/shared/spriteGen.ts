// 序列帧的「在软件里生成」和「从下载自动收件」。
// 生视频走本机的百炼命令行 bl（万相 3.0 首帧 / 首尾帧），生图走本机的 codex（ChatGPT 订阅自带的生图）。
// 收件：复制了某个动作的提示词（或设定图提示词）之后，「下载」里新出现的视频按文件名里的动作标签放进对应动作，
// 认不出标签的放进最近复制过提示词、还在等视频的那个动作；新图片放进刚复制过设定图提示词的角色。

import type { ID, ISODate } from './types'
import type { SpriteFacing, SpriteOwner } from './sprites'

export type SpriteVideoModel = 'wan3.0-video' | 'wan3.0-video-prime'
export type SpriteVideoResolution = '480P' | '720P' | '1080P'

/** 百炼文档价（元 / 秒） */
export const SPRITE_VIDEO_MODELS: Record<SpriteVideoModel, { label: string; price: Record<SpriteVideoResolution, number> }> = {
  'wan3.0-video': { label: '万相 3.0', price: { '480P': 0.3, '720P': 0.6, '1080P': 1.2 } },
  'wan3.0-video-prime': { label: '万相 3.0 高速版', price: { '480P': 0.45, '720P': 0.9, '1080P': 1.8 } }
}

export const SPRITE_VIDEO_RESOLUTIONS: SpriteVideoResolution[] = ['480P', '720P', '1080P']

export interface SpriteGenSettings {
  videoModel: SpriteVideoModel
  resolution: SpriteVideoResolution
  /** 视频时长（秒），2–10 */
  duration: number
  /** 每个动作一次生成几个版本，1–4 */
  takes: number
  /** 同时跑几个视频任务，1–4 */
  concurrency: number
  /** 复制提示词后，把「下载」里新出现的视频和图片自动收进来 */
  inbox: boolean
}

export const DEFAULT_GEN_SETTINGS: SpriteGenSettings = {
  videoModel: 'wan3.0-video',
  resolution: '480P',
  duration: 4,
  takes: 2,
  concurrency: 2,
  inbox: true
}

/** 预估费用（元），保留一位小数 */
export function estimateVideoCost(s: Pick<SpriteGenSettings, 'videoModel' | 'resolution' | 'duration'>, count: number): number {
  return Math.round(SPRITE_VIDEO_MODELS[s.videoModel].price[s.resolution] * s.duration * count * 10) / 10
}

export type SpriteJobState = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

/** 一个生成任务：一个视频版本，或一张人物图 */
export interface SpriteJob {
  id: ID
  kind: 'video' | 'image'
  owner: SpriteOwner
  characterId: ID
  characterName: string
  /** 视频：放进哪个动作；图片：null */
  actionId: ID | null
  /** 图片：画哪个朝向 */
  facing: SpriteFacing | null
  /** 显示名，如「attack1 · 第 1 个」「侧面设定图」 */
  label: string
  state: SpriteJobState
  /** 失败原因，或排队、生成中的说明 */
  message: string
  /** 预估费用（元）；codex 生图为 0 */
  cost: number
  createdAt: ISODate
  startedAt: ISODate | null
  finishedAt: ISODate | null
  /** 完成后得到的版本 id（视频）或人物图 id（图片） */
  resultId: ID | null
}

/** 等收件：复制了提示词，等「下载」里出现生成好的文件 */
export interface SpriteWaiting {
  owner: SpriteOwner
  characterId: ID
  /** 等哪个动作的视频；null 是等人物图（复制了设定图或定妆照提示词） */
  actionId: ID | null
  at: ISODate
}

/** 从「下载」收进来一个文件 */
export interface SpriteInboxEvent {
  owner: SpriteOwner
  characterId: ID
  characterName: string
  /** 视频放进的动作；图片为 null */
  actionId: ID | null
  actionName: string
  /** 新版本 id（视频）；图片为 null */
  takeId: ID | null
  /** 新人物图 id（图片）；视频为 null */
  refId: ID | null
  fileName: string
}

/** 本机找到的生成工具（可执行文件路径）；没装为 null */
export interface SpriteGenTools {
  bl: string | null
  codex: string | null
}

/** 主进程推给界面的序列帧事件；notice 是要提示给用户的一句话（如没有权限读「下载」） */
export type SpriteEvent =
  | { type: 'jobs'; jobs: SpriteJob[] }
  | { type: 'waiting'; waiting: SpriteWaiting[] }
  | { type: 'inbox'; event: SpriteInboxEvent }
  | { type: 'notice'; message: string; error: boolean }

/** 等收件多久（复制提示词之后） */
export const WAIT_HOURS = 2
