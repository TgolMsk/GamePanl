import { useRef } from 'react'
import { useFileDrop, usePasteImage } from '@renderer/app/drop'
import { Button, cx, Icon, Sheet } from '@renderer/ui'
import type { ImportSource } from './importImages'

export interface AddImagesSheetProps {
  open: boolean
  onClose: () => void
  /** 导入；有新图片加入时返回 true，sheet 随之关闭 */
  onImport: (source: ImportSource) => Promise<boolean>
}

/** 添加图片：拖入区（也接受 ⌘V）+ [选择文件…] + [从剪贴板粘贴] */
export function AddImagesSheet({ open, onClose, onImport }: AddImagesSheetProps): React.JSX.Element {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="添加图片"
      width={520}
      height={380}
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
        </>
      }
    >
      <DropZone onImport={onImport} onDone={onClose} />
    </Sheet>
  )
}

/** 放在 sheet 里面，拖入和粘贴才由这一层接收 */
function DropZone({ onImport, onDone }: { onImport: AddImagesSheetProps['onImport']; onDone: () => void }): React.JSX.Element {
  // 进行中不禁用按钮（禁用会让焦点掉出 sheet），只忽略重复操作
  const busy = useRef(false)

  const run = async (source: ImportSource): Promise<void> => {
    if (busy.current) return
    busy.current = true
    let added = false
    try {
      added = await onImport(source)
    } finally {
      busy.current = false
    }
    if (added) onDone()
  }

  const dragging = useFileDrop((paths) => void run({ kind: 'files', paths }))
  usePasteImage((p) => void run(p.kind === 'files' ? { kind: 'files', paths: p.paths } : { kind: 'clipboard' }))

  return (
    <div className={cx('drop lib-drop', dragging && 'on')}>
      <span className="lib-drop-ic">
        <Icon name="photo" size={40} strokeWidth={1.3} />
      </span>
      <div className="lib-drop-t">把图片拖到这里，或 ⌘V 粘贴</div>
      <div className="lbl">PNG、JPG、WebP、GIF · 存进工作台，所有项目共用</div>
      <div className="lib-drop-acts">
        <Button onClick={() => void run({ kind: 'picker' })}>
          选择文件…
        </Button>
        <Button onClick={() => void run({ kind: 'clipboard' })}>
          从剪贴板粘贴
        </Button>
      </div>
    </div>
  )
}
