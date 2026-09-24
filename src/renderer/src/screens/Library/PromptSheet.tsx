import { useId, useState } from 'react'
import { usePrompts } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import { Button, ConfirmSheet, GroupList, GroupRow, Segmented, Sheet, TextField } from '@renderer/ui'
import type { PromptPatch } from '@shared/api'
import { PROMPT_CATEGORIES, type Prompt, type PromptCategory } from '@shared/types'
import { copyPrompt, usesText } from './prompts'
import { errText, useDebouncedSave } from './shared'

const CATEGORY_OPTIONS = PROMPT_CATEGORIES.map((c) => ({ value: c, label: c }))

export interface PromptSheetProps {
  /** 缓存里的最新数据（用过几次等）；编辑中的标题和正文以本地草稿为准 */
  prompt: Prompt
  /** 刚用加号新建的：关掉时标题和正文都没写就不留下 */
  isNew: boolean
  onClose: () => void
}

/** 编辑提示词：标题、分类、正文，停顿后自动保存；底部 [删除] [复制] [完成] */
export function PromptSheet({ prompt, isNew, onClose }: PromptSheetProps): React.JSX.Element {
  const prompts = usePrompts()
  const titleId = useId()
  const bodyId = useId()
  const [title, setTitle] = useState(prompt.title)
  const [body, setBody] = useState(prompt.body)
  const [confirming, setConfirming] = useState(false)

  const replace = (next: Prompt): void => prompts.mutate((list) => list.map((p) => (p.id === next.id ? next : p)))

  const save = async (patch: PromptPatch): Promise<void> => {
    try {
      replace(await window.gp.library.updatePrompt(prompt.id, patch))
    } catch (err) {
      hud.show(`保存失败：${errText(err)}`)
    }
  }

  const textSave = useDebouncedSave((patch: { title: string; body: string }) => void save(patch))

  const setCategory = (category: PromptCategory): void => {
    prompts.mutate((list) => list.map((p) => (p.id === prompt.id ? { ...p, category } : p)))
    void save({ category })
  }

  const close = (): void => {
    if (isNew && !title.trim() && !body.trim()) {
      textSave.cancel()
      prompts.mutate((list) => list.filter((p) => p.id !== prompt.id))
      window.gp.library.deletePrompt(prompt.id).catch(() => void prompts.refresh())
    } else {
      textSave.flush()
    }
    onClose()
  }

  const remove = async (): Promise<void> => {
    textSave.cancel()
    try {
      await window.gp.library.deletePrompt(prompt.id)
      prompts.mutate((list) => list.filter((p) => p.id !== prompt.id))
      onClose()
      hud.show('已删除提示词', { ok: true })
    } catch (err) {
      setConfirming(false)
      hud.show(`删除失败：${errText(err)}`)
    }
  }

  return (
    <Sheet
      open
      onClose={close}
      title={title.trim() || '未命名'}
      subtitle={`${prompt.category} · ${usesText(prompt.uses)}`}
      width={640}
      height={560}
      bodyClassName="lib-pe"
      footer={
        <>
          <Button icon="trash" onClick={() => setConfirming(true)}>
            删除
          </Button>
          <span className="grow" />
          <Button icon="copy" onClick={() => void copyPrompt({ id: prompt.id, body }, replace)}>
            复制
          </Button>
          <Button variant="primary" onClick={close}>
            完成
          </Button>
        </>
      }
    >
      <GroupList>
        <GroupRow label="标题" htmlFor={titleId} labelWidth={48}>
          <TextField
            id={titleId}
            value={title}
            maxLength={200}
            placeholder="给这条提示词起个名字"
            autoFocus={isNew}
            onChange={(e) => {
              setTitle(e.target.value)
              textSave.schedule({ title: e.target.value, body })
            }}
          />
        </GroupRow>
        <GroupRow label="分类" labelWidth={48} fill>
          <Segmented ariaLabel="分类" value={prompt.category} onChange={setCategory} options={CATEGORY_OPTIONS} />
        </GroupRow>
      </GroupList>
      <div className="lib-pe-main">
        <div className="lib-pe-head">
          <label className="gh" htmlFor={bodyId}>
            正文
          </label>
          <span className="grow" />
          <span className="meta">{body.length} 字</span>
        </div>
        <textarea
          id={bodyId}
          className="fld lib-area"
          value={body}
          placeholder="输入提示词正文"
          spellCheck={false}
          onChange={(e) => {
            setBody(e.target.value)
            textSave.schedule({ title, body: e.target.value })
          }}
        />
      </div>
      <ConfirmSheet
        open={confirming}
        title={`删除提示词「${title.trim() || '未命名'}」？`}
        message="删除后不能恢复。"
        confirmLabel="删除"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </Sheet>
  )
}
