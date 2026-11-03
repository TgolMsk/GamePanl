// 序列帧：把 AI 生成的「纯色背景、固定机位」角色动作视频提取成像素 Sprite Sheet。
// 每个项目、以及全局库，各有若干「角色」，一个角色有人物素材（立绘、三视图…）和若干「动作」（按分组排列）。
// 一个动作可以有几个视频版本（AI 常要生成好几次），选中的那个参与处理和导出；还没有视频的动作是「待生成」。
// 存在 projects/<id>/sprites/<角色 id>/character.json（全局库在 library/sprites/<角色 id>/），
// 源视频拷贝在同目录的 videos/ 里，人物素材在 refs/ 里。

import type { ID, ISODate } from './types'

/** 序列帧归属：项目 id；null 为全局库 */
export type SpriteOwner = ID | null

export const SPRITE_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v']
export const SPRITE_REF_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

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
  /** 调色板取色来源：video 从视频里取；reference 从人物主图取（各动作颜色和设定图一致） */
  paletteFrom: SpritePaletteFrom
}

export type SpritePaletteFrom = 'video' | 'reference'

/** 帧条上的手动改动：把源帧 from 换成 to；to 为 null 表示删掉这一帧 */
export interface SpriteFrameEdit {
  from: number
  to: number | null
}

/** 版本从哪来：file 手动导入；inbox 复制提示词后从「下载」自动收进来；generate 在软件里生成 */
export type SpriteTakeVia = 'file' | 'inbox' | 'generate'

/** 动作的一个视频版本；片段起止和换帧记录跟着视频走，切换版本时各自保留 */
export interface SpriteTake {
  id: ID
  /** videos/ 里的文件名 */
  video: string
  sourceName: string
  bytes: number
  start: number | null
  end: number | null
  edits: SpriteFrameEdit[]
  /** 生成这个版本用的提示词（软件里生成、或复制提示词后收进来的）；不知道时为空 */
  prompt: string
  via: SpriteTakeVia
  addedAt: ISODate
}

export interface SpriteAction {
  id: ID
  /** 动作名：idle / run / 攻击…，也是导出时的动画名和文件夹名 */
  name: string
  /** 所在分组；null 为未分组 */
  group: ID | null
  /** 动作说明（写进生成提示词）；空时按动作名用内置说明 */
  brief: string
  /** 当前版本的视频（videos/ 里的文件名）；空字符串表示「待生成」，还没有视频 */
  video: string
  /** 当前版本导入时的原文件名 */
  sourceName: string
  bytes: number
  /** 全部视频版本（含当前版本）；待生成时为空 */
  takes: SpriteTake[]
  params: SpriteActionParams
  edits: SpriteFrameEdit[]
  /** 「每个动作单独存」时，这个动作上次存进 2D 资产库的资产 id（再次导出时更新它） */
  asset2dId: ID | null
  addedAt: ISODate
}

/** 动作分组：移动、攻击、受击… */
export interface SpriteGroup {
  id: ID
  name: string
}

/** 人物素材：立绘、三视图、配件参考等，拷进角色目录的 refs/ */
export interface SpriteRef {
  id: ID
  /** refs/ 里的文件名 */
  file: string
  /** 显示名（原文件名去掉扩展名） */
  name: string
  width: number
  height: number
  bytes: number
  /** 定妆照（首帧图）的朝向；普通人物图为 null。每个朝向最多一张 */
  facing: SpriteFacing | null
  /** 定妆照是用哪张人物图做的（重做时默认用它） */
  from: ID | null
  addedAt: ISODate
}

/**
 * 定妆照朝向：侧面（横版，俯视角的左右）、正面（俯视角朝下）、背面（俯视角朝上）。
 * 所有动作都从同一张定妆照生成（首帧，单次动作首尾帧都用它），角色才不会一个动作一个样。
 */
export type SpriteFacing = 'side' | 'front' | 'back'

export const SPRITE_FACING_LABELS: Record<SpriteFacing, string> = { side: '侧面', front: '正面', back: '背面' }

/** 首帧图画幅（和生成视频的画面比例一致） */
export type SpriteAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

export const SPRITE_ASPECTS: Record<SpriteAspect, [number, number]> = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [960, 960],
  '4:3': [1088, 816],
  '3:4': [816, 1088]
}

