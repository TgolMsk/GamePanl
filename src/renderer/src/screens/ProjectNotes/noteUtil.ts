// 构思界面用到的纯函数：分组、日期、摘要、搜索、图片引用。
import { formatDate } from '@renderer/app/format'
import { NOTE_CATEGORIES } from '@shared/types'
import type { ImageRef, Note, NoteBlock, NoteCategory } from '@shared/types'

/** 工具栏分段里列出的分类（「其他」不单独列） */
export const FILTER_CATEGORIES = NOTE_CATEGORIES.filter((c) => c !== '其他')
export type CategoryFilter = 'all' | NoteCategory

export function isFilterCategory(c: NoteCategory): boolean {
  return (FILTER_CATEGORIES as readonly string[]).includes(c)
}

/** 新的正文块 id（只用字母数字，满足主进程的 id 规则） */
export function newBlockId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return 'b' + Array.from(bytes, (x) => chars[x % chars.length]).join('')
}

// ---------- 日期 ----------

const pad = (n: number): string => String(n).padStart(2, '0')

/** 距今天几个自然日（今天 0、昨天 1；将来的日期当作今天） */
function daysAgo(iso: string): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return Infinity
  const now = new Date()
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.max(0, Math.round((a - b) / 86_400_000))
}

export type DateBucket = '今天' | '昨天' | '过去 7 天' | '更早'

function bucketOf(iso: string): DateBucket {
  const k = daysAgo(iso)
  return k === 0 ? '今天' : k === 1 ? '昨天' : k <= 7 ? '过去 7 天' : '更早'
}

/** 列表里的日期：今天只写时间，其余「昨天」「9月21日」 */
export function listDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return daysAgo(iso) === 0 ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : formatDate(iso)
}

/** 编辑区顶部的日期：「2026年9月24日 14:32」 */
export function fullDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- 列表 ----------

export function displayTitle(n: Note): string {
  return n.title.trim() || '新笔记'
}

/** 摘要：第一段有字的正文 */
export function summaryOf(n: Note): string {
  for (const b of n.blocks) {
    if (b.type === 'image') continue
    const t = b.text.replace(/\s+/g, ' ').trim()
    if (t) return t
  }
  return '没有附加文本'
}

export function firstImage(n: Note): ImageRef | null {
  const b = n.blocks.find((x): x is Extract<NoteBlock, { type: 'image' }> => x.type === 'image')
  return b ? b.image : null
}

/** 标题 / 正文里包含关键词（q 已经转成小写、去掉首尾空格） */
export function matchesQuery(n: Note, q: string): boolean {
  if (!q) return true
  if (n.title.toLowerCase().includes(q)) return true
  return n.blocks.some((b) => b.type !== 'image' && b.text.toLowerCase().includes(q))
}

export function matchesCategory(n: Note, cat: CategoryFilter): boolean {
  return cat === 'all' || n.category === cat
}

export interface NoteGroup {
  label: DateBucket
  notes: Note[]
}

/** 按修改时间分组（notes 已按修改时间从新到旧排好） */
export function groupNotes(notes: Note[]): NoteGroup[] {
  const groups: NoteGroup[] = []
  for (const n of notes) {
    const label = bucketOf(n.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.notes.push(n)
    else groups.push({ label, notes: [n] })
  }
  return groups
}

export function byUpdatedDesc(a: Note, b: Note): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
}

export function replaceNote(list: Note[], note: Note): Note[] {
  return list.map((n) => (n.id === note.id ? note : n))
}

// ---------- 图片 ----------

/** 同一张图的唯一键（笔记里的项目资料总是本项目的） */
export function refKey(ref: ImageRef): string {
  return `${ref.scope}/${ref.id}`
}

/** 正文里用到的图片，按出现顺序去重 */
export function imagesIn(n: Note): ImageRef[] {
  const seen = new Set<string>()
  const out: ImageRef[] = []
  for (const b of n.blocks) {
    if (b.type !== 'image') continue
    const k = refKey(b.image)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(b.image)
  }
  return out
}
