import { useState } from 'react'
import { useCopiedFlag } from '@renderer/app/clipboard'
import { useStyles } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import { Button, cx, EmptyState, Icon, IconButton } from '@renderer/ui'
import type { Style } from '@shared/types'
import { LibraryToolbar, LoadError } from './common'
import { errText, matches } from './shared'
import { StyleSheet } from './StyleSheet'
import { copyStylePrompt, StyleVisual } from './styleParts'

/** 新建风格的默认色板（中性灰阶，之后再改） */
const DEFAULT_PALETTE = ['#1D1F24', '#44474F', '#7C808A', '#C4C7CE', '#F2F3F5']

export interface StylesTabProps {
  q: string
  onQ: (q: string) => void
}

/** 全局库 · 风格：三列卡片（样张或色板条），单击复制风格提示词 */
export function StylesTab({ q, onQ }: StylesTabProps): React.JSX.Element {
  const styles = useStyles()
  const [selId, setSelId] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; isNew: boolean } | null>(null)
  const [copiedId, markCopied] = useCopiedFlag()

  const all = styles.data
  const shown = all.filter((s) => matches(q, [s.name, s.desc, s.prompt]))
  const editing = edit ? (all.find((s) => s.id === edit.id) ?? null) : null

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

  const view = (s: Style): void => {
    setSelId(s.id)
    setEdit({ id: s.id, isNew: false })
  }

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
          <div key={s.id} className={cx('card', selId === s.id && 'sel')}>
            <button
              type="button"
              className="hit lib-hit"
              aria-label={`复制风格「${s.name || '未命名风格'}」的提示词`}
              onClick={async () => {
                setSelId(s.id)
                if (await copyStylePrompt(s.prompt)) markCopied(s.id)
              }}
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
                  <span className="lib-sn">{s.name || '未命名风格'}</span>
                  <span className="lib-sd">{s.desc || '还没有描述'}</span>
                  <span className="lib-sw5s">
                    {s.palette.map((hex, i) => (
                      <span key={i} className="lib-sw5" style={{ background: hex }} />
                    ))}
                  </span>
                </span>
              </span>
            </button>
            <button type="button" className="eye" aria-label="查看" title="查看" onClick={() => view(s)}>
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
        <main className="screen-main tint">{content}</main>
      </div>
      {editing && edit && <StyleSheet key={editing.id} style={editing} isNew={edit.isNew} onClose={() => setEdit(null)} />}
    </div>
  )
}
