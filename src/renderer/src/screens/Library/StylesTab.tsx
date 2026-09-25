import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useCopiedFlag } from '@renderer/app/clipboard'
import { isSelectModifier, menuSeparator, showContextMenu } from '@renderer/app/contextMenu'
import { useStyles } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import { Button, ConfirmSheet, cx, EmptyState, Icon, IconButton } from '@renderer/ui'
import type { Style } from '@shared/types'
import { LibraryToolbar, LoadError } from './common'
import { isCmdKey, isPlainKey, useMainKeys } from './keys'
import { errText, matches, showError, useProjectsWhere } from './shared'
import { StyleSheet } from './StyleSheet'
import { copyStylePrompt, DEFAULT_PALETTE, StyleVisual } from './styleParts'

const nameOf = (s: Style): string => s.name.trim() || '未命名风格'

export interface StylesTabProps {
  q: string
  onQ: (q: string) => void
}

/**
 * 全局库 · 风格：三列卡片（样张或色板条），单击复制风格提示词。
 * 双击或 Enter 编辑；右键菜单：编辑、复制提示词、复制一份、删除；Delete 删除（确认）；⌘C 复制提示词。
 */
export function StylesTab({ q, onQ }: StylesTabProps): React.JSX.Element {
  const styles = useStyles()
  const [selId, setSelId] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; isNew: boolean } | null>(null)
  const [trashing, setTrashing] = useState<Style | null>(null)
  const [copiedId, markCopied] = useCopiedFlag()
  const mainRef = useRef<HTMLElement>(null)

  const all = styles.data
  const shown = all.filter((s) => matches(q, [s.name, s.desc, s.prompt]))
  const editing = edit ? (all.find((s) => s.id === edit.id) ?? null) : null
  /** 选中的那个（被搜索筛掉了就当没选） */
  const selected = shown.find((s) => s.id === selId) ?? null

  // 删除前查一下哪些项目在用这个风格，确认框里说明
  const trashId = trashing?.id ?? null
  const affected = useProjectsWhere(trashId, async (projectId) => (await window.gp.projects.get(projectId)).styleId === trashId)

  const create = async (): Promise<void> => {
    try {
      const s = await window.gp.library.createStyle({
        name: '',
        desc: '',
        palette: DEFAULT_PALETTE,
        prompt: '',
        sampleImageId: null
      })
      styles.mutate((list) => [s, ...list.filter((x) => x.id !== s.id)])
      onQ('')
      setSelId(s.id)
      setEdit({ id: s.id, isNew: true })
    } catch (err) {
      hud.show(`新建失败：${errText(err)}`)
    }
  }

  const openEdit = (s: Style): void => {
    setSelId(s.id)
    setEdit({ id: s.id, isNew: false })
  }

  const copy = async (s: Style): Promise<void> => {
    if (await copyStylePrompt(s.prompt)) markCopied(s.id)
  }

  /** 复制一份：同样的描述、色板、提示词、样张，名称后面加「 副本」，然后打开编辑 */
  const duplicate = async (s: Style): Promise<void> => {
    try {
      const copy = await window.gp.library.createStyle({
        name: `${nameOf(s)} 副本`,
        desc: s.desc,
        palette: [...s.palette],
        prompt: s.prompt,
        sampleImageId: s.sampleImageId
      })
      styles.mutate((list) => [copy, ...list.filter((x) => x.id !== copy.id)])
      setSelId(copy.id)
      setEdit({ id: copy.id, isNew: false })
    } catch (err) {
      showError('没能复制一份', err)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    const s = trashing
    if (!s) return
    try {
      await window.gp.library.deleteStyle(s.id)
    } catch (err) {
      setTrashing(null)
      showError('没能删除', err)
      return
    }
    styles.mutate((list) => list.filter((x) => x.id !== s.id))
    setTrashing(null)
    hud.show('已删除风格', { ok: true })
  }

  const onContextMenu = async (e: ReactMouseEvent, s: Style): Promise<void> => {
    setSelId(s.id)
    const picked = await showContextMenu(e, [
      { id: 'edit', label: '编辑…' },
      { id: 'copy', label: '复制提示词' },
      { id: 'dup', label: '复制一份' },
      menuSeparator,
      { id: 'delete', label: '删除', destructive: true }
    ])
    if (picked === 'edit') openEdit(s)
    else if (picked === 'copy') void copy(s)
    else if (picked === 'dup') void duplicate(s)
    else if (picked === 'delete') setTrashing(s)
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

  const affectedNote =
    affected && affected.length > 0 ? `${affected.map((p) => `「${p.name}」`).join('')}的美术风格会改为未设置。` : ''

  let content: React.JSX.Element | null = null
  if (styles.error !== null && all.length === 0) {
    content = <LoadError error={styles.error} onRetry={() => void styles.refresh()} />
  } else if (styles.loading) {
    content = null
  } else if (all.length === 0) {
    content = (
      <EmptyState icon="palette" title="这里还没有风格" hint="记下美术风格的色板、样张和提示词，项目配置里可以直接选用。">
        <Button icon="plus" onClick={() => void create()}>
          新建风格
        </Button>
      </EmptyState>
    )
  } else if (shown.length === 0) {
    content = <EmptyState icon="search" title="没有找到风格" hint={`没有和“${q.trim()}”匹配的风格`} />
  } else {
    content = (
      <div className="lib-sgrid">
        {shown.map((s) => (
          <div key={s.id} className={cx('card', selId === s.id && 'sel')} onContextMenu={(e) => void onContextMenu(e, s)}>
            <button
              type="button"
              className="hit lib-hit"
              aria-label={`复制风格「${nameOf(s)}」的提示词`}
              onClick={(e) => {
                setSelId(s.id)
                // 双击的第二下、带修饰键的单击只选中，不复制
                if (e.detail > 1 || isSelectModifier(e)) return
                void copy(s)
              }}
              onDoubleClick={() => openEdit(s)}
            >
              <span className="frame lib-sc">
                <span className="lib-svis">
                  <StyleVisual style={s} thumb={640} />
                  <span className="pill">
                    <Icon name="copy" size={12} strokeWidth={2} />
                    点击复制提示词
                  </span>
                </span>
                <span className="lib-sinfo">
                  <span className="lib-sn">{nameOf(s)}</span>
                  <span className="lib-sd">{s.desc || '还没有描述'}</span>
                  <span className="lib-sw5s">
                    {s.palette.map((hex, i) => (
                      <span key={i} className="lib-sw5" style={{ background: hex }} />
                    ))}
                  </span>
                </span>
              </span>
            </button>
            <button type="button" className="eye" aria-label="编辑" title="编辑" onClick={() => openEdit(s)}>
              <Icon name="eye" size={15} />
            </button>
            {copiedId === s.id && (
              <span className="done">
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
        subtitle={styles.loading ? '所有项目共用' : `所有项目共用 · ${all.length} 种风格`}
        q={q}
        onQ={onQ}
        placeholder="搜索风格"
      >
        <IconButton icon="plus" label="新建风格" onClick={() => void create()} />
      </LibraryToolbar>
      <div className="screen-body">
        <main ref={mainRef} className="screen-main tint" tabIndex={0} aria-label="风格">
          {content}
        </main>
      </div>
      {editing && edit && <StyleSheet key={editing.id} style={editing} isNew={edit.isNew} onClose={() => setEdit(null)} />}
      <ConfirmSheet
        open={trashing !== null}
        title={`删除风格「${trashing ? nameOf(trashing) : ''}」？`}
        message={`删除后不能恢复。${affectedNote}`}
        confirmLabel="删除"
        destructive
        onCancel={() => setTrashing(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
