// 照片式分组：今天 / 本周（周一到昨天）/ 更早，组内按添加时间从新到旧。
import type { ProjectAsset } from '@shared/types'

export interface AssetGroup {
  key: 'today' | 'week' | 'older'
  title: string
  /** 组标题旁的日期，如「9月24日 周四」「9月21日 – 23日」；更早的没有 */
  date: string
  items: ProjectAsset[]
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function dayStart(y: number, m: number, d: number): Date {
  return new Date(y, m, d)
}

const md = (d: Date): string => `${d.getMonth() + 1}月${d.getDate()}日`

function rangeLabel(from: Date, to: Date): string {
  if (from.getTime() === to.getTime()) return md(from)
  if (from.getMonth() === to.getMonth()) return `${md(from)} – ${to.getDate()}日`
  return `${md(from)} – ${md(to)}`
}

function timeOf(a: ProjectAsset): number {
  const t = new Date(a.addedAt).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function groupByDate(list: ProjectAsset[], now = new Date()): AssetGroup[] {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const today = dayStart(y, m, d)
  // 一周从周一开始
  const sinceMonday = (now.getDay() + 6) % 7
  const monday = dayStart(y, m, d - sinceMonday)
  const yesterday = dayStart(y, m, d - 1)

  const sorted = [...list].sort((a, b) => timeOf(b) - timeOf(a))
  const groups: AssetGroup[] = [
    { key: 'today', title: '今天', date: `${md(today)} ${WEEKDAYS[today.getDay()]}`, items: [] },
    { key: 'week', title: '本周', date: sinceMonday > 0 ? rangeLabel(monday, yesterday) : '', items: [] },
    { key: 'older', title: '更早', date: '', items: [] }
  ]
  for (const a of sorted) {
    const t = timeOf(a)
    if (t >= today.getTime()) groups[0].items.push(a)
    else if (t >= monday.getTime()) groups[1].items.push(a)
    else groups[2].items.push(a)
  }
  return groups.filter((g) => g.items.length > 0)
}
