import { useState } from 'react'
import { useCopiedFlag } from '@renderer/app/clipboard'
import { usePrompts } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import { Button, cx, EmptyState, Icon, IconButton, Segmented, type SegmentedOption } from '@renderer/ui'
import { PROMPT_CATEGORIES, type Prompt, type PromptCategory } from '@shared/types'
import { LibraryToolbar, LoadError } from './common'
import { copyPrompt, dotClass, usesText } from './prompts'
import { PromptSheet } from './PromptSheet'
import { errText, matches } from './shared'

export type PromptFilter = 'all' | PromptCategory

const FILTERS: ReadonlyArray<SegmentedOption<PromptFilter>> = [
  { value: 'all', label: '全部' },
  ...PROMPT_CATEGORIES.map((c) => ({ value: c, label: c }))
]

export interface PromptsTabProps {
  q: string
  onQ: (q: string) => void
  cat: PromptFilter
  onCat: (cat: PromptFilter) => void
}

/** 全局库 · 提示词：两列卡片，单击复制正文 */
export function PromptsTab({ q, onQ, cat, onCat }: PromptsTabProps): React.JSX.Element {
  const prompts = usePrompts()
  const [selId, setSelId] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; isNew: boolean } | null>(null)
  const [copiedId, markCopied] = useCopiedFlag()

  const all = prompts.data
  const shown = all.filter((p) => (cat === 'all' || p.category === cat) && matches(q, [p.title, p.body, p.category]))
  const editing = edit ? (all.find((p) => p.id === edit.id) ?? null) : null

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
          <div key={p.id} className={cx('card', selId === p.id && 'sel')}>
            <button
              type="button"
              className="hit lib-hit"
              aria-label={`复制提示词「${p.title || '未命名'}」`}
              onClick={async () => {
                setSelId(p.id)
                if (await copyPrompt(p, replace)) markCopied(p.id)
              }}
            >
              <span className="frame lib-pc">
                <span className="lib-pt">{p.title || '未命名'}</span>
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
            <button
              type="button"
              className="eye soft"
              aria-label="查看"
              title="查看"
              onClick={() => {
                setSelId(p.id)
                setEdit({ id: p.id, isNew: false })
              }}
            >
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
        <main className="screen-main tint">{content}</main>
      </div>
      {editing && edit && (
        <PromptSheet key={editing.id} prompt={editing} isNew={edit.isNew} onClose={() => setEdit(null)} />
      )}
    </div>
  )
}
