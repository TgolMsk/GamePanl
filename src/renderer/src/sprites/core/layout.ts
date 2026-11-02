// 裁切与布局：单个动作按全部帧并集定比例；多个动作的角色共用一个缩放比和落脚点（按第 0 帧站姿身高）。
// 动作单独设了像素身高时，缩放比按「单独身高 ÷ 角色身高」换算，不参加统一画布。
// 坐标映射：输出 = (源坐标 − 参考点) × 缩放比 + 单元格内的落脚点。

import type { SrcBox } from './downsample'
import { median, roundHalfEven, type Rect } from './util'

/** 一个动作在工作分辨率上的几何量（由 Worker 测出） */
export interface ActionGeometry {
  workWidth: number
  workHeight: number
  /** 工作分辨率 ÷ 源分辨率 */
  workScale: number
  /** 选中帧前景并集包围盒 */
  union: Rect
  /** 第 0 帧前景包围盒高度（工作分辨率像素） */
  h0: number
  /** 参考点 x：第 0 帧前景的水平质心 */
  refX: number
  /** 地面线：选中帧前景最低行的最大值（不含），等于 union.y1 */
  ground: number
  /** 比例微调（1 不调） */
  tweak: number
}

export interface ActionLayout {
  /** 工作分辨率上的裁切框 */
  box: SrcBox
  /** 内容尺寸（不含留白） */
  cw: number
  ch: number
  /** 输出像素 ÷ 工作分辨率像素 */
  scale: number
  /** 输出像素 ÷ 源像素 */
  pixelScale: number
  /** 单元格尺寸（含留白） */
  frameWidth: number
  frameHeight: number
  /** 单元格内的落脚点（整数） */
  pivot: [number, number]
}

export interface CharacterLayout {
  mode: 'single' | 'character'
  actions: ActionLayout[]
  /** 各动作首帧身高（源像素）的最大相对差；单动作为 null */
  h0Spread: number | null
  /** 首帧身高不一致（> 3%），已按各自的首帧身高归一化 */
  h0Inconsistent: boolean
  /** 公共画布：所有动作放进去时落脚点重合 */
  canvas: { width: number; height: number; pivot: [number, number] }
  /** 角色级输出像素 ÷ 源像素（多动作时为共用缩放比） */
  pixelScale: number
}

export interface LayoutOptions {
  height: number
  pad: number
  outline: boolean
  unifiedCanvas: boolean
  /** 各动作单独设的像素身高；null 跟角色 */
  heights?: Array<number | null>
}

const up = (v: number): number => Math.max(0, Math.ceil(v - 1e-6))

export function layoutCharacter(geos: ActionGeometry[], o: LayoutOptions): CharacterLayout {
  const pad = Math.max(o.pad, o.outline ? 1 : 0)
  const below = o.outline ? 1 : 0
  if (geos.length === 1) {
    // 单个动作：像素身高 = 全部帧并集的高度（与参考实现一致）
    const g = geos[0]
    const u = g.union
    const ch = Math.max(1, roundHalfEven((o.heights?.[0] ?? o.height) * g.tweak))
    const s = ch / (u.y1 - u.y0)
    const cw = Math.max(1, roundHalfEven((u.x1 - u.x0) * s))
    const bw = cw / s
    const bx1 = Math.min(g.workWidth, u.x0 + bw)
    const bx0 = Math.max(0, bx1 - bw)
    const box = { x0: bx0, y0: u.y0, x1: bx0 + bw, y1: u.y1 }
    const px = Math.min(cw, Math.max(0, roundHalfEven((g.refX - bx0) * s)))
    const a: ActionLayout = {
      box,
      cw,
      ch,
      scale: s,
      pixelScale: s * g.workScale,
      frameWidth: cw + 2 * pad,
      frameHeight: ch + 2 * pad,
      pivot: [pad + px, pad + ch + below]
    }
    return {
      mode: 'single',
      actions: [a],
      h0Spread: null,
      h0Inconsistent: false,
      canvas: { width: a.frameWidth, height: a.frameHeight, pivot: a.pivot },
      pixelScale: a.pixelScale
    }
  }

  // 多个动作：按第 0 帧站姿身高共用一个缩放比
  const h0src = geos.map((g) => g.h0 / g.workScale)
  const valid = h0src.filter((v) => v > 0)
  const spread = valid.length ? Math.max(...valid) / Math.min(...valid) - 1 : 0
  const inconsistent = spread > 0.03
  const shared = o.height / Math.max(1e-6, median(valid)) // 输出像素 ÷ 源像素
  const scales = geos.map((g, i) => {
    // 输出像素 ÷ 工作分辨率像素（工作像素 = 源像素 × workScale）
    const base = inconsistent && g.h0 > 0 ? o.height / g.h0 : shared / g.workScale
    return base * g.tweak * ((o.heights?.[i] ?? o.height) / o.height)
  })
  const own = geos.map((_, i) => o.heights?.[i] != null)
  const ext = geos.map((g, i) => {
    const s = scales[i]
    return {
      left: up((g.refX - g.union.x0) * s),
      right: up((g.union.x1 - g.refX) * s),
      top: Math.max(1, up((g.ground - g.union.y0) * s))
    }
  })
  const common = ext.filter((_, i) => !own[i])
  const maxL = Math.max(0, ...common.map((e) => e.left))
  const maxR = Math.max(0, ...common.map((e) => e.right))
  const maxT = Math.max(1, ...common.map((e) => e.top))
  const actions = geos.map((g, i): ActionLayout => {
    const s = scales[i]
    const e = o.unifiedCanvas && !own[i] ? { left: maxL, right: maxR, top: maxT } : ext[i]
    const cw = Math.max(1, e.left + e.right)
    const ch = e.top
    return {
      box: { x0: g.refX - e.left / s, y0: g.ground - ch / s, x1: g.refX + e.right / s, y1: g.ground },
      cw,
      ch,
      scale: s,
      pixelScale: s * g.workScale,
      frameWidth: cw + 2 * pad,
      frameHeight: ch + 2 * pad,
      pivot: [pad + e.left, pad + ch + below]
    }
  })
  const cpx = Math.max(...actions.map((a) => a.pivot[0]))
  const cpy = Math.max(...actions.map((a) => a.pivot[1]))
  return {
    mode: 'character',
    actions,
    h0Spread: spread,
    h0Inconsistent: inconsistent,
    canvas: {
      width: cpx + Math.max(...actions.map((a) => a.frameWidth - a.pivot[0])),
      height: cpy + Math.max(...actions.map((a) => a.frameHeight - a.pivot[1])),
      pivot: [cpx, cpy]
    },
    pixelScale: inconsistent ? median(actions.map((a) => a.pixelScale)) : shared
  }
}