/** 首帧图底色：人物身上有绿色时换蓝底或品红底，抠图才不会把它抠掉 */
export type SpriteScreen = 'green' | 'blue' | 'magenta'

export const SPRITE_SCREENS: Record<SpriteScreen, { label: string; hex: string; rgb: [number, number, number]; text: string }> = {
  green: { label: '绿底', hex: '#00FF00', rgb: [0, 255, 0], text: '纯绿色背景（#00FF00）' },
  blue: { label: '蓝底', hex: '#0000FF', rgb: [0, 0, 255], text: '纯蓝色背景（#0000FF）' },
  magenta: { label: '品红底', hex: '#FF00FF', rgb: [255, 0, 255], text: '纯品红色背景（#FF00FF）' }
}

/** 首帧图设置（整个角色共用，几张定妆照大小一致） */
export interface SpriteFrameSetup {
  aspect: SpriteAspect
  /** 人物占画面高度，0.4–0.8 */
  fill: number
  screen: SpriteScreen
}

export const DEFAULT_FRAME_SETUP: SpriteFrameSetup = { aspect: '16:9', fill: 0.6, screen: 'green' }

/** 视角：决定生成提示词里怎么写朝向 */
export type SpriteView = 'side' | 'topdown' | 'front'

export const SPRITE_VIEW_LABELS: Record<SpriteView, string> = { side: '横版侧面', topdown: '俯视角', front: '正面' }

export type SpriteAssets2DMode = 'character' | 'action'

export interface SpriteExportPrefs {
  /** 上次导出的目录（下次默认还导出到这里） */
  dir: string | null
  /** Godot 项目里的 res:// 目录；null 时按导出目录自动推算（往上找 project.godot），找不到写相对路径 */
  godotPrefix: string | null
  /** 导出时同时把图集和各动作动图存进项目资料（全局库的角色存进图片素材） */
  updateAssets: boolean
  /** 导出时存进 2D 资产库，再次导出时更新同一个资产 */
  toAssets2D: boolean
  /** 存进 2D 资产库的方式：整个角色一个资产，或每个动作单独一个资产 */
  assets2dMode: SpriteAssets2DMode
  /** 导出时不要的动作（默认全部导出） */
  skip: ID[]
  /** 导出放大倍数：每个像素放大成 N×N（最近邻，不糊），1–8 */
  scale: number
  lastExportAt: ISODate | null
}

export interface SpriteCharacter {
  id: ID
  name: string
  settings: SpriteSettings
  /** 人物素材；mainRef 是主图（头像、提示词参考图、调色板取色） */
  refs: SpriteRef[]
  mainRef: ID | null
  /** 人物描述：外貌、服装、武器、画风，写进生成提示词 */
  description: string
  view: SpriteView
  /** 每条提示词末尾追加的补充要求 */
  promptExtra: string
  /** 首帧图（定妆照）的画幅、人物大小、底色 */
  frameSetup: SpriteFrameSetup
  groups: SpriteGroup[]
  actions: SpriteAction[]
  exportPrefs: SpriteExportPrefs
  /** 上次存进项目资料（或图片素材）的图片 id（再次导出时替换掉） */
  assetIds: ID[]
  /** 上次存进 2D 资产库的资产 id（再次导出时替换掉） */
  asset2dId: ID | null
  createdAt: ISODate
  updatedAt: ISODate
}

export type SpriteCharacterPatch = Partial<
  Pick<SpriteCharacter, 'name' | 'settings' | 'exportPrefs' | 'mainRef' | 'description' | 'view' | 'promptExtra' | 'groups' | 'frameSetup'>
>
export type SpriteActionPatch = Partial<Pick<SpriteAction, 'name' | 'params' | 'edits' | 'group' | 'brief'>>

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
  work: null,
  paletteFrom: 'video'
}

/** 自动检测失败时用的固定水印区域（右下角） */
export const FALLBACK_WATERMARK: [number, number, number, number] = [0.62, 0.82, 1, 1]

// ---------- 动作名识别 ----------

export const LOOP_ACTIONS = ['idle', 'walk', 'run', 'fall', 'climb', 'talk'] as const
export const ONCE_ACTIONS = ['jump', 'land', 'dash', 'roll', 'attack', 'skill', 'shoot', 'block', 'hit', 'death', 'victory'] as const

