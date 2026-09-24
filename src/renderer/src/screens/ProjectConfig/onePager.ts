// 分辨率换算（按 1920×1080 屏幕）和「项目一页纸」纯文本。
import type { Project, ProjectSizes, ScalingMode, Size2, Style } from '@shared/types'

export const SCREEN: Size2 = { w: 1920, h: 1080 }

export const SCALING_OPTIONS: ReadonlyArray<{ value: ScalingMode; label: string }> = [
  { value: 'integer', label: '整数缩放' },
  { value: 'fit', label: '等比适配' },
  { value: 'stretch', label: '拉伸' }
]

export const SIZE_ITEMS: ReadonlyArray<{ key: keyof ProjectSizes; label: string }> = [
  { key: 'tile', label: '瓦片' },
  { key: 'character', label: '角色' },
  { key: 'boss', label: 'Boss' },
  { key: 'icon', label: '图标' }
]

export function sizeLabel(s: Size2): string {
  return `${s.w}×${s.h}`
}

const EPS = 1e-9
const isWhole = (n: number): boolean => Math.abs(n - Math.round(n)) < EPS

/** 倍数：整数原样，小数最多两位（1.5、2.67） */
function factorText(n: number): string {
  return isWhole(n) ? String(Math.round(n)) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export interface ScaleResult {
  /** 横向、纵向放大倍数 */
  fx: number
  fy: number
  /** 如「放大 6 倍 = 1920×1080」「拉伸到 1920×1080」 */
  summary: string
  /** 如「铺满」「四周留黑边」 */
  fit: string
}

export function computeScale(res: Size2, mode: ScalingMode): ScaleResult {
  const sx = SCREEN.w / res.w
  const sy = SCREEN.h / res.h
  let fx: number
  let fy: number
  if (mode === 'integer') {
    fx = fy = Math.max(1, Math.floor(Math.min(sx, sy) + EPS))
  } else if (mode === 'fit') {
    fx = fy = Math.min(sx, sy)
  } else {
    fx = sx
    fy = sy
  }
  const out = { w: Math.round(res.w * fx), h: Math.round(res.h * fy) }
  const summary =
    Math.abs(fx - fy) > EPS
      ? `拉伸到 ${sizeLabel(SCREEN)}`
      : `放大 ${factorText(fx)} 倍 = ${sizeLabel(out)}`
  const full = out.w === SCREEN.w && out.h === SCREEN.h
  const fit = !full ? '四周留黑边' : isWhole(fx) && isWhole(fy) ? '铺满' : '铺满 · 非整数倍'
  return { fx, fy, summary, fit }
}

export function scalingLabel(mode: ScalingMode): string {
  return SCALING_OPTIONS.find((o) => o.value === mode)?.label ?? ''
}

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim()

/** 按当前配置拼出的一页纸，可以直接贴给别人或 ChatGPT */
export function buildOnePager(p: Project, style: Style | undefined): string {
  const scale = computeScale(p.resolution, p.scaling)
  const lines: string[] = [oneLine(p.name) || '未命名项目']
  if (oneLine(p.pitch)) lines.push(oneLine(p.pitch))
  lines.push(
    '',
    `类型：${p.genres.join('、') || '未选'}`,
    `平台：${p.platforms.join('、') || '未选'}`,
    `目标玩家：${oneLine(p.targetPlayers) || '未填'}`,
    `单局时长：${p.sessionLength || '未设置'}`,
    ''
  )
  if (style) {
    const desc = oneLine(style.desc).replace(/[。.]$/, '')
    lines.push(`美术风格：${style.name}${desc ? `，${desc}` : ''}`)
  } else {
    lines.push('美术风格：未选')
  }
  lines.push(
    `分辨率：${sizeLabel(p.resolution)}，${scalingLabel(p.scaling)}，${scale.summary}`,
    `尺寸：${SIZE_ITEMS.map((s) => `${s.label} ${sizeLabel(p.sizes[s.key])}`).join('、')}`
  )
  return lines.join('\n')
}
