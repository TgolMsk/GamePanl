import { useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { copyImage, useCopiedFlag } from '@renderer/app/clipboard'
import { menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { isImageFile } from '@renderer/app/drop'
import { formatSize } from '@renderer/app/format'
import { hud } from '@renderer/app/hud'
import { Button, cx, Icon, IconButton, ImageCard, Select } from '@renderer/ui'
import { NOTE_CATEGORIES } from '@shared/types'
import type { ImageRef, Note, NoteBlock, NoteCategory, ProjectAsset } from '@shared/types'
import { ImagePicker } from './ImagePicker'
import type { ImageSource } from './images'
import { fullDate, imagesIn, newBlockId, refKey } from './noteUtil'
import { Thumb } from './Thumb'
import { errorText } from './useNoteDraft'

type TodoBlock = Extract<NoteBlock, { type: 'todo' }>
type ParaBlock = Extract<NoteBlock, { type: 'p' }>
type ImageBlock = Extract<NoteBlock, { type: 'image' }>
type Field = HTMLInputElement | HTMLTextAreaElement

/** 聚焦请求里代表标题输入框 */
const TITLE = '#title'

interface FocusRequest {
  id: string
  at: 'start' | 'end' | 'all'
}

/** 输入法正在组词：这时的回车、退格交给输入法 */
function composing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

function pathOf(file: File): string {
  try {
    return window.gp.pathForFile(file)
  } catch {
    return ''
  }
}

interface PastedImport {
  /** 从访达复制的图片文件（count 张），或剪贴板里的图片数据 */
  source: 'files' | 'clipboard'
  count: number
  /** 存进本项目资料；已经在资料里的文件不会再返回 */
  task: Promise<ProjectAsset[]>
}

/**
 * ⌘V 粘贴的内容里有图片就存进本项目资料：从访达复制的图片文件按路径导入，剪贴板里的图片数据走 importAssetFromClipboard。
 * 纯文字（或没有路径、不是图片的文件）返回 null，照常粘贴。
 */
function importPasted(projectId: string, data: DataTransfer): PastedImport | null {
  const fromDisk = Array.from(data.files)
    .map((file) => ({ file, path: pathOf(file) }))
    .filter((x) => x.path !== '')
  if (fromDisk.length > 0) {
    const paths = fromDisk.filter((x) => isImageFile(x.file)).map((x) => x.path)
    if (paths.length === 0) return null
    return { source: 'files', count: paths.length, task: window.gp.projects.importAssets(projectId, paths) }
  }
  if (Array.from(data.items).some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
    const task = window.gp.projects.importAssetFromClipboard(projectId).then((a) => (a ? [a] : []))
    return { source: 'clipboard', count: 1, task }
  }
  return null
}

export interface NoteEditorProps {
  projectId: string
  note: Note
  images: ImageSource
  /** 刚新建的笔记：打开时聚焦标题并全选 */
  selectTitle: boolean
  onTitleSelected: () => void
  edit: (fn: (n: Note) => Note) => void
  onCategory: (category: NoteCategory) => void
  onToggleDone: () => void
  onDelete: () => void
  onView: (ref: ImageRef) => void
}

/** 右侧编辑区：日期 / 分类 / 完成 / 清单 / 插入图片 / 删除，标题 + 正文块，底部关联资料 */
export function NoteEditor({
  projectId,
  note,
  images,
  selectTitle,
  onTitleSelected,
  edit,
  onCategory,
  onToggleDone,
  onDelete,
  onView
}: NoteEditorProps): React.JSX.Element {
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const fields = useRef(new Map<string, Field>())
  const focusReq = useRef<FocusRequest | null>(selectTitle ? { id: TITLE, at: 'all' } : null)
  const scrollToEnd = useRef(false)
  const [, rerender] = useState(0)
  const [copiedKey, markCopied] = useCopiedFlag()

  // 渲染后处理聚焦请求（新块要等渲染出来才能聚焦）和滚到末尾
  useLayoutEffect(() => {
    const r = focusReq.current
    const el = r && (r.id === TITLE ? titleRef.current : fields.current.get(r.id))
    if (r && el) {
      focusReq.current = null
      el.focus()
      if (r.at === 'all') el.select()
      else {
        const pos = r.at === 'start' ? 0 : el.value.length
        el.setSelectionRange(pos, pos)
      }
      if (r.id === TITLE && r.at === 'all') onTitleSelected()
    }
    const body = bodyRef.current
    if (scrollToEnd.current && body) {
      scrollToEnd.current = false
      body.scrollTop = body.scrollHeight
    }
  })

  const focusField = (id: string, at: FocusRequest['at']): void => {
    focusReq.current = { id, at }
    rerender((x) => x + 1)
  }

  const fieldRef = (id: string) => (el: Field | null) => {
    if (!el) return
    fields.current.set(id, el)
    return () => {
      if (fields.current.get(id) === el) fields.current.delete(id)
    }
  }

  const editBlocks = (fn: (blocks: NoteBlock[]) => NoteBlock[]): void => edit((n) => ({ ...n, blocks: fn(n.blocks) }))

  const setText = (id: string, text: string): void =>
    editBlocks((bs) => bs.map((b) => (b.id === id && b.type !== 'image' ? { ...b, text } : b)))

  const toggleTodo = (id: string): void =>
    editBlocks((bs) => bs.map((b) => (b.id === id && b.type === 'todo' ? { ...b, checked: !b.checked } : b)))

  /** 清单项变回段落（保留文字） */
  const toParagraph = (id: string): void => {
    editBlocks((bs) => bs.map((b): NoteBlock => (b.id === id && b.type === 'todo' ? { id, type: 'p', text: b.text } : b)))
    focusField(id, 'end')
  }

  // ---------- 键盘 ----------

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (composing(e) || e.key !== 'Enter') return
    e.preventDefault()
    const first = note.blocks.find((b) => b.type !== 'image')
    if (first) {
      focusField(first.id, 'start')
      return
    }
    const p: NoteBlock = { id: newBlockId(), type: 'p', text: '' }
    editBlocks((bs) => [p, ...bs])
    focusField(p.id, 'end')
  }

  const onTodoKey = (e: KeyboardEvent<HTMLTextAreaElement>, b: TodoBlock): void => {
    if (composing(e)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      // 空的清单项按回车：结束清单，变回段落
      if (b.text.trim() === '') {
        toParagraph(b.id)
        return
      }
      // 在光标处分成两项
      const { selectionStart: start, selectionEnd: end } = e.currentTarget
      const next: NoteBlock = { id: newBlockId(), type: 'todo', text: b.text.slice(end), checked: false }
      editBlocks((bs) =>
        bs.flatMap((x): NoteBlock[] => (x.id === b.id && x.type === 'todo' ? [{ ...x, text: x.text.slice(0, start) }, next] : [x]))
      )
      focusField(next.id, 'start')
    } else if (e.key === 'Backspace' && b.text === '') {
      e.preventDefault()
      toParagraph(b.id)
    }
  }

  const onParaKey = (e: KeyboardEvent<HTMLTextAreaElement>, b: ParaBlock): void => {
    if (composing(e) || e.key !== 'Backspace' || b.text !== '') return
    // 空段落按退格：删掉这一段，光标回到上一段末尾（只剩这一段时不删）
    if (note.blocks.filter((x) => x.type !== 'image').length <= 1) return
    e.preventDefault()
    const i = note.blocks.findIndex((x) => x.id === b.id)
    const prev = note.blocks
      .slice(0, i)
      .reverse()
      .find((x) => x.type !== 'image')
    editBlocks((bs) => bs.filter((x) => x.id !== b.id))
    focusField(prev ? prev.id : TITLE, 'end')
  }

  // ---------- 工具栏 ----------

  const addTodo = (): void => {
    const last = note.blocks[note.blocks.length - 1]
    if (last?.type === 'todo' && last.text === '') {
      focusField(last.id, 'end')
      return
    }
    const todo: NoteBlock = { id: newBlockId(), type: 'todo', text: '', checked: false }
    // 末尾是空段落就直接把它换成清单项
    editBlocks((bs) => {
      const tail = bs[bs.length - 1]
      return tail?.type === 'p' && tail.text === '' ? [...bs.slice(0, -1), todo] : [...bs, todo]
    })
    scrollToEnd.current = true
    focusField(todo.id, 'end')
  }

  const insertImage = (ref: ImageRef, name: string): void => {
    editBlocks((bs) => [...bs, { id: newBlockId(), type: 'image', image: ref }])
    scrollToEnd.current = true
    hud.show(`已插入「${name || '图片'}」`, { ok: true })
  }

  const removeImage = (id: string): void => {
    editBlocks((bs) => {
      const rest = bs.filter((b) => b.id !== id)
      return rest.length > 0 ? rest : [{ id: newBlockId(), type: 'p', text: '' }]
    })
    hud.show('已从笔记中移除', { ok: true })
  }

  const onImageMenu = async (e: MouseEvent, b: ImageBlock, name: string | null): Promise<void> => {
    const id = await showContextMenu(e, [
      { id: 'copy', label: '复制' },
      { id: 'view', label: '查看', enabled: name !== null },
      menuSeparator,
      { id: 'remove', label: '从笔记移除' }
    ])
    if (id === 'copy') void copyImage(b.image, name ?? '图片')
    else if (id === 'view') onView(b.image)
    else if (id === 'remove') removeImage(b.id)
  }

  // ---------- 粘贴图片 ----------

  /**
   * 在标题 / 正文里 ⌘V：剪贴板里有图片就存进资料，再作为图片块插到当前块后面（标题里粘贴插到末尾）。
   * preventDefault 得在事件里同步调用（否则访达复制的文件会先把文件名粘成文字），所以先拦下再等导入。
   */
  const onPaste = (e: ClipboardEvent<Field>, afterId: string | null): void => {
    const pasted = e.clipboardData ? importPasted(projectId, e.clipboardData) : null
    if (!pasted) return
    e.preventDefault()
    const noteId = note.id
    pasted.task.then(
      (added) => {
        if (added.length === 0) {
          if (pasted.source === 'clipboard') hud.show('剪贴板里没有图片')
          else hud.show(pasted.count === 1 ? '这张图片已经在资料里了' : '这些图片已经在资料里了')
          return
        }
        let inserted = false
        // 导入期间可能换了笔记：只插进当初粘贴的那条
        edit((n) => {
          if (n.id !== noteId) return n
          inserted = true
          const blocks: NoteBlock[] = added.map((a) => ({
            id: newBlockId(),
            type: 'image',
            image: { scope: 'project', projectId, id: a.id }
          }))
          const i = afterId === null ? -1 : n.blocks.findIndex((b) => b.id === afterId)
          const at = i < 0 ? n.blocks.length : i + 1
          return { ...n, blocks: [...n.blocks.slice(0, at), ...blocks, ...n.blocks.slice(at)] }
        })
        const what = added.length > 1 ? `${added.length} 张图片` : '图片'
        hud.show(inserted ? `已把${what}加进笔记和资料` : `已把${what}加进资料`, { ok: true })
      },
      (err: unknown) => hud.show(`添加图片失败：${errorText(err)}`)
    )
  }

  // 点正文下面的空白处：光标放到最后一段末尾（最后是图片时先接一个空段落）
  const onTailDown = (e: MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const last = note.blocks[note.blocks.length - 1]
    if (last && last.type !== 'image') {
      focusField(last.id, 'end')
      return
    }
    const p: NoteBlock = { id: newBlockId(), type: 'p', text: '' }
    editBlocks((bs) => [...bs, p])
    focusField(p.id, 'end')
  }

  // ---------- 渲染 ----------

  const textCount = note.blocks.filter((b) => b.type !== 'image').length
  const used = imagesIn(note)
  const usedKeys = new Set(used.map(refKey))
  const related = used.flatMap((ref) => {
    const info = images.lookup(ref)
    return info ? [info] : []
  })

  const renderImage = (b: ImageBlock): React.JSX.Element => {
    const info = images.lookup(b.image)
    const aspect = info && info.width > 0 && info.height > 0 ? info.width / info.height : 16 / 10
    // 横图 520 宽、竖图和方图 320 宽，很长的图限制在 440 高以内
    const width = Math.round(Math.min(aspect > 1 ? 520 : 320, 440 * aspect))
    const meta = info
      ? `${info.name} · ${formatSize(info.width, info.height)}`
      : images.ready
        ? '找不到这张图片，可能已经删除'
        : ''
    return (
      <div key={b.id} className="pn-img" style={{ width }}>
        <ImageCard
          image={b.image}
          name={info?.name ?? '图片'}
          caption={false}
          aspect={aspect}
          thumb={1040}
          onView={info ? () => onView(b.image) : undefined}
          onContextMenu={(e) => void onImageMenu(e, b, info?.name ?? null)}
        />
        <button type="button" className="eye pn-rm" aria-label="从笔记移除" title="从笔记移除" onClick={() => removeImage(b.id)}>
          <Icon name="xmark" size={13} strokeWidth={2.2} />
        </button>
        <span className="meta pn-imeta">{meta}</span>
      </div>
    )
  }

  const renderBlock = (b: NoteBlock): React.JSX.Element => {
    switch (b.type) {
      case 'p':
        return (
          <textarea
            key={b.id}
            ref={fieldRef(b.id)}
            className="pn-para"
            rows={1}
            value={b.text}
            placeholder={textCount === 1 ? '写点什么…' : undefined}
            aria-label="正文"
            maxLength={100_000}
            onChange={(e) => setText(b.id, e.target.value)}
            onKeyDown={(e) => onParaKey(e, b)}
            onPaste={(e) => onPaste(e, b.id)}
          />
        )
      case 'todo':
        return (
          <div key={b.id} className="pn-todo">
            <button
              type="button"
              className={cx('pn-ck', b.checked && 'on')}
              aria-label={b.checked ? '标记为未完成' : '标记为完成'}
              aria-pressed={b.checked}
              onClick={() => toggleTodo(b.id)}
            >
              <Icon name={b.checked ? 'checkmark.square' : 'square'} size={18} />
            </button>
            <textarea
              ref={fieldRef(b.id)}
              className={cx('pn-cin', b.checked && 'struck')}
              rows={1}
              value={b.text}
              placeholder="待办事项"
              aria-label="清单项"
              maxLength={5000}
              onChange={(e) => setText(b.id, e.target.value.replace(/\r\n?|\n/g, ' '))}
              onKeyDown={(e) => onTodoKey(e, b)}
              onPaste={(e) => onPaste(e, b.id)}
            />
          </div>
        )
      case 'image':
        return renderImage(b)
    }
  }

  return (
    <>
      <div className="pn-bar">
        <span className="lbl">{fullDate(note.updatedAt)}</span>
        <span className="pn-vsep" />
        <Select value={note.category} options={NOTE_CATEGORIES} onChange={onCategory} ariaLabel="分类" />
        <button type="button" className={cx('pn-tgl', note.done && 'on')} aria-pressed={note.done} onClick={onToggleDone}>
          <span className="ic">
            <Icon name={note.done ? 'checkmark.square' : 'square'} size={18} />
          </span>
          {note.done ? '已完成' : '完成'}
        </button>
        <span className="grow" />
        <Button icon="checklist" onClick={addTodo}>
          清单
        </Button>
        <ImagePicker projectId={projectId} images={images} inNote={usedKeys} onInsert={insertImage} />
        <IconButton icon="trash" label="删除笔记" onClick={onDelete} />
      </div>

      <div className="pn-body" ref={bodyRef}>
        <div className="pn-col">
          <input
            ref={titleRef}
            className="pn-title"
            value={note.title}
            placeholder="标题"
            aria-label="标题"
            autoComplete="off"
            maxLength={500}
            onChange={(e) => edit((n) => ({ ...n, title: e.target.value }))}
            onKeyDown={onTitleKey}
            onPaste={(e) => onPaste(e, null)}
          />
          {note.blocks.map(renderBlock)}
          <div className="pn-tail" onMouseDown={onTailDown} />
        </div>
      </div>

      <div className="pn-rel">
        <div className="pn-relh">
          <span className="pn-relt">关联资料</span>
          <span className="meta">{related.length} 张</span>
        </div>
        {related.length > 0 ? (
          <div className="pn-rellist">
            {related.map((info) => {
              const key = refKey(info.ref)
              const aspect = info.height > 0 ? info.width / info.height : 1
              return (
                <div key={key} className="card pn-relc" style={{ width: Math.round(Math.min(96, Math.max(40, 52 * aspect))) }}>
                  <button
                    type="button"
                    className="hit"
                    title={`${info.name} · 点击复制`}
                    aria-label={`复制「${info.name}」`}
                    onClick={async () => {
                      if (await copyImage(info.ref, info.name)) markCopied(key)
                    }}
                  >
                    <span className="frame">
                      <Thumb image={info.ref} size={160} alt={info.name} />
                    </span>
                  </button>
                  {copiedKey === key && (
                    <span className="done pn-mini" aria-label="已复制">
                      <Icon name="check" size={11} strokeWidth={3} />
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <span className="lbl">正文里还没有图片</span>
        )}
      </div>
    </>
  )
}
