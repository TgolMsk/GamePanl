import { useEffect, useRef, type KeyboardEvent } from 'react'
import { cx, Icon, Tag } from '@renderer/ui'
import type { Note } from '@shared/types'
import { displayTitle, firstImage, listDate, summaryOf, type NoteGroup } from './noteUtil'
import { Thumb } from './Thumb'

export interface NoteListProps {
  groups: NoteGroup[]
  curId: string | null
  /** 列表为空时居中显示的提示；null 不显示（还在读取） */
  emptyText: string | null
  onPick: (id: string) => void
  onToggle: (note: Note) => void
  /** ↑ / ↓ 切换到上一条 / 下一条 */
  onMove: (delta: 1 | -1) => void
}

/** 左侧笔记列表：按 今天 / 昨天 / 过去 7 天 / 更早 分组，↑↓ 切换 */
export function NoteList({ groups, curId, emptyText, onPick, onToggle, onMove }: NoteListProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  // 选中项滚进可见范围；焦点在列表里时跟着移过去
  useEffect(() => {
    const list = ref.current
    if (!list || !curId) return
    const row = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(curId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
    if (list.contains(document.activeElement)) row?.querySelector<HTMLElement>('.pn-nb')?.focus()
  }, [curId])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    onMove(e.key === 'ArrowDown' ? 1 : -1)
  }

  return (
    <div className="pn-list" ref={ref} onKeyDown={onKeyDown}>
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <div className="pn-sec">{g.label}</div>
          {g.notes.map((n, i) => {
            const on = n.id === curId
            const next = g.notes[i + 1]
            const thumb = firstImage(n)
            return (
              <div
                key={n.id}
                data-id={n.id}
                className={cx('pn-row', on && 'on', (!next || on || next.id === curId) && 'nosep')}
              >
                <button
                  type="button"
                  className={cx('pn-ck', n.done && 'on')}
                  tabIndex={-1}
                  aria-label={n.done ? '标记为未完成' : '标记为完成'}
                  aria-pressed={n.done}
                  onClick={() => onToggle(n)}
                >
                  <Icon name={n.done ? 'checkmark.square' : 'square'} size={18} />
                </button>
                <button
                  type="button"
                  className="pn-nb"
                  tabIndex={on ? 0 : -1}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onPick(n.id)}
                >
                  <span className="pn-ncol">
                    <span className={cx('pn-nt', n.done && 'struck')}>{displayTitle(n)}</span>
                    <span className="pn-ns">{summaryOf(n)}</span>
                    <span className="pn-nm">
                      <span>{listDate(n.updatedAt)}</span>
                      <Tag size="xs">{n.category}</Tag>
                    </span>
                  </span>
                  {thumb && (
                    <span className="pn-thumb">
                      <Thumb image={thumb} size={96} />
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </section>
      ))}
      {groups.length === 0 && emptyText && <div className="pn-listempty">{emptyText}</div>}
    </div>
  )
}
