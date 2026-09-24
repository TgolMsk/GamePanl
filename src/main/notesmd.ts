// 笔记的 Markdown 文件格式（projects/<id>/notes/<noteId>.md）：
//
//   ---
//   id: <noteId>
//   title: 核心玩法「提灯与雾」
//   category: 玩法
//   done: false
//   createdAt: 2026-09-24T06:32:00.000Z
//   updatedAt: 2026-09-24T06:32:00.000Z
//   blocks: <块 id> <块 id> …        正文各块的 id；正文在外部被改得块数对不上时，读回来重新编号
//   ---
//
//   段落（块之间空一行；段落内可以换行）
//
//   - [ ] 清单项（相邻清单项之间不空行）
//   - [x] 已完成的清单项
//
//   ![](gp-ref:library/<id>)         全局库图片
//   ![](gp-ref:project/<id>)         本项目资料（读回来时补上当前项目 id）
//
// 空段落写成 "<br>"；段落里的空白行、以 "\"、"- [ ]"、"![" 开头的行和 "<br>" 行前面加 "\" 转义。
// 序列化与解析互为逆运算：parseNote(serializeNote(note)) 与 note 完全一致（note 需先经 normalizeNote）。
import { randomUUID } from 'crypto'
import { NOTE_CATEGORIES } from '@shared/types'
import type { ID, ImageRef, Note, NoteBlock, NoteCategory } from '@shared/types'
import { asBoolean, asLine, asObject, asOneOf, asString, fail, isSafeId, SAFE_ID } from './validate'

const TODO_RE = /^- \[([ xX])\](?: (.*))?$/
const IMAGE_RE = /^!\[[^\]]*\]\(gp-ref:(library|project)\/([A-Za-z0-9_-]{1,64})\)$/
const EMPTY_PARAGRAPH = '<br>'

// ---------- 校验与规范化 ----------

function blockId(): string {
  return 'b' + randomUUID().replace(/-/g, '').slice(0, 10)
}

function asImageRef(v: unknown, projectId: ID): ImageRef {
  const o = asObject(v, '图片引用')
  if (o['scope'] === 'library') {
    if (!isSafeId(o['id'])) fail('图片 id 不合法')
    return { scope: 'library', id: o['id'] }
  }
  if (o['scope'] === 'project') {
    if (!isSafeId(o['id'])) fail('图片 id 不合法')
    if (o['projectId'] !== undefined && o['projectId'] !== projectId) fail('笔记里只能放本项目资料或全局库的图片')
    return { scope: 'project', projectId, id: o['id'] }
  }
  fail('图片引用格式不对')
}

/** 校验正文块：块 id 缺失、不合法或重复时换新的；清单项的换行换成空格 */
export function normalizeBlocks(v: unknown, projectId: ID): NoteBlock[] {
  if (!Array.isArray(v)) fail('正文必须是数组')
  if (v.length > 5000) fail('正文块太多了')
  const seen = new Set<string>()
  return v.map((raw): NoteBlock => {
    const b = asObject(raw, '正文块')
    let id = isSafeId(b['id']) && !seen.has(b['id']) ? b['id'] : blockId()
    while (seen.has(id)) id = blockId()
    seen.add(id)
    switch (b['type']) {
      case 'p':
        return { id, type: 'p', text: asString(b['text'], '段落').replace(/\r\n?/g, '\n') }
      case 'todo':
        return { id, type: 'todo', text: asLine(b['text'], '清单项', 5000), checked: asBoolean(b['checked'], '勾选') }
      case 'image':
        return { id, type: 'image', image: asImageRef(b['image'], projectId) }
      default:
        fail('正文块类型不对')
    }
  })
}

export function asNoteTitle(v: unknown): string {
  return asLine(v, '标题')
}

export function asNoteCategory(v: unknown): NoteCategory {
  return asOneOf(v, NOTE_CATEGORIES, '分类')
}

// ---------- 序列化 ----------

/** 文件头的值：需要时加双引号（JSON 字符串写法），保证读回来一字不差 */
function headValue(v: string): string {
  const needsQuote =
    v !== v.trim() ||
    /[\u0000-\u001f\u007f]/.test(v) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(v) ||
    v.includes(': ') ||
    v.includes(' #') ||
    v.endsWith(':')
  return needsQuote ? JSON.stringify(v) : v
}

function headLine(key: string, value: string): string {
  return value ? `${key}: ${value}` : `${key}:`
}

