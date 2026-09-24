// 全局库各 tab 共用的小工具：搜索匹配、报错文字、防抖自动保存、「用于项目」查询。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useProjects } from '@renderer/app/data'
import type { ProjectSummary } from '@shared/types'

/** 搜索：按空格拆成几个词，每个词都要出现在某个字段里（不区分大小写） */
export function matches(q: string, fields: ReadonlyArray<string>): boolean {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = fields.map((f) => f.toLowerCase())
  return terms.every((t) => hay.some((f) => f.includes(t)))
}

/** 接口报错只留原因（去掉 ipcRenderer.invoke 加的前缀） */
export function errText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

export interface DebouncedSave<T> {
  /** 记下最新的值，停顿 ms 毫秒后保存 */
  schedule: (value: T) => void
  /** 有没保存的就立即保存 */
  flush: () => void
  /** 丢掉没保存的 */
  cancel: () => void
}

/** 边打字边存：停顿后保存最新的值；组件卸载时把没存的存掉 */
export function useDebouncedSave<T>(save: (value: T) => void, ms = 500): DebouncedSave<T> {
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  const pending = useRef<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const p = pending.current
    pending.current = null
    if (p) saveRef.current(p.value)
  }, [])
  const schedule = useCallback(
    (value: T) => {
      pending.current = { value }
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, ms)
    },
    [flush, ms]
  )
  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    pending.current = null
  }, [])

  useEffect(() => flush, [flush])
  return { schedule, flush, cancel }
}

/**
 * 哪些项目用到了某样东西（风格、全局库图片）。key 为 null 时不查。
 * 项目列表变化（配置、资料有改动时也会变）后重新查；还没查完时返回 null。
 */
export function useProjectsWhere(
  key: string | null,
  test: (projectId: string) => Promise<boolean>
): ProjectSummary[] | null {
  const projects = useProjects()
  const testRef = useRef(test)
  useEffect(() => {
    testRef.current = test
  })
  const [found, setFound] = useState<{ key: string; list: ProjectSummary[] } | null>(null)

  useEffect(() => {
    if (key === null || projects.loading) return
    let cancelled = false
    const list = projects.data
    Promise.all(list.map((p) => testRef.current(p.id).catch(() => false))).then((hits) => {
      if (!cancelled) setFound({ key, list: list.filter((_, i) => hits[i]) })
    })
    return () => {
      cancelled = true
    }
  }, [key, projects.data, projects.loading])

  return found && found.key === key ? found.list : null
}
