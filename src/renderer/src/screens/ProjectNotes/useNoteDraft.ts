// 正在编辑的笔记：本地草稿 + 停顿 500ms 自动保存；切换笔记、离开界面前立即保存。
// 写操作排成一队按顺序执行，保存回来的旧内容不会盖掉之后又打的字。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Resource } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import type { Note } from '@shared/types'
import { replaceNote } from './noteUtil'

const SAVE_DELAY = 500

export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

export interface NoteDraft {
  /** 编辑区里的笔记（含还没保存的改动）；没有选中时为 null */
  draft: Note | null
  /** 改动当前笔记，停顿 500ms 后保存 */
  edit: (fn: (n: Note) => Note) => void
  /** 有没保存的改动就立即保存 */
  flush: () => void
  /** 排进写队列（保存、删除等按顺序执行） */
  enqueue: <T>(task: () => Promise<T>) => Promise<T>
  /**
   * 编辑区要显示的笔记（缓存里的版本）变了时调用。
   * 换了一条就先保存上一条再载入；同一条在别处被改了且本地没有未保存的改动时，换成新的。
   */
  show: (current: Note | null) => void
}

export function useNoteDraft(projectId: string, notes: Resource<Note[]>): NoteDraft {
  const { mutate } = notes
  const [draft, setDraftState] = useState<Note | null>(null)
  const draftRef = useRef<Note | null>(null)
  const dirty = useRef(false)
  const inflight = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  const setDraft = useCallback((n: Note | null) => {
    draftRef.current = n
    setDraftState(n)
  }, [])

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const p = chain.current.then(task)
    chain.current = p.catch(() => undefined)
    return p
  }, [])

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const n = draftRef.current
    if (!dirty.current || !n) return
    dirty.current = false
    // 先写进缓存，列表立刻反映；保存回来后再换成主进程返回的版本
    mutate((list) => replaceNote(list, n))
    inflight.current++
    enqueue(() => window.gp.projects.saveNote(projectId, n))
      .then(
        (saved) => {
          mutate((list) => replaceNote(list, saved))
          const d = draftRef.current
          if (d && d.id === saved.id) {
            // 保存期间又改了：保留新内容，只更新时间
            setDraft(d === n ? saved : { ...d, createdAt: saved.createdAt, updatedAt: saved.updatedAt })
          }
        },
        (err: unknown) => hud.show(`「${n.title.trim() || '新笔记'}」保存失败：${errorText(err)}`)
      )
      .finally(() => {
        inflight.current--
      })
  }, [projectId, mutate, enqueue, setDraft])

  const edit = useCallback(
    (fn: (n: Note) => Note) => {
      const d = draftRef.current
      if (!d) return
      setDraft(fn(d))
      dirty.current = true
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY)
    },
    [flush, setDraft]
  )

  const show = useCallback(
    (current: Note | null) => {
      const d = draftRef.current
      if (current && d && d.id === current.id) {
        if (!dirty.current && inflight.current === 0 && current.updatedAt > d.updatedAt) setDraft(current)
        return
      }
      flush()
      setDraft(current)
    },
    [flush, setDraft]
  )

  // 离开界面、关窗口前把没保存的改动存下来
  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [flush])

  return { draft, edit, flush, enqueue, show }
}
