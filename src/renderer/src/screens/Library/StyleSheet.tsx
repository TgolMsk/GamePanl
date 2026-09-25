import { useId, useState } from 'react'
import { useStyles } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import { Button, ConfirmSheet, GroupList, GroupRow, Sheet, TextField } from '@renderer/ui'
import type { StylePatch } from '@shared/api'
import type { Style } from '@shared/types'
import { ProjectLinks } from './common'
import { SamplePicker } from './SamplePicker'
import { errText, useDebouncedSave, useProjectsWhere } from './shared'
import { copyStylePrompt, isDefaultPalette, PaletteEditor, StyleVisual } from './styleParts'

interface StyleText {
  name: string
  desc: string
  prompt: string
}

export interface StyleSheetProps {
  /** 缓存里的最新数据（色板、样张）；名称、描述、提示词以本地草稿为准 */
  style: Style
  /** 刚用加号新建的：关掉时什么都没填就不留下 */
  isNew: boolean
  onClose: () => void
}

/** 风格详情：样张、名称、描述、色板、提示词都能改，显示用在哪些项目；底部 [删除] [复制提示词] [完成] */
export function StyleSheet({ style, isNew, onClose }: StyleSheetProps): React.JSX.Element {
  const styles = useStyles()
  const nameId = useId()
  const descId = useId()
  const promptId = useId()
  const [text, setText] = useState<StyleText>({ name: style.name, desc: style.desc, prompt: style.prompt })
  const [picking, setPicking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const usedIn = useProjectsWhere(style.id, async (projectId) => (await window.gp.projects.get(projectId)).styleId === style.id)

  const save = async (patch: StylePatch): Promise<void> => {
    try {
      const next = await window.gp.library.updateStyle(style.id, patch)
      styles.mutate((list) => list.map((s) => (s.id === next.id ? next : s)))
    } catch (err) {
      hud.show(`保存失败：${errText(err)}`)
      void styles.refresh()
    }
  }

  const textSave = useDebouncedSave((value: StyleText) => void save(value))

  const edit = (patch: Partial<StyleText>): void => {
    const next = { ...text, ...patch }
    setText(next)
    textSave.schedule(next)
  }

  /** 色板、样张：立即保存 */
  const saveNow = (patch: StylePatch): void => {
    styles.mutate((list) => list.map((s) => (s.id === style.id ? { ...s, ...patch } : s)))
    void save(patch)
  }

  /** 从样张提取 5 个主色换掉色板 */
  const extractFrom = async (imageId: string, auto: boolean): Promise<void> => {
    setExtracting(true)
    try {
      const palette = await window.gp.library.extractPalette(imageId, 5)
      if (palette.length === 0) {
        if (!auto) hud.show('读不出这张图的颜色')
        return
      }
      saveNow({ palette })
      hud.show(auto ? '已按样张生成色板' : '已从样张重新提取色板', { ok: true })
    } catch (err) {
      hud.show(`提取色板失败：${errText(err)}`)
    } finally {
      setExtracting(false)
    }
  }

  const pickSample = (sampleImageId: string | null): void => {
    setPicking(false)
    if (sampleImageId === style.sampleImageId) return
    saveNow({ sampleImageId })
    // 色板还是新建时的默认灰阶，说明用户没自己调过：直接按样张生成
    if (sampleImageId && isDefaultPalette(style.palette)) void extractFrom(sampleImageId, true)
  }

  const close = (): void => {
    const blank = !text.name.trim() && !text.desc.trim() && !text.prompt.trim() && style.sampleImageId === null
    if (isNew && blank) {
      textSave.cancel()
      styles.mutate((list) => list.filter((s) => s.id !== style.id))
      window.gp.library.deleteStyle(style.id).catch(() => void styles.refresh())
    } else {
      textSave.flush()
    }
    onClose()
  }

  const remove = async (): Promise<void> => {
    textSave.cancel()
    try {
      await window.gp.library.deleteStyle(style.id)
      styles.mutate((list) => list.filter((s) => s.id !== style.id))
      onClose()
      hud.show('已删除风格', { ok: true })
    } catch (err) {
      setConfirming(false)
      hud.show(`删除失败：${errText(err)}`)
    }
  }

  const displayName = text.name.trim() || '未命名风格'
  const affected = usedIn && usedIn.length > 0 ? `${usedIn.map((p) => `「${p.name}」`).join('')}的美术风格会改为未设置。` : ''

  return (
    <Sheet
      open
      onClose={close}
      title={displayName}
      subtitle="风格"
      width={880}
      height={600}
      bodyClassName="lib-se"
      footer={
        <>
          <Button icon="trash" onClick={() => setConfirming(true)}>
            删除
          </Button>
          <span className="grow" />
          <Button icon="copy" onClick={() => void copyStylePrompt(text.prompt)}>
            复制提示词
          </Button>
          <Button variant="primary" onClick={close}>
            完成
          </Button>
        </>
      }
    >
      <div className="lib-se-left">
        <div className="lib-se-vis">
          <StyleVisual style={{ ...style, name: text.name }} thumb={800} />
        </div>
        <div className="lib-se-acts">
          <Button size="sm" icon="photo" onClick={() => setPicking(true)}>
            {style.sampleImageId ? '更换样张…' : '选择样张…'}
          </Button>
          {style.sampleImageId && (
            <>
              <Button
                size="sm"
                icon="palette"
                disabled={extracting}
                onClick={() => void extractFrom(style.sampleImageId!, false)}
              >
                {extracting ? '正在提取…' : '从样张提取色板'}
              </Button>
              <Button size="sm" variant="plain" onClick={() => saveNow({ sampleImageId: null })}>
                不用样张
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="lib-se-right">
        <GroupList>
          <GroupRow label="名称" htmlFor={nameId} labelWidth={48}>
            <TextField
              id={nameId}
              value={text.name}
              maxLength={200}
              placeholder="给这个风格起个名字"
              autoFocus={isNew}
              onChange={(e) => edit({ name: e.target.value })}
            />
          </GroupRow>
          <GroupRow label="描述" htmlFor={descId} labelWidth={48}>
            <TextField
              id={descId}
              value={text.desc}
              maxLength={500}
              placeholder="一句话说说这个风格"
              onChange={(e) => edit({ desc: e.target.value })}
            />
          </GroupRow>
        </GroupList>
        <section className="gsec">
          <div className="gh">色板</div>
          <PaletteEditor palette={style.palette} onChange={(palette) => saveNow({ palette })} />
        </section>
        <section className="gsec lib-se-prompt">
          <label className="gh" htmlFor={promptId}>
            风格提示词
          </label>
          <textarea
            id={promptId}
            className="fld lib-area"
            value={text.prompt}
            placeholder="输入这个风格的提示词"
            spellCheck={false}
            onChange={(e) => edit({ prompt: e.target.value })}
          />
        </section>
        <GroupList>
          <GroupRow
            labelWidth="auto"
            label="用于项目"
            value={<ProjectLinks projects={usedIn} tab="config" none="还没有项目在用" />}
          />
        </GroupList>
      </div>
      <SamplePicker
        open={picking}
        current={style.sampleImageId}
        onClose={() => setPicking(false)}
        onPick={pickSample}
      />
      <ConfirmSheet
        open={confirming}
        title={`删除风格「${displayName}」？`}
        message={`删除后不能恢复。${affected}`}
        confirmLabel="删除"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </Sheet>
  )
}
