import { useEffect, useRef, useState } from 'react'
import type { SpriteCharacter } from '@shared/sprites'
import { showError } from '@renderer/screens/Library/shared'

/** 文本草稿单独保留；同一编辑器串行保存，旧响应不会盖掉继续输入的文字。 */
export function useSpriteAutosave<T extends Record<string, string>>(
  initial: T,
  save: (draft: T) => Promise<SpriteCharacter>,
  onSaved: (character: SpriteCharacter) => void
): { draft: T; edit: (patch: Partial<T>) => void; flush: () => void; status: string } {
  const [draft, setDraft] = useState(initial)
  const [status, setStatus] = useState('')
  const state = useRef({ draft: initial, saved: initial, running: false, mounted: true, timer: undefined as ReturnType<typeof setTimeout> | undefined })
  const callbacks = useRef({ save, onSaved })
  callbacks.current = { save, onSaved }
  const same = (a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b)

  const flush = async (): Promise<void> => {
    const s = state.current
    clearTimeout(s.timer)
    if (s.running || same(s.draft, s.saved)) return
    s.running = true
    if (s.mounted) setStatus('保存中…')
    try {
      while (!same(s.draft, s.saved)) {
        const sent = s.draft
        const result = await callbacks.current.save(sent)
        s.saved = sent
        if (same(s.draft, sent)) callbacks.current.onSaved(result)
      }
      if (s.mounted) setStatus('已自动保存')
    } catch (err) {
      if (s.mounted) setStatus('未保存，离开输入框可重试')
      showError('保存失败', err)
    } finally {
      s.running = false
    }
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    const s = state.current
    if (!s.running && same(s.draft, s.saved) && !same(initial, s.saved)) {
      s.draft = initial
      s.saved = initial
      setDraft(initial)
    }
  }, [initial])

  useEffect(() => {
    const s = state.current
    s.mounted = true
    return () => {
      s.mounted = false
      clearTimeout(s.timer)
      void flushRef.current()
    }
  }, [])

  const edit = (patch: Partial<T>): void => {
    const s = state.current
    s.draft = { ...s.draft, ...patch }
    setDraft(s.draft)
    setStatus('')
    clearTimeout(s.timer)
    s.timer = setTimeout(() => void flushRef.current(), 600)
  }
  return { draft, edit, flush: () => void flushRef.current(), status }
}