function escapeLine(line: string): string {
  const special =
    line.trim() === '' ||
    line.startsWith('\\') ||
    /^- \[[ xX]\]/.test(line) ||
    line.startsWith('![') ||
    line === EMPTY_PARAGRAPH
  return special ? '\\' + line : line
}

function blockText(b: NoteBlock): string {
  switch (b.type) {
    case 'p':
      return b.text === '' ? EMPTY_PARAGRAPH : b.text.split('\n').map(escapeLine).join('\n')
    case 'todo':
      return `- [${b.checked ? 'x' : ' '}]` + (b.text ? ' ' + b.text : '')
    case 'image':
      return `![](gp-ref:${b.image.scope}/${b.image.id})`
  }
}

export function serializeNote(note: Note): string {
  const head = [
    '---',
    headLine('id', note.id),
    headLine('title', headValue(note.title)),
    headLine('category', note.category),
    headLine('done', String(note.done)),
    headLine('createdAt', headValue(note.createdAt)),
    headLine('updatedAt', headValue(note.updatedAt)),
    headLine('blocks', note.blocks.map((b) => b.id).join(' ')),
    '---'
  ].join('\n')
  let body = ''
  let prevTodo = false
  for (const b of note.blocks) {
    if (body) body += b.type === 'todo' && prevTodo ? '\n' : '\n\n'
    body += blockText(b)
    prevTodo = b.type === 'todo'
  }
  return head + '\n' + (body ? '\n' + body + '\n' : '')
}

// ---------- 解析 ----------

function parseHead(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of lines) {
    const m = /^([A-Za-z][A-Za-z0-9_]*):(?: (.*))?$/.exec(line)
    if (!m) continue
    let value = m[2] ?? ''
    if (value.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(value)
        if (typeof parsed === 'string') value = parsed
      } catch {
        // 不是合法的引号写法，按原样保留
      }
    }
    out[m[1]] = value
  }
  return out
}

/** 去掉 id 的正文块 */
type BlockBody = NoteBlock extends infer B ? (B extends unknown ? Omit<B, 'id'> : never) : never

function parseBody(lines: string[], projectId: ID): BlockBody[] {
  const blocks: BlockBody[] = []
  let para: string[] | null = null
  const flush = (): void => {
    if (para) blocks.push({ type: 'p', text: para.join('\n') })
    para = null
  }
  for (const line of lines) {
    if (line.trim() === '') {
      flush()
      continue
    }
    const todo = TODO_RE.exec(line)
    if (todo) {
      flush()
      blocks.push({ type: 'todo', text: todo[2] ?? '', checked: todo[1] !== ' ' })
      continue
    }
    const img = IMAGE_RE.exec(line)
    if (img) {
      flush()
      const id = img[2]
      blocks.push({ type: 'image', image: img[1] === 'library' ? { scope: 'library', id } : { scope: 'project', projectId, id } })
      continue
    }
    if (line === EMPTY_PARAGRAPH && !para) {
      blocks.push({ type: 'p', text: '' })
      continue
    }
    const text = line.startsWith('\\') ? line.slice(1) : line
    if (para) para.push(text)
    else para = [text]
  }
  flush()
  return blocks
}

export interface NoteFileInfo {
  /** 笔记 id（文件名） */
  id: ID
  /** 文件头里没有时间时用的时间（文件修改时间） */
  fallbackDate: string
}

/** 解析笔记文件；格式不完整时尽量读出内容，不报错 */
export function parseNote(text: string, projectId: ID, file: NoteFileInfo): Note {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  let headLines: string[] = []
  let bodyLines = lines
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) {
      headLines = lines.slice(1, end)
      bodyLines = lines.slice(end + 1)
    }
  }
  const head = parseHead(headLines)
  const bodies = parseBody(bodyLines, projectId)
  const ids = (head['blocks'] ?? '').split(/\s+/).filter(Boolean)
  const idsUsable = ids.length === bodies.length && new Set(ids).size === ids.length && ids.every((x) => SAFE_ID.test(x))
  const blocks = bodies.map((b, i) => ({ id: idsUsable ? ids[i] : `b${i + 1}`, ...b }) as NoteBlock)
  const category = (NOTE_CATEGORIES as readonly string[]).includes(head['category'] ?? '')
    ? (head['category'] as NoteCategory)
    : '其他'
  return {
    id: file.id,
    title: head['title'] ?? '',
    category,
    done: head['done'] === 'true',
    blocks,
    createdAt: head['createdAt'] || file.fallbackDate,
    updatedAt: head['updatedAt'] || file.fallbackDate
  }
}
