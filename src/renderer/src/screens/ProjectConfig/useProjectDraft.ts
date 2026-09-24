// 项目配置的草稿与自动保存：界面显示草稿（含还没保存的修改），停顿 400ms 后把改过的字段一起存进去。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectPatch } from '@shared/api'
import type { ID, Project } from '@shared/types'
import { useProject } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'

const SAVE_DELAY = 400

/** 去掉 ipcRenderer.invoke 报错里的前缀，只留原因 */
export function errorReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

/** 改草稿；save 为 false 时只改界面不保存（比如名称被清空时） */
export type ChangeProject = (patch: ProjectPatch, save?: boolean) => void

export interface ProjectDraft {
  /** 界面显示的项目（含还没保存的修改）；还没读到时是 undefined */
  project: Project | undefined
  /** 最近从主进程读到的项目 */
  saved: Project | undefined
  error: string | null
  change: ChangeProject
  /** 放弃还没保存的修改，并等正在进行的保存结束（删除项目前用） */
  discard: () => Promise<void>
}

const isEmpty = (p: ProjectPatch): boolean => Object.keys(p).length === 0

function showSaveError(err: unknown): void {
  hud.show(`没能保存：${errorReason(err)}`)
}

export function useProjectDraft(projectId: ID): ProjectDraft {
  const { data, error, mutate, refresh } = useProject(projectId)
  const [draft, setDraft] = useState<Project | undefined>(data)
  const pending = useRef<ProjectPatch>({})
  const inflight = useRef<{ patch: ProjectPatch; done: Promise<void> } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // 最近一次保存返回的修改时间：比它旧的读取结果（保存前就发出的读取）不采用
  const newest = useRef('')

  // 读到新数据：还没保存完的字段保留草稿里的值
  useEffect(() => {
    if (!data || data.updatedAt < newest.current) return
    setDraft({ ...data, ...inflight.current?.patch, ...pending.current })
  }, [data])

  const save = useCallback((): Promise<void> => {
    clearTimeout(timer.current)
    // 正在保存：存完会接着存剩下的
    if (inflight.current) return inflight.current.done
    if (isEmpty(pending.current)) return Promise.resolve()
    const patch = pending.current
    pending.current = {}
    let finish: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    inflight.current = { patch, done }
    void (async () => {
      try {
        const saved = await window.gp.projects.update(projectId, patch)
        if (saved.updatedAt > newest.current) newest.current = saved.updatedAt
        mutate(saved)
      } catch (err) {
        showSaveError(err)
        void refresh()
      } finally {
        inflight.current = null
        finish()
      }
      if (!isEmpty(pending.current)) void save()
    })()
    return done
  }, [projectId, mutate, refresh])

  const change = useCallback<ChangeProject>(
    (patch, persist = true) => {
      setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
      if (persist) {
        Object.assign(pending.current, patch)
      } else {
        const rest: Record<string, unknown> = pending.current
        for (const key of Object.keys(patch)) delete rest[key]
      }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), SAVE_DELAY)
    },
    [save]
  )

  const discard = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    pending.current = {}
    await inflight.current?.done
  }, [])

  // 离开页面时还没到 400ms 的修改立即保存
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      const patch = pending.current
      pending.current = {}
      if (!isEmpty(patch)) window.gp.projects.update(projectId, patch).catch(showSaveError)
    },
    [projectId]
  )

  return { project: draft, saved: data, error, change, discard }
}
