// 「用 Claude Code 生成模型」的提示词模板：按资产库约定（<id>/export/ = glb + asset.json + preview.png）
// 让 Claude Code 在本机用 Blender 脚本做出一个 3D 资产。
import type { ModelCategory, Style } from '@shared/types'

export type ConceptMode = 'codex' | 'refs' | 'none'

export const ENGINES = ['Godot 4', 'Cocos Creator 3', 'Unity', '通用'] as const
export type Engine = (typeof ENGINES)[number]

export const FACE_BUDGETS = [
  { value: '3000', label: '约 3 千面（小道具、移动端）' },
  { value: '10000', label: '约 1 万面（普通角色、怪物）' },
  { value: '40000', label: '约 4 万面（主角、Boss）' }
] as const

export interface GenerateSpec {
  /** 资产 id：英文小写 + 数字 + 下划线，也是文件夹名 */
  id: string
  name: string
  category: ModelCategory
  desc: string
  /** 尺寸说明，如「高约 1.8 m」 */
  size: string
  faces: string
  actions: string[]
  /** 资产库根目录 */
  root: string
  engine: Engine
  concept: ConceptMode
  /** 参考图的完整路径 */
  refs: string[]
  style: Style | null
}

export const ASSET_ID = /^[a-z][a-z0-9_]{1,47}$/

/** 各分类默认的动作 */
export const DEFAULT_ACTIONS: Record<ModelCategory, string[]> = {
  角色: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'],
  怪物: ['Idle', 'Walk', 'Attack', 'Hit', 'Death'],
  道具: [],
  场景: [],
  载具: [],
  其他: []
}

/** 可以点一下加上的常用动作 */
export const ACTION_PRESETS = ['Idle', 'Walk', 'Run', 'Jump', 'Attack', 'Cast', 'Hit', 'Death', 'Fly', 'Roar', 'Open', 'Spin']

const LOOP_NAME = /^(idle|walk|run|fly|swim|move|spin|待机|走|跑|飞|游)/i

export const isLoopAction = (name: string): boolean => LOOP_NAME.test(name.trim())

const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'

function actionLine(actions: string[]): string {
  if (actions.length === 0) return '静态模型，不绑骨，没有动作'
  return actions.map((a) => (isLoopAction(a) ? `${a}（循环）` : a)).join('、')
}

function conceptStep(spec: GenerateSpec): string {
  const dir = `${spec.id}/concept/`
  if (spec.concept === 'refs' && spec.refs.length > 0) {
    return `设定图：先看上面的参考图，造型和配色以它为准；把参考图复制到 ${dir}。`
  }
  if (spec.concept === 'codex') {
    return [
      `设定图：用本机 Codex CLI 生成两张（三视图 model sheet、主视觉），放到 ${dir}：`,
      `   codex exec --skip-git-repo-check -s read-only "Use your built-in image generation tool to create exactly one image ... reply DONE. Image description: <描述>" < /dev/null`,
      '   （命令末尾必须有 < /dev/null；图片在 ~/.codex/generated_images/<会话 id>/ 下）'
    ].join('\n')
  }
  return '不需要设定图，直接按描述建模。'
}

/** 拼出完整提示词 */
export function buildGeneratePrompt(spec: GenerateSpec): string {
  const id = spec.id || '<资产id>'
  const s = { ...spec, id }
  const rigged = spec.actions.length > 0
  const need: string[] = [
    `- 分类：${spec.category}`,
    `- 描述：${spec.desc.trim() || '（待补充）'}`
  ]
  if (spec.size.trim()) need.push(`- 尺寸：${spec.size.trim()}`)
  need.push(`- 面数：${FACE_BUDGETS.find((f) => f.value === spec.faces)?.label ?? spec.faces}`)
  need.push(`- 动作：${actionLine(spec.actions)}`)
  if (spec.style) {
    const st = spec.style
    need.push(`- 风格：${st.name}${st.desc ? ` — ${st.desc}` : ''}`)
    if (st.palette.length > 0) need.push(`- 配色：${st.palette.join(' ')}`)
    if (st.prompt.trim()) need.push(`- 风格提示词：${st.prompt.trim().replace(/\s*\n\s*/g, ' ')}`)
  }
  if (spec.refs.length > 0) need.push(`- 参考图：${spec.refs.join('、')}`)
  need.push(`- 目标引擎：${spec.engine}`)

  const steps = [
    `先读 CATALOG.md，再看已有资产（比如 dark_dragon/）的 README.md、blender/ 脚本和 export/asset.json，沿用同样的目录结构、脚本拆分和 asset.json 字段。`,
    conceptStep(s),
    `用 Blender 脚本程序化建模、展 UV、做贴图${rigged ? '、绑骨、做动作' : ''}，烘焙后导出 GLB。脚本放 ${id}/blender/，按 01_model、02_rig… 拆开，可以一键重跑：\n   ${BLENDER} -b --factory-startup --python <脚本>`,
    `约定：单位米，+Y 朝上，正面朝 glTF +Z，原点在脚底中心；贴图内嵌进 GLB；${rigged ? '原地动作、不带根运动，循环动作在 GLB 里的名字加 _loop 后缀；' : ''}面数不超过上面的要求。`,
    `交付 ${id}/export/：${id}.glb、asset.json（版本 1.0.0；尺寸、面数、骨骼、动作表含时长 / 是否循环 / 事件时间点、挂点、${spec.engine === '通用' ? '各引擎' : `${spec.engine} `}注意事项）、preview.png（3/4 视角，浅色背景）。再写 ${id}/README.md：规格、动作表、重新生成的命令。`,
    `自检：用 Blender 重新导入 GLB，核对面数、骨骼数、动作名和时长与 asset.json 一致；然后跑 python3 tools/build_catalog.py 更新 CATALOG.md。`,
    `做完告诉我 export/ 的路径，附上 preview.png。`
  ]

  return [
    `在资产库 ${spec.root || '<资产库目录>'} 里新做一个 3D 游戏资产：${spec.name.trim() || '<名称>'}（id：${id}）。`,
    '',
    '【需求】',
    ...need,
    '',
    '【做法】',
    ...steps.map((t, i) => `${i + 1}. ${t}`)
  ].join('\n')
}
