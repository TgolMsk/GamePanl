import { useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Sheet } from './Sheet'

export interface ConfirmSheetProps {
  open: boolean
  title: ReactNode
  message?: ReactNode
  /** 确认按钮文字，默认「好」 */
  confirmLabel?: string
  /** 默认「取消」 */
  cancelLabel?: string
  /** 删除类操作：确认按钮用红色 */
  destructive?: boolean
  /** 可以返回 Promise；进行中再点按钮不起作用。完成后由调用方关闭（把 open 设为 false） */
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

/** 二次确认。回车确认（确认按钮默认获得焦点），Esc 或点遮罩取消 */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel = '好',
  cancelLabel = '取消',
  destructive,
  onConfirm,
  onCancel
}: ConfirmSheetProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  // 进行中不禁用按钮（禁用会让焦点掉出 sheet），只忽略重复点击
  const cancel = (): void => {
    if (!busy) onCancel()
  }
  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onClose={cancel}
      title={title}
      width={420}
      closeButton={false}
      footer={
        <>
          <span className="grow" />
          <Button onClick={cancel}>{cancelLabel}</Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={() => void confirm()} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message != null && <p className="confirm-msg">{message}</p>}
    </Sheet>
  )
}
