import { useRef } from 'react'
import { useFileDrop, usePasteImage } from '@renderer/app/drop'
import { Button, Icon, Sheet, cx } from '@renderer/ui'

export interface AddImagesSheetProps {
  open: boolean
  projectName: string
  onClose: () => void
  /** 导入图片文件；不给路径时弹出系统文件选择框。返回 true 表示有图片落地（sheet 随即关掉） */
  importFiles: (paths?: string[]) => Promise<boolean>
  /** 导入剪贴板里的图片，返回值同上 */
  importClipboard: () => Promise<boolean>
}

/** 添加图片：拖入区 + 选择文件 + 从剪贴板粘贴（sheet 打开时拖入和 ⌘V 都交给它） */
export function AddImagesSheet(props: AddImagesSheetProps): React.JSX.Element | null {
  return props.open ? <AddImages {...props} /> : null
}

function AddImages({ projectName, onClose, importFiles, importClipboard }: AddImagesSheetProps): React.JSX.Element {
  const busy = useRef(false)

  const run = async (task: () => Promise<boolean>): Promise<void> => {
    if (busy.current) return
    busy.current = true
    const landed = await task()
    busy.current = false
    if (landed) onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="添加图片"
      subtitle={`原图存进工作台，加入「${projectName}」资料`}
      width={660}
      bodyStyle={{ padding: '16px 20px 20px' }}
    >
      <DropZone
        onFiles={(paths) => void run(() => importFiles(paths))}
        onClipboard={() => void run(importClipboard)}
      />
    </Sheet>
  )
}

/** 拖入区。要放在 Sheet 里面渲染，拖入和 ⌘V 才会交给这一层 sheet */
function DropZone({
  onFiles,
  onClipboard
}: {
  onFiles: (paths?: string[]) => void
  onClipboard: () => void
}): React.JSX.Element {
  const dragging = useFileDrop((paths) => onFiles(paths))
  usePasteImage((p) => (p.kind === 'files' ? onFiles(p.paths) : onClipboard()))
  return (
    <div className={cx('drop', 'as-dz', dragging && 'on')}>
      <span className="ic">
        <Icon name="photo" size={40} strokeWidth={1.3} />
      </span>
      <div className="dt">把图片拖到这里</div>
      <div className="lbl">PNG、JPG、WebP、GIF 都可以，也可以 ⌘V 粘贴</div>
      <div className="acts">
        <Button onClick={() => onFiles()}>选择文件…</Button>
        <Button onClick={onClipboard}>从剪贴板粘贴</Button>
      </div>
    </div>
  )
}
