// 从访达拖入图片、⌘V 粘贴图片。
// 只有「当前最上层」的界面会收到：没有打开 sheet 时是页面，打开了 sheet 时是那个 sheet 里的组件。
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { hud } from './hud'
import { openSheetCount, useSheetDepth, useSheetStack } from './sheetStack'

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i
const ONLY_IMAGES = '只能添加图片（PNG、JPG、WebP、GIF）'

/** 是否是支持的图片文件（按扩展名） */
export function isImageFile(file: File): boolean {
  return IMAGE_EXT.test(file.name)
}

function pathOf(file: File): string {
  try {
    return window.gp.pathForFile(file)
  } catch {
    return ''
  }
}

interface DropTarget {
  id: number
  depth: number
  label: string
  hint: string
  onPaths: (paths: string[]) => void
}

const useDropStore = create<{ targets: DropTarget[]; dragging: boolean }>(() => ({
  targets: [],
  dragging: false
}))

function pickTarget(targets: DropTarget[], sheets: number): DropTarget | undefined {
  for (let i = targets.length - 1; i >= 0; i--) {
    if (targets[i].depth === sheets) return targets[i]
  }
  return undefined
}

function useActiveTarget(): DropTarget | undefined {
  const targets = useDropStore((s) => s.targets)
  const sheets = useSheetStack((s) => s.stack.length)
  return pickTarget(targets, sheets)
}

export interface FileDropOptions {
  /** 遮罩上的大字，默认「松手添加」；如「松手添加到「雾港」」 */
  label?: string
  /** 遮罩上的小字，默认「原图会存进工作台」 */
  hint?: string
  /** false 时不接收拖入 */
  enabled?: boolean
}

let nextId = 0

/**
 * 接收从访达拖进窗口的图片文件。onPaths 收到的是本地路径，已经滤掉了非图片文件。
 * 在页面里用时，拖入期间外壳会在主区显示「松手添加」遮罩；
 * 在 sheet 里用时没有遮罩，用返回值（正在拖入）自己高亮拖入区。
 */
export function useFileDrop(onPaths: (paths: string[]) => void, opts: FileDropOptions = {}): boolean {
  const { label = '松手添加', hint = '原图会存进工作台', enabled = true } = opts
  const depth = useSheetDepth()
  const [id] = useState(() => ++nextId)
  const latest = useRef(onPaths)
  useEffect(() => {
    latest.current = onPaths
  })
  useEffect(() => {
    if (!enabled) return
    const target: DropTarget = { id, depth, label, hint, onPaths: (paths) => latest.current(paths) }
    useDropStore.setState((s) => ({ targets: [...s.targets, target] }))
    return () => useDropStore.setState((s) => ({ targets: s.targets.filter((t) => t !== target) }))
  }, [id, depth, label, hint, enabled])
  const dragging = useDropStore((s) => s.dragging)
  const active = useActiveTarget()
  return dragging && active?.id === id
}

/** 外壳用：页面正在接收拖入时返回遮罩文案，否则 null */
export function usePageDropOverlay(): { label: string; hint: string } | null {
  const dragging = useDropStore((s) => s.dragging)
  const active = useActiveTarget()
  return dragging && active && active.depth === 0 ? { label: active.label, hint: active.hint } : null
}

/** 启动时调用一次：接管整个窗口的文件拖放（也防止文件被拖进来后当网页打开） */
export function installFileDrop(): void {
  let enterDepth = 0
  let internal = false

  const isFileDrag = (e: DragEvent): boolean =>
    !internal && !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
  const setDragging = (v: boolean): void => {
    if (useDropStore.getState().dragging !== v) useDropStore.setState({ dragging: v })
  }
  const activeTarget = (): DropTarget | undefined =>
    pickTarget(useDropStore.getState().targets, openSheetCount())

  // 窗口里自己发起的拖动（选中的文字、把图片卡片拖出去）不算文件拖入
  const onDragStart = (): void => {
    internal = true
  }
  const onDragEnd = (): void => {
    internal = false
  }
  // 图片卡片拖出去走的是系统原生拖拽，结束时不一定有 dragend；鼠标松开后再动一下就复位
  const onMouseMove = (e: MouseEvent): void => {
    if (internal && e.buttons === 0) internal = false
  }
  const onDragEnter = (e: DragEvent): void => {
    if (!isFileDrag(e)) return
    enterDepth++
    setDragging(true)
  }
  const onDragLeave = (e: DragEvent): void => {
    if (!isFileDrag(e)) return
    enterDepth = Math.max(0, enterDepth - 1)
    if (enterDepth === 0) setDragging(false)
  }
  const onDragOver = (e: DragEvent): void => {
    // 界面里的元素自己处理了（比如 sheet 里的拖入区）
    if (e.defaultPrevented) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = isFileDrag(e) && activeTarget() ? 'copy' : 'none'
  }
  const onDrop = (e: DragEvent): void => {
    const handled = e.defaultPrevented
    e.preventDefault()
    enterDepth = 0
    setDragging(false)
    if (handled || !isFileDrag(e)) return
    const target = activeTarget()
    if (!target) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    const paths = files
      .filter(isImageFile)
      .map(pathOf)
      .filter((p) => p !== '')
    if (paths.length > 0) target.onPaths(paths)
    else if (files.length > 0) hud.show(ONLY_IMAGES)
  }

  document.addEventListener('dragstart', onDragStart)
  document.addEventListener('dragend', onDragEnd)
  document.addEventListener('mousemove', onMouseMove)
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
}

/** 粘贴的内容：从访达复制的图片文件（给出路径），或剪贴板里的图片数据 */
export type PastedImage = { kind: 'files'; paths: string[] } | { kind: 'image' }

const TEXT_INPUT_TYPES = ['text', 'search', 'url', 'email', 'password', 'number', 'tel']

function isEditable(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.includes(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

/**
 * ⌘V 粘贴图片。焦点在输入框里时不拦截（照常粘贴文字）。
 * 收到 { kind: 'image' } 时调用 importImageFromClipboard / importAssetFromClipboard；
 * 收到 { kind: 'files', paths } 时调用 importImages(paths) / importAssets(projectId, paths)。
 */
export function usePasteImage(onPaste: (pasted: PastedImage) => void, opts: { enabled?: boolean } = {}): void {
  const enabled = opts.enabled ?? true
  const depth = useSheetDepth()
  const latest = useRef(onPaste)
  useEffect(() => {
    latest.current = onPaste
  })
  useEffect(() => {
    if (!enabled) return
    const onDocPaste = (e: ClipboardEvent): void => {
      if (e.defaultPrevented || isEditable(document.activeElement) || openSheetCount() !== depth) return
      const data = e.clipboardData
      if (!data) return
      const fromDisk = Array.from(data.files)
        .map((file) => ({ file, path: pathOf(file) }))
        .filter((x) => x.path !== '')
      if (fromDisk.length > 0) {
        e.preventDefault()
        const paths = fromDisk.filter((x) => isImageFile(x.file)).map((x) => x.path)
        if (paths.length > 0) latest.current({ kind: 'files', paths })
        else hud.show(ONLY_IMAGES)
        return
      }
      if (Array.from(data.items).some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
        e.preventDefault()
        latest.current({ kind: 'image' })
      }
    }
    document.addEventListener('paste', onDocPaste)
    return () => document.removeEventListener('paste', onDocPaste)
  }, [enabled, depth])
}
