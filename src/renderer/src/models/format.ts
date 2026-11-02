// 3D 模型的显示文字：尺寸、面数、动作，以及「复制给 AI」的说明。
import type { LibModel, ModelAnimation } from '@shared/types'

const nf = new Intl.NumberFormat('en-US')

/** 36990 → 「36,990」 */
export function formatCount(n: number): string {
  return nf.format(Math.round(n))
}

/** 秒数 → 「2s」「1.33s」 */
export function formatSeconds(s: number): string {
  return `${Number(s.toFixed(2))}s`
}

const m2 = (v: number): string => String(Number(v.toFixed(2)))

/** 包围盒 → 「5.18 × 2.09 × 5.61 m」（宽 × 高 × 长） */
export function formatDims(size: LibModel['size']): string {
  return size ? `${m2(size[0])} × ${m2(size[1])} × ${m2(size[2])} m` : '—'
}

/** 网格卡片名称下面的小字 */
export function cardMeta(m: LibModel): string {
  const parts = [`${formatCount(m.triangles)} 面`]
  parts.push(m.animations.length > 0 ? `${m.animations.length} 个动作` : m.bones > 0 ? '已绑骨' : '静态')
  if (m.version) parts.push(`v${m.version}`)
  return parts.join(' · ')
}

/** 动作一项：「Idle（循环，2s）」；文件里的名字不同时带上 */
function animText(a: ModelAnimation): string {
  const bits: string[] = []
  if (a.loop) bits.push('循环')
  if (a.seconds > 0) bits.push(formatSeconds(a.seconds))
  if (a.clip && a.clip !== a.name) bits.push(`文件内名 ${a.clip}`)
  return bits.length > 0 ? `${a.name}（${bits.join('，')}）` : a.name
}

/** 「复制给 AI」：文件夹路径 + 名称、尺寸、动作，并写明先读 asset.json */
export function aiText(m: LibModel, folder: string): string {
  const lines = [
    `3D 模型资产：${m.name}（${m.id}）${m.version ? ` v${m.version}` : ''}`,
    `文件夹：${folder}`,
    `模型文件：${m.file}（${m.format}）`,
    `尺寸：${m.size ? `宽 ${m2(m.size[0])} × 高 ${m2(m.size[1])} × 长 ${m2(m.size[2])} m` : '未知'}`,
    `面数：${formatCount(m.triangles)}${m.bones > 0 ? `；骨骼：${m.bones}` : ''}`,
    `动作：${m.animations.length > 0 ? m.animations.map(animText).join('、') : '无'}`
  ]
  if (m.sockets.length > 0) lines.push(`挂点：${m.sockets.join('、')}`)
  lines.push(
    m.hasAssetJson
      ? '使用前先读文件夹里的 asset.json，按里面的坐标约定、动作名、事件时间点、挂点和引擎注意事项接入；把整个文件夹复制进游戏项目再用。'
      : '文件夹里没有 asset.json，以上信息从模型文件读出，动作名以模型文件里的为准；把整个文件夹复制进游戏项目再用。'
  )
  return lines.join('\n')
}
