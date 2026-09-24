import { useId, useState, type KeyboardEvent } from 'react'
import { copyImage } from '@renderer/app/clipboard'
import { useLibImages, useStyles } from '@renderer/app/data'
import { formatBytes, formatDate, formatSize } from '@renderer/app/format'
import { hud } from '@renderer/app/hud'
import { Button, ConfirmSheet, cx, GroupList, GroupRow, Select, Sheet, TagEditor, TextField } from '@renderer/ui'
import { imageUrl, type LibImagePatch } from '@shared/api'
import { IMAGE_CATEGORIES, type LibImage } from '@shared/types'
import { ProjectLinks } from './common'
import { errText, useDebouncedSave, useProjectsWhere } from './shared'

// 图片区约 600 × 448（sheet 940×600 减去标题栏、按钮栏和边距），留一点余量
const STAGE_W = 600
const STAGE_H = 440

function fitSize(w: number, h: number): { width: number; height: number; scale: number } | null {
  if (!(w > 0 && h > 0)) return null
  const scale = Math.min(STAGE_W / w, STAGE_H / h)
  return { width: Math.round(w * scale), height: Math.round(h * scale), scale }
}

/** 全局库图片的 Quick Look：大图 + 可改的名称、分类、标签，底部 [在访达中显示] [删除] [关闭] [复制] */
export function ImageQuickLook({ image, onClose }: { image: LibImage | null; onClose: () => void }): React.JSX.Element | null {
  // 换一张图就是新的草稿
  return image ? <QuickLookSheet key={image.id} image={image} onClose={onClose} /> : null
}

function QuickLookSheet({ image, onClose }: { image: LibImage; onClose: () => void }): React.JSX.Element {
  const images = useLibImages()
  const styles = useStyles()
  const nameId = useId()
  const catId = useId()
  const ref = { scope: 'library', id: image.id } as const
  const [name, setName] = useState(image.name)
  const [confirming, setConfirming] = useState(false)
  const usedIn = useProjectsWhere(image.id, async (projectId) =>
    (await window.gp.projects.listAssets(projectId)).some((a) => a.sourceLibraryId === image.id)
  )

  const update = async (patch: LibImagePatch): Promise<void> => {
    images.mutate((list) => list.map((x) => (x.id === image.id ? { ...x, ...patch } : x)))
    try {
      const next = await window.gp.library.updateImage(image.id, patch)
      images.mutate((list) => list.map((x) => (x.id === next.id ? next : x)))
    } catch (err) {
      hud.show(`保存失败：${errText(err)}`)
      void images.refresh()
    }
  }

  const nameSave = useDebouncedSave((value: string) => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== image.name) void update({ name: trimmed })
  }, 600)

  const close = (): void => {
    nameSave.flush()
    onClose()
  }

  const onNameKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) e.currentTarget.blur()
  }

  const reveal = async (): Promise<void> => {
    try {
      await window.gp.shell.revealImage(ref)
    } catch {
      hud.show('找不到原文件')
    }
  }

  const remove = async (): Promise<void> => {
    nameSave.cancel()
    try {
      await window.gp.library.deleteImage(image.id)
      images.mutate((list) => list.filter((x) => x.id !== image.id))
      onClose()
      hud.show('已移到废纸篓', { ok: true })
    } catch (err) {
      setConfirming(false)
      hud.show(`删除失败：${errText(err)}`)
    }
  }

  const samples = styles.data.filter((s) => s.sampleImageId === image.id)
  const fit = fitSize(image.width, image.height)

  return (
    <Sheet
      open
      onClose={close}
      title={name.trim() || image.name}
      subtitle={[image.category, formatSize(image.width, image.height), image.format].join(' · ')}
      width={940}
      height={600}
      bodyClassName="ql-body"
      footer={
        <>
          <Button icon="folder" onClick={() => void reveal()}>
            在访达中显示
          </Button>
          <Button icon="trash" onClick={() => setConfirming(true)}>
            删除
          </Button>
          <span className="grow" />
          <Button onClick={close}>关闭</Button>
          <Button variant="primary" icon="copy" onClick={() => void copyImage(ref, image.name)}>
            复制
          </Button>
        </>
      }
    >
      <div className="ql-stage">
        <img
          src={imageUrl(ref)}
          alt={image.name}
          draggable={false}
          className={cx('checker', fit !== null && fit.scale >= 2 && 'px')}
          style={fit ? { width: fit.width, height: fit.height } : undefined}
        />
      </div>
      <div className="ql-info">
        <GroupList>
          <GroupRow label="名称" htmlFor={nameId} labelWidth={56}>
            <TextField
              id={nameId}
              value={name}
              maxLength={200}
              placeholder={image.name}
              onChange={(e) => {
                setName(e.target.value)
                nameSave.schedule(e.target.value)
              }}
              onBlur={() => {
                nameSave.flush()
                if (!name.trim()) setName(image.name)
              }}
              onKeyDown={onNameKey}
            />
          </GroupRow>
          <GroupRow label="分类" htmlFor={catId} labelWidth={56}>
            <Select
              id={catId}
              value={image.category}
              options={IMAGE_CATEGORIES}
              onChange={(category) => void update({ category })}
            />
          </GroupRow>
        </GroupList>
        <GroupList>
          <GroupRow labelWidth="auto" label="尺寸" value={formatSize(image.width, image.height)} />
          <GroupRow labelWidth="auto" label="格式" value={image.format} />
          <GroupRow labelWidth="auto" label="大小" value={formatBytes(image.bytes)} />
          <GroupRow labelWidth="auto" label="添加日期" value={formatDate(image.addedAt, { time: true })} />
          <GroupRow
            labelWidth="auto"
            label="用于项目"
            value={<ProjectLinks projects={usedIn} tab="assets" none="还没用在项目里" />}
          />
        </GroupList>
        <section className="gsec">
          <div className="gh">标签</div>
          <TagEditor tags={image.tags} onChange={(tags) => void update({ tags })} />
        </section>
      </div>
      <ConfirmSheet
        open={confirming}
        title={`把「${image.name}」移到废纸篓？`}
        message={
          samples.length > 0
            ? `可以在访达的废纸篓里找回。风格${samples.map((s) => `「${s.name || '未命名风格'}」`).join('')}会改为不显示样张。`
            : '可以在访达的废纸篓里找回。'
        }
        confirmLabel="移到废纸篓"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </Sheet>
  )
}
