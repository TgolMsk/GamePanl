// 多选：单击选一项，⌘ 点击加选 / 取消，⇧ 点击连选（按当前显示顺序）。
import { useCallback, useMemo, useRef, useState } from 'react'

export interface MultiSelect {
  /** 选中的 id 集合（保持插入顺序） */
  ids: ReadonlySet<string>
  /** 最后一次单击（不带修饰键）或加选的那一项，作为 ⇧ 连选的起点 */
  anchor: string | null
  count: number
  has: (id: string) => boolean
  /** 按鼠标事件处理：普通单击 = 只选这一项；⌘ = 切换；⇧ = 从 anchor 连选到这一项 */
  click: (id: string, e: { metaKey: boolean; shiftKey: boolean; ctrlKey: boolean }) => void
  /** 只选这一项 */
  set: (id: string | null) => void
  setMany: (ids: string[]) => void
  toggle: (id: string) => void
  clear: () => void
  /** 只保留仍然存在的 id（列表变化后调用） */
  retain: (existing: ReadonlySet<string> | string[]) => void
}

/**
 * const sel = useMultiSelect(shownIds)
 * <ImageCard selected={sel.has(id)} onClick={(e) => sel.click(id, e)} />
 * 右键一张没选中的卡片时先 sel.set(id)，这样菜单作用在这一张上；右键已选中的卡片则作用在整组上。
 */
export function useMultiSelect(order: ReadonlyArray<string>): MultiSelect {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const orderRef = useRef(order)
  orderRef.current = order

  const set = useCallback((id: string | null) => {
    setIds(new Set(id ? [id] : []))
    setAnchor(id)
  }, [])

  const setMany = useCallback((list: string[]) => {
    setIds(new Set(list))
    setAnchor(list[0] ?? null)
  }, [])

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchor(id)
  }, [])

  const clear = useCallback(() => {
    setIds(new Set())
    setAnchor(null)
  }, [])

  const click = useCallback(
    (id: string, e: { metaKey: boolean; shiftKey: boolean; ctrlKey: boolean }) => {
      if (e.shiftKey && anchor) {
        const o = orderRef.current
        const a = o.indexOf(anchor)
        const b = o.indexOf(id)
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a]
          setIds(new Set(o.slice(from, to + 1)))
          return
        }
      }
      if (e.metaKey || e.ctrlKey) {
        toggle(id)
        return
      }
      set(id)
    },
    [anchor, set, toggle]
  )

  const retain = useCallback((existing: ReadonlySet<string> | string[]) => {
    const keep = existing instanceof Set ? existing : new Set(existing)
    setIds((prev) => {
      const next = new Set([...prev].filter((x) => keep.has(x)))
      return next.size === prev.size ? prev : next
    })
    setAnchor((a) => (a && keep.has(a) ? a : null))
  }, [])

  return useMemo(
    () => ({ ids, anchor, count: ids.size, has: (id: string) => ids.has(id), click, set, setMany, toggle, clear, retain }),
    [ids, anchor, click, set, setMany, toggle, clear, retain]
  )
}
