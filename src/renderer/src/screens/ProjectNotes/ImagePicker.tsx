import { useEffect, useRef, useState } from 'react'
import { openSheetCount } from '@renderer/app/sheetStack'
import { Button, Icon } from '@renderer/ui'
import type { ImageRef } from '@shared/types'
import type { ImageSource } from './images'
import { refKey } from './noteUtil'
import { Thumb } from './Thumb'

interface PickItem {
  ref: ImageRef
  name: string
}

export interface ImagePickerProps {
  projectId: string
  images: ImageSource
  /** 正文里已经有的图片（refKey），缩略图上打勾 */
  inNote: ReadonlySet<string>
  onInsert: (ref: ImageRef, name: string) => void
}

/** 编辑区工具栏的 [插入图片]：点开是一个 popover，本项目资料 / 全局库两组缩略图，点一张插到正文末尾 */
export function ImagePicker({ projectId, images, inNote, onInsert }: ImagePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  // 点 popover 外面、按 Esc 收起
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || openSheetCount() > 0) return
      e.preventDefault()
      setOpen(false)
      wrapRef.current?.querySelector<HTMLButtonElement>('.pn-popbtn')?.focus()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const projPicks: PickItem[] = images.assets.map((a) => ({ ref: { scope: 'project', projectId, id: a.id }, name: a.name }))
  const libPicks: PickItem[] = images.libImages.map((x) => ({ ref: { scope: 'library', id: x.id }, name: x.name }))

  const grid = (picks: PickItem[], empty: string): React.JSX.Element =>
    picks.length === 0 ? (
      <div className="lbl pn-pempty">{empty}</div>
    ) : (
      <div className="pn-pgrid">
        {picks.map((p) => (
          <button
            key={refKey(p.ref)}
            type="button"
            className="pn-pk"
            title={p.name}
            onClick={() => {
              setOpen(false)
              onInsert(p.ref, p.name)
            }}
          >
            <span className="pn-pf">
              <Thumb image={p.ref} size={200} />
              {inNote.has(refKey(p.ref)) && (
                <span className="pn-inb" title="已在正文中">
                  <Icon name="check" size={10} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="pn-pl">{p.name || '未命名'}</span>
          </button>
        ))}
      </div>
    )

  return (
    <span className="pn-popanchor" ref={wrapRef}>
      <Button
        icon="photo"
        className={open ? 'pn-popbtn on' : 'pn-popbtn'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        插入图片
      </Button>
      {open && (
        <div className="pn-pop" role="dialog" aria-label="插入图片">
          <span className="pn-arrow" />
          <div className="pn-poptitle">插入图片</div>
          <div className="pn-popscroll">
            <div className="pn-psec">本项目资料</div>
            {grid(projPicks, images.ready ? '本项目还没有资料' : '')}
            <div className="pn-psec">全局库</div>
            {grid(libPicks, images.ready ? '全局库还没有图片' : '')}
          </div>
        </div>
      )}
    </span>
  )
}