// 顺序有讲究：先认更具体的词（「跳」在「跳跃」里，「射」在「射击」里）
const ACTION_WORDS: ReadonlyArray<[string, RegExp]> = [
  ['idle', /idle|stand|待机|站立|呼吸/i],
  ['walk', /walk|行走|走路|步行/i],
  ['run', /run|sprint|跑步|奔跑|跑/i],
  ['jump', /jump|跳跃|起跳|跳/i],
  ['fall', /fall|下落|坠落/i],
  ['land', /land|落地|着地/i],
  ['dash', /dash|冲刺|闪避/i],
  ['roll', /roll|翻滚/i],
  ['climb', /climb|攀爬/i],
  ['attack', /attack|atk|slash|攻击|挥砍|砍/i],
  ['skill', /skill|cast|spell|技能|施法/i],
  ['shoot', /shoot|射击|开枪/i],
  ['block', /block|guard|defend|格挡|防御/i],
  ['hit', /hit|hurt|damage|受击|受伤|被击/i],
  ['death', /death|die|dead|死亡|倒地|阵亡/i],
  ['victory', /victory|win|胜利|欢呼/i],
  ['talk', /talk|speak|说话|对话/i]
]

/** 从文件名认出标准动作名；认不出返回 null */
export function detectActionName(fileName: string): string | null {
  const stem = fileName.replace(/\.[^.]+$/, '')
  // 英文按词边界匹配（run 不能匹配 brunt），中文直接包含
  for (const [name, re] of ACTION_WORDS) {
    for (const m of stem.matchAll(new RegExp(re.source, 'gi'))) {
      const i = m.index ?? 0
      if (!/^[a-z]+$/i.test(m[0])) return name
      const before = i === 0 ? '' : stem[i - 1]
      const after = stem[i + m[0].length] ?? ''
      if (!/[a-z]/i.test(before) && !/[a-z]/i.test(after)) return name
    }
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

// ---------- 分组、动作清单模板、生成提示词 ----------

/** 标准分组（导入时按动作名自动归组，模板也用这几个） */
export const SPRITE_STANDARD_GROUPS = ['移动', '攻击', '受击', '交互', '其他'] as const

const GROUP_OF: Record<string, string> = {
  idle: '移动', walk: '移动', run: '移动', jump: '移动', fall: '移动', land: '移动', dash: '移动', roll: '移动', climb: '移动',
  attack: '攻击', skill: '攻击', shoot: '攻击', block: '攻击',
  hit: '受击', death: '受击',
  victory: '交互', talk: '交互'
}

/** 动作默认归到哪个标准分组 */
export function defaultGroupName(actionName: string): string {
  return GROUP_OF[detectActionName(actionName) ?? ''] ?? '其他'
}

/** 内置动作说明（写进提示词）；按标准动作名 */
const BRIEFS: Record<string, string> = {
  idle: '原地待机，身体随呼吸轻微起伏，重心稳定',
  walk: '原地行走循环，腿和手臂自然摆动，身体不往前移动',
  run: '原地奔跑循环，身体略前倾、手臂大幅摆动，身体不往前移动',
  jump: '原地起跳：先下蹲蓄力，向上跳起，在最高点稍停后落回原地',
  fall: '空中下落姿势的循环，手脚略张开，衣服和头发向上飘',
  land: '从空中落地，屈膝缓冲后站直',
  dash: '向前冲刺：身体快速前倾突进再收回，全程在原地完成',
  roll: '原地向前翻滚一圈后起身',
  climb: '攀爬循环，双手交替向上抓、双脚交替蹬',
  attack: '挥动武器快速攻击一次，收招回到备战姿势',
  skill: '释放技能：举起武器或双手聚力，再向前释放，最后收招',
  shoot: '举起武器瞄准并射击一次，带一点后坐力，再收回',
  block: '举起武器或盾牌格挡，保持一下再放下',
  hit: '被击中，身体向后仰、表情吃痛，随即恢复站姿',
  death: '被击倒，身体失去力气向后倒在地上，最后静止不动',
  victory: '胜利欢呼，举起武器或拳头庆祝',
  talk: '站着说话，头部和手势随说话自然变化'
}

export function defaultBrief(actionName: string): string {
  return BRIEFS[detectActionName(actionName) ?? ''] ?? ''
}

export interface SpriteTemplateAction {
  name: string
  group: string
  kind: 'loop' | 'once'
  /** 和内置说明不同时才写 */
  brief?: string
}

/** 动作清单模板：按游戏类型列出通常要做的动作 */
export interface SpriteTemplate {
  id: string
  name: string
  hint: string
  view: SpriteView
  actions: SpriteTemplateAction[]
}

const t = (name: string, kind: 'loop' | 'once', brief?: string): SpriteTemplateAction => ({ name, group: defaultGroupName(name), kind, brief })

export const SPRITE_TEMPLATES: SpriteTemplate[] = [
  {
    id: 'side-action',
    name: '横版动作',
    hint: '横版 ARPG、清版过关：三段连招、技能、受击死亡',
    view: 'side',
    actions: [
      t('idle', 'loop'), t('walk', 'loop'), t('run', 'loop'), t('jump', 'once'),
      t('attack1', 'once', '第一段普通攻击：快速向前挥砍'),
      t('attack2', 'once', '第二段普通攻击：反手挥砍，接在第一段之后'),
      t('attack3', 'once', '第三段重击：蓄力后用力劈下'),
      t('skill', 'once'), t('hit', 'once'), t('death', 'once')
    ]
  },
  {
    id: 'platformer',
    name: '平台跳跃',
    hint: '横版跳跃闯关：起跳、下落、落地分开做，衔接更顺',
    view: 'side',
    actions: [
      t('idle', 'loop'), t('run', 'loop'), t('jump', 'once', '起跳上升：下蹲蓄力后向上跳起，停在上升姿势'),
      t('fall', 'loop'), t('land', 'once'), t('dash', 'once'), t('climb', 'loop'),
      t('attack', 'once'), t('hit', 'once'), t('death', 'once')
    ]
  },
  {
    id: 'topdown4',
    name: '俯视角 4 方向',
    hint: '俯视角 RPG：上、下、侧三个方向，朝左在引擎里水平翻转',
    view: 'topdown',
    actions: [
      t('idle_down', 'loop'), t('idle_up', 'loop'), t('idle_side', 'loop'),
      t('walk_down', 'loop'), t('walk_up', 'loop'), t('walk_side', 'loop'),
      t('attack_down', 'once'), t('attack_up', 'once'), t('attack_side', 'once'),
      t('hit', 'once'), t('death', 'once')
    ]
  },
  {
    id: 'turn-based',
    name: '回合制 / 卡牌',
    hint: '站桩战斗：待机、攻击、技能、防御、受击、胜利',
    view: 'side',
    actions: [t('idle', 'loop'), t('attack', 'once'), t('skill', 'once'), t('block', 'once'), t('hit', 'once'), t('death', 'once'), t('victory', 'once')]
  },
  {
    id: 'npc',
    name: 'NPC',
    hint: '城镇、剧情角色：待机、走路、说话',
    view: 'topdown',
    actions: [t('idle_down', 'loop'), t('walk_down', 'loop'), t('walk_side', 'loop'), t('talk', 'loop')]
  }
]

const DIRECTION_TEXT: Record<string, string> = {
  down: '角色正面朝向镜头',
  front: '角色正面朝向镜头',
  up: '角色背对镜头',
  back: '角色背对镜头',
  side: '角色侧身面朝画面右侧',
  right: '角色侧身面朝画面右侧',
  left: '角色侧身面朝画面左侧'
}

export const SPRITE_NEGATIVE_PROMPT =
  '镜头移动，镜头切换，背景变化，地面，阴影，多个角色，角色走出画面，造型变化，服装变化，颜色变化，多余的手脚，肢体扭曲，脸部崩坏，模糊，文字，字幕，水印，特效光'

/** 动作是循环还是单次（提示词用）：手动设了按设的，否则按动作名；认不出返回 null */
export function actionLoopKind(a: Pick<SpriteAction, 'name' | 'params'>): 'loop' | 'once' | null {
  return a.params.kind === 'auto' ? actionKindOfName(a.name) : a.params.kind
}

/** 动作该用哪个朝向的定妆照：动作名带方向（walk_down、attack_up、idle_side）按方向，否则按角色视角 */
export function actionFacing(view: SpriteView, actionName: string): SpriteFacing {
  const dir = fileNameTokens(actionName).map((x) => x.toLowerCase()).find(isDirectionWord)
  if (dir === 'down' || dir === 'front') return 'front'
  if (dir === 'up' || dir === 'back') return 'back'
  if (dir) return 'side'
  return view === 'side' ? 'side' : 'front'
}

/** 角色用得到的定妆照朝向（横版只要侧面，俯视角三个方向，正面视角只要正面） */
export function viewFacings(view: SpriteView): SpriteFacing[] {
  return view === 'side' ? ['side'] : view === 'topdown' ? ['front', 'back', 'side'] : ['front']
}

/** 这个朝向的定妆照 */
export function anchorRef(ch: Pick<SpriteCharacter, 'refs'>, facing: SpriteFacing): SpriteRef | null {
  return ch.refs.find((r) => r.facing === facing) ?? null
}

const FACING_TEXT: Record<SpriteFacing, string> = {
  side: '角色侧身面朝画面右侧',
  front: '角色正面朝向镜头',
  back: '角色背对镜头'
}

function viewText(view: SpriteView): string {
  return view === 'side' ? '横版游戏的侧视角' : view === 'topdown' ? '俯视角游戏，镜头从斜上方约 30° 俯视' : '正面视角'
}

export interface SpritePrompt {
  prompt: string
  negative: string
  /** 建议时长 */
  seconds: string
  /** 用定妆照当首帧（有这个朝向的定妆照时） */
  firstFrame: SpriteRef | null
  /** 尾帧也用同一张定妆照（单次动作，死亡除外） */
  lastFrame: boolean
}

/**
 * 给图生视频工具（Muse、可灵、即梦、万相…）用的提示词，分段写清主体、动作、机位、构图、背景、光照、一致性。
 * 第一行是动作标签（见 actionTag），下载的文件名会带上它，导回时自动归到这个动作。
 * 有定妆照时以它为首帧：单次动作首尾帧都用它，从同一个站姿开始、回到同一个站姿；循环和死亡动作只用首帧。
 * 没有定妆照时以人物主图为参考图。
 */
export function buildSpritePrompt(
  ch: Pick<SpriteCharacter, 'description' | 'view' | 'promptExtra' | 'refs' | 'frameSetup'>,
  a: Pick<SpriteAction, 'id' | 'name' | 'brief' | 'params'>
): SpritePrompt {
  const kind = actionLoopKind(a)
  const death = isDeathAction(a.name)
  const brief = (a.brief.trim() || defaultBrief(a.name) || a.name).replace(/[。.]$/, '')
  const anchor = anchorRef(ch, actionFacing(ch.view, a.name))
  const dirWord = fileNameTokens(a.name).map((x) => x.toLowerCase()).find(isDirectionWord)
  const facing = (dirWord && DIRECTION_TEXT[dirWord]) ?? (ch.view === 'side' ? FACING_TEXT.side : FACING_TEXT.front)
  const lastFrame = !!anchor && kind === 'once' && !death
  const ending = anchor
    ? kind === 'loop'
      ? '从首帧的站姿起势进入循环动作，以恒定节奏连续重复，直到视频结束；循环的首尾姿势完全一致，可以无缝循环。'
      : death
        ? '从首帧的站姿开始，最后倒地静止，保持到视频结束。'
        : lastFrame
          ? '动作只做一遍：首帧和尾帧是同一个站姿，从这个站姿开始做动作，最后回到完全相同的站姿。'
          : '从首帧的站姿开始做动作。'
    : kind === 'loop'
      ? '以恒定节奏连续重复这个循环，直到视频结束；动作首尾姿势完全一致，可以无缝循环。'
      : death
        ? '从站立姿势开始，最后倒地静止，保持到视频结束。'
        : kind === 'once'
          ? '动作只做一遍：从站立备战姿势开始，做完回到站立姿势。'
          : ''
  const desc = ch.description.trim().replace(/[。.]$/, '')
  const screen = SPRITE_SCREENS[ch.frameSetup.screen].text
  const source = anchor ? '首帧图' : '参考图'
  const lines = [
    `[${actionTag(a)}]`,
    anchor
      ? `【主体】首帧图中的角色${desc ? `：${desc}` : ''}。整个视频里角色的朝向和首帧图一致。`
      : `【主体】参考图中的角色${desc ? `：${desc}` : ''}。${facing}，整个视频保持这个朝向。`,
    `【动作】${brief}。${ending}`,
    `【机位】三脚架固定机位，整段视频镜头完全静止，不推拉、不摇移、不切换，一镜到底；${viewText(ch.view)}；长焦镜头，画面扁平，接近正交投影，没有透视畸变；高速快门，全身清晰对焦。`,
    anchor
      ? '【构图】角色的大小和位置与首帧图一致，每一帧都完整显示从头顶到脚底的全身；角色在原地做动作，身体在画面里的位置不变；双脚着地时始终踩在同一条看不见的水平地面线上。'
      : '【构图】角色水平居中，身高约占画面高度的一半，每一帧都完整显示从头顶到脚底的全身，头顶和脚下都留出空白；角色在原地做动作，身体在画面里的位置不变；双脚着地时始终踩在同一条看不见的水平地面线上。',
    `【背景】${screen}，平整均匀，每一帧从边缘到边缘完全一致；没有地面、阴影和任何环境元素，角色不投射阴影。`,
    '【光照】正面平光，均匀无阴影，全程不变；曝光和白平衡恒定。',
    `【一致性】每一帧的角色都和${source}完全一致：相同的脸、发型、身体比例、服装、颜色和配饰；武器始终在同一只手里，形状和长度不变；四肢轮廓分明，互不粘连。`,
    '【动作质量】关键姿势清晰有力，带预备动作和跟随动作；节奏稳定；每一帧清晰锐利，没有动态模糊。',
    '【画面纯净】画面里只有这一个角色；没有特效、粒子、尘土、拖尾、文字、字幕和水印。'
  ]
  if (ch.promptExtra.trim()) lines.push(ch.promptExtra.trim())
  return { prompt: lines.join('\n'), negative: SPRITE_NEGATIVE_PROMPT, seconds: '选最短时长（2–5 秒）', firstFrame: anchor, lastFrame }
}

function poseLines(ch: Pick<SpriteCharacter, 'view' | 'frameSetup'>, facing: SpriteFacing): string[] {
  const screen = SPRITE_SCREENS[ch.frameSetup.screen].text
  return [
    `【姿势】自然站立的待机姿势，双脚着地，手臂放松，武器拿在手里；${viewText(ch.view)}，${FACING_TEXT[facing]}。`,
    `【构图】全身完整入画，角色在画面正中，身高约占画面高度的 ${Math.round(ch.frameSetup.fill * 100)}%，头顶和脚下都留出空白；画面比例 ${ch.frameSetup.aspect}。`,
    `【背景】${screen}，纯色平整，从边缘到边缘完全一致；没有地面、阴影和任何环境元素；角色身上不要有接近背景色的颜色。`,
    '【画面】只有这一个角色；不要文字、水印、边框和签名。'
  ]
}

/**
 * 从零画角色的提示词（还没有人物图时用）：直接画成能当定妆照的样子（纯色底、全身、待机站姿、画幅和视频一致），
 * 画好就能拿去生成动作视频。style 是项目美术风格的生图提示词，没有时为空。
 */
export function buildDesignPrompt(ch: Pick<SpriteCharacter, 'description' | 'view' | 'promptExtra' | 'frameSetup'>, facing: SpriteFacing, style = ''): string {
  const desc = ch.description.trim().replace(/[。.]$/, '')
  const lines = [
    '【用途】2D 游戏角色的定妆照：之后用它当首帧生成动作视频，再抽帧做成序列帧。',
    `【角色】${desc ? `${desc}。` : '一个原创的游戏角色，外形按下面的风格设计。'}`,
    ...(style.trim() ? [`【风格】${style.trim().replace(/[。.]$/, '')}。`] : []),
    ...poseLines(ch, facing)
  ]
  if (ch.promptExtra.trim()) lines.push(ch.promptExtra.trim())
  return lines.join('\n')
}

/** 让生图工具照着人物图画一张标准定妆照的提示词（人物图背景复杂、去不干净时用） */
export function buildAnchorPrompt(ch: Pick<SpriteCharacter, 'description' | 'view' | 'promptExtra' | 'frameSetup'>, facing: SpriteFacing): string {
  const desc = ch.description.trim().replace(/[。.]$/, '')
  const lines = [
    '【用途】给参考图中的角色画一张定妆照：之后用它当首帧生成动作视频，再抽帧做成序列帧。',
    `【角色】参考图中的角色${desc ? `：${desc}` : ''}。保持角色的造型、服装、发型、配色和画风与参考图完全一致。`,
    ...poseLines(ch, facing)
  ]
  if (ch.promptExtra.trim()) lines.push(ch.promptExtra.trim())
  return lines.join('\n')
}

/** 方向后缀：俯视角游戏的 walk_down、attack_side… */
export const SPRITE_DIRECTIONS = ['down', 'up', 'left', 'right', 'side', 'front', 'back'] as const
const DIRECTION_RE = new RegExp(`^(${SPRITE_DIRECTIONS.join('|')})$`, 'i')

export const isDirectionWord = (t: string): boolean => DIRECTION_RE.test(t)

/** 文件名拆成词（下划线、横线、空格、括号、点、中英文标点都算分隔；即梦把提示词开头当文件名，标签后面常紧跟中文标点） */
export function fileNameTokens(fileName: string): string[] {
  return fileName
    .replace(/\.[^.]+$/, '')
    .split(/[\s_\-.()（）[\]【】,，。:：;；、!！?？"“”'‘’「」『』《》#]+/)
    .filter(Boolean)
}

/** 同一个文件下载两次时浏览器加的「 (1)」去掉后的文件名 */
export function stripCopySuffix(fileName: string): string {
  return fileName.replace(/\s*[(（]\d{1,3}[)）](?=\.[^.]+$|$)/, '')
}

/**
 * 写在视频提示词第一行的动作标签。生成网站下载的文件名会带上它：Muse 把提示词里的英文和数字按顺序连成文件名，
 * 即梦把提示词开头一段当文件名。英文动作名直接用；中文动作名用 act-<动作 id 前 6 位>。
 */
export function actionTag(a: Pick<SpriteAction, 'id' | 'name'>): string {
  return /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(a.name) ? a.name : `act-${a.id.slice(0, 6)}`
}

/** 文件名里的动作标签对应哪个动作：取在文件名里出现得最早的，同一位置取词数最多的（walk_down 优先于 walk）；没有返回 null */
export function actionFromTag<T extends Pick<SpriteAction, 'id' | 'name'>>(fileName: string, actions: readonly T[]): T | null {
  const tokens = fileNameTokens(fileName).map((t) => t.toLowerCase())
  let best: T | null = null
  let bestAt = Infinity
  let bestLen = 0
  for (const a of actions) {
    const kt = fileNameTokens(actionTag(a).toLowerCase())
    if (kt.length === 0) continue
    for (let i = 0; i + kt.length <= tokens.length && i <= bestAt; i++) {
      if (!kt.every((t, k) => tokens[i + k] === t)) continue
      if (i < bestAt || kt.length > bestLen) {
        best = a
        bestAt = i
        bestLen = kt.length
      }
      break
    }
  }
  return best
}

/**
 * 从视频文件名认出动作名。known 是角色里已有的动作名（含待生成的），文件名里包含其中某个（按词）时直接用它，
 * 取最长的那个（walk_down 优先于 walk）。否则找第一个动作词：紧跟的数字保留（attack2），后面跟方向词时带上（walk_down）。
 * 认不出返回 null。
 */
export function actionNameFromFile(fileName: string, known: readonly string[] = []): string | null {
  const tokens = fileNameTokens(fileName).map((t) => t.toLowerCase())
  const stem = fileName.replace(/\.[^.]+$/, '').toLowerCase()
  let best: string | null = null
  let bestLen = 0
  for (const name of known) {
    const kt = fileNameTokens(name).map((t) => t.toLowerCase())
    if (kt.length === 0) continue
    const ascii = kt.every((t) => /^[a-z0-9]+$/.test(t))
    let hit = false
    if (ascii) {
      for (let i = 0; i + kt.length <= tokens.length && !hit; i++) hit = kt.every((t, k) => tokens[i + k] === t)
    } else hit = stem.includes(name.toLowerCase())
    const len = name.length + kt.length * 100
    if (hit && len > bestLen) {
      best = name
      bestLen = len
    }
  }
  if (best) return best
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const digits = t.match(/\d+$/)?.[0] ?? ''
    const word = digits ? t.slice(0, -digits.length) : t
    if (!word) continue
    const base = detectActionName(word)
    if (!base) continue
    const dir = tokens[i + 1] && isDirectionWord(tokens[i + 1]) ? `_${tokens[i + 1]}` : ''
    return `${base}${digits ? String(Number(digits)) : ''}${dir}`
  }
  return null
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
  /** 对应的动作 id（每个动作单独存进 2D 资产库时用） */
  actionId?: ID
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
