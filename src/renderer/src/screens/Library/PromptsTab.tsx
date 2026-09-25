import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useCopiedFlag } from '@renderer/app/clipboard'
import { isSelectModifier, menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { usePrompts } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import { Button, ConfirmSheet, cx, EmptyState, Icon, IconButton, Segmented, type SegmentedOption } from '@renderer/ui'
import { PROMPT_CATEGORIES, type Prompt, type PromptCategory } from '@shared/types'
import { LibraryToolbar, LoadError } from './common'
import { isCmdKey, isPlainKey, useMainKeys } from './keys'
import { copyPrompt, dotClass, usesText } from './prompts'
import { PromptSheet } from './PromptSheet'
import { errText, matches, showError } from './shared'

export type PromptFilter = 'all' | PromptCategory

const FILTERS: ReadonlyArray<SegmentedOption<PromptFilter>> = [
  { value: 'all', label: '全部' },
  ...PROMPT_CATEGORIES.map((c) => ({ value: c, label: c }))
]

const titleOf = (p: Prompt): string => p.title.trim() || '未命名'

export interface PromptsTabProps {
  q: string
  onQ: (q: string) => void
  cat: PromptFilter
  onCat: (cat: PromptFilter) => void
}

/**
 * 全局库 · 提示词：两列卡片，单击复制正文。
 * 双击或 Enter 编辑；右键菜单：编辑、复制、复制一份、分类、删除；Delete 删除（确认）；⌘C 复制正文。
 */
export function PromptsTab({ q, onQ, cat, onCat }: PromptsTabProps): React.JSX.Element {
  const prompts = usePrompts()
  const [selId, setSelId] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; isNew: boolean } | null>(null)
  const [trashing, setTrashing] = useState<Prompt | null>(null)
  const [copiedId, markCopied] = useCopiedFlag()
  const mainRef = useRef<HTMLElement>(null)

  const all = prompts.data
  const shown = all.filter((p) => (cat === 'all' || p.category === cat) && matches(q, [p.title, p.body, p.category]))
  const editing = edit ? (all.find((p) => p.id === edit.id) ?? null) : null
  /** 选中的那条（被筛选掉了就当没选） */
  const selected = shown.find((p) => p.id === selId) ?? null

  const replace = (next: Prompt): void => prompts.mutate((list) => list.map((p) => (p.id === next.id ? next : p)))

  const create = async (): Promise<void> => {
    try {
      const p = await window.gp.library.createPrompt({ title: '', body: '', category: cat === 'all' ? '风格' : cat })
      prompts.mutate((list) => [p, ...list.filter((x) => x.id !== p.id)])
      onQ('')
      setSelId(p.id)
      setEdit({ id: p.id, isNew: true })
    } catch (err) {
      hud.show(`新建失败：${errText(err)}`)
    }
  }

  const openEdit = (p: Prompt): void => {
    setSelId(p.id)
    setEdit({ id: p.id, isNew: false })
  }

  const copy = async (p: Prompt): Promise<void> => {
    if (await copyPrompt(p, replace)) markCopied(p.id)
  }

  /** 复制一份：同样的内容，标题后面加「 副本」，然后打开编辑 */
  const duplicate = async (p: Prompt): Promise<void> => {
    try {
      const copy = await window.gp.library.createPrompt({ title: `${titleOf(p)} 副本`, body: p.body, category: p.category })
      prompts.mutate((list) => [copy, ...list.filter((x) => x.id !== copy.id)])
      setSelId(copy.id)
      setEdit({ id: copy.id, isNew: false })
    } catch (err) {
      showError('没能复制一份', err)
    }
  }

  const setCategory = async (p: Prompt, category: PromptCategory): Promise<void> => {
    if (p.category === category) return
    prompts.mutate((list) => list.map((x) => (x.id === p.id ? { ...x, category } : x)))
    try {
      replace(await window.gp.library.updatePrompt(p.id, { category }))
      hud.show(`已移到「${category}」`, { ok: true })
    } catch (err) {
      showError('没能保存', err)
      void prompts.refresh()
    }
  }

  const confirmDelete = async (): Promise<void> => {
    const p = trashing
    if (!p) return
    try {
      await window.gp.library.deletePrompt(p.id)
    } catch (err) {
      setTrashing(null)
      showError('没能删除', err)
      return
    }
    prompts.mutate((list) => list.filter((x) => x.id !== p.id))
    setTrashing(null)
    hud.show('已删除提示词', { ok: true })
  }

  const onContextMenu = async (e: ReactMouseEvent, p: Prompt): Promise<void> => {
    setSelId(p.id)
    const picked = await showContextMenu(e, [
      { id: 'edit', label: '编辑…' },
      { id: 'copy', label: '复制' },
      { id: 'dup', label: '复制一份' },
      {
        id: 'cat',
        label: '分类',
        submenu: PROMPT_CATEGORIES.map((c) => ({ id: `cat:${c}`, label: c, checked: c === p.category }))
      },
      menuSeparator,
      { id: 'delete', label: '删除', destructive: true }
    ])
    if (picked === null) return
    if (picked === 'edit') openEdit(p)
    else if (picked === 'copy') void copy(p)
    else if (picked === 'dup') void duplicate(p)
    else if (picked === 'delete') setTrashing(p)
    else {
      const c = PROMPT_CATEGORIES.find((x) => picked === `cat:${x}`)
      if (c) void setCategory(p, c)
    }
  }

  useMainKeys(mainRef, (e) => {
    if (!selected) return
    if (isPlainKey(e, 'Backspace', 'Delete')) {
      e.preventDefault()
      setTrashing(selected)
    } else if (isPlainKey(e, 'Enter')) {
      e.preventDefault()
      openEdit(selected)
    } else if (isCmdKey(e, 'c')) {
      e.preventDefault()
      void copy(selected)
    }
  })

  let content: React.JSX.Element | null = null
  if (prompts.error !== null && all.length === 0) {
    content = <LoadError error={prompts.error} onRetry={() => void prompts.refresh()} />
  } else if (prompts.loading) {
    content = null
  } else if (all.length === 0) {
    content = (
      <EmptyState icon="text" title="这里还没有提示词" hint="把常用的提示词存在这里，单击卡片就能复制。">
        <Button icon="plus" onClick={() => void create()}>
          新建提示词
        </Button>
      </EmptyState>
    )
  } else if (shown.length === 0) {
    content = q.trim() ? (
      <EmptyState icon="search" title="没有找到提示词" hint={`没有和“${q.trim()}”匹配的提示词`} />
    ) : (
      <EmptyState icon="text" title={`「${cat}」里还没有提示词`}>
        <Button icon="plus" onClick={() => void create()}>
          新建提示词
        </Button>
      </EmptyState>
    )
  } else {
    content = (
      <div className="lib-pgrid">
        {shown.map((p) => (
          <div key={p.id} className={cx('card', selId === p.id && 'sel')} onContextMenu={(e) => void onContextMenu(e, p)}>
            <button
              type="button"
              className="hit lib-hit"
              aria-label={`复制提示词「${titleOf(p)}」`}
              onClick={(e) => {
                setSelId(p.id)
                // 双击的第二下、带修饰键的单击只选中，不复制
                if (e.detail > 1 || isSelectModifier(e)) return
                void copy(p)
              }}
              onDoubleClick={() => openEdit(p)}
            >
              <span className="frame lib-pc">
                <span className="lib-pt">{titleOf(p)}</span>
                <span className={cx('lib-pb', !p.body.trim() && 'none')}>{p.body.trim() ? p.body : '还没有正文'}</span>
                <span className="grow" />
                <span className="lib-pf">
                  <span className="tag lib-ptag">
                    <span className={dotClass(p.category)} />
                    {p.category}
                  </span>
                  <span className="grow" />
                  <span className="meta">{usesText(p.uses)}</span>
                </span>
                <span className="pill">
                  <Icon name="copy" size={12} strokeWidth={2} />
                  点击复制
                </span>
              </span>
            </button>
            <button type="button" className="eye soft" aria-label="编辑" title="编辑" onClick={() => openEdit(p)}>
              <Icon name="eye" size={15} />
            </button>
            {copiedId === p.id && (
              <span className="done lib-pdone">
                <Icon name="check" size={11} strokeWidth={2.4} />
                已复制
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="screen">
      <LibraryToolbar
        subtitle={prompts.loading ? '所有项目共用' : `所有项目共用 · ${all.length} 条提示词`}
        q={q}
        onQ={onQ}
        placeholder="搜索提示词"
        segment={<Segmented ariaLabel="按分类显示" value={cat} onChange={onCat} options={FILTERS} />}
      >
        <IconButton icon="plus" label="新建提示词" onClick={() => void create()} />
      </LibraryToolbar>
      <div className="screen-body">
        <main ref={mainRef} className="screen-main tint" tabIndex={0} aria-label="提示词">
          {content}
        </main>
      </div>
      {editing && edit && (
        <PromptSheet key={editing.id} prompt={editing} isNew={edit.isNew} onClose={() => setEdit(null)} />
      )}
      <ConfirmSheet
        open={trashing !== null}
        title={`删除提示词「${trashing ? titleOf(trashing) : ''}」？`}
        message="删除后不能恢复。"
        confirmLabel="删除"
        destructive
        onCancel={() => setTrashing(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
