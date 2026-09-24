import type { ReactNode } from 'react'
import { imageUrl } from '@shared/api'
import type { ImageFormat, ImageRef, ISODate } from '@shared/types'
import { copyImage } from '../app/clipboard'
import { formatBytes, formatDate, formatSize } from '../app/format'
import { hud } from '../app/hud'
import { Button } from './Button'
import { GroupList, GroupRow } from './GroupList'
import { Sheet } from './Sheet'
import { Tag, TagEditor } from './Tag'

/** 预览需要的图片信息；LibImage / ProjectAsset 展开后加上 ref 即可：{ ...img, ref } */
export interface QuickLookImage {
  ref: ImageRef
  name: string
  category: string
  width: number
  height: number
  format: ImageFormat
  bytes: number
  addedAt: ISODate
  tags: string[]
}

export interface QuickLookRow {
  label: string
  value: ReactNode
}

export interface QuickLookProps {
  /** 要预览的图片；null 时关闭 */
  image: QuickLookImage | null
  onClose: () => void
  /** 给了就可以编辑标签，否则只显示 */
  onTagsChange?: (tags: string[]) => void
  /** 追加在「添加时间」后面的信息行，如 { label: '用于项目', value: … } */
  extraRows?: ReadonlyArray<QuickLookRow>
}

// 图片区约 600 × 448（sheet 940×600 减去标题栏、按钮栏和边距），留一点余量
const STAGE_W = 600
const STAGE_H = 440

function fitSize(w: number, h: number): { width: number; height: number; scale: number } | null {
  if (!(w > 0 && h > 0)) return null
  const scale = Math.min(STAGE_W / w, STAGE_H / h)
  return { width: Math.round(w * scale), height: Math.round(h * scale), scale }
}

/** Quick Look 式大图预览：大图 + 信息 + 标签，底部 [在访达中显示] [关闭] [复制] */
export function QuickLook({ image, onClose, onTagsChange, extraRows }: QuickLookProps): React.JSX.Element {
  const fit = image ? fitSize(image.width, image.height) : null

  const reveal = async (): Promise<void> => {
    if (!image) return
    try {
      await window.gp.shell.revealImage(image.ref)
    } catch {
      hud.show('找不到原文件')
    }
  }

  return (
    <Sheet
      open={image !== null}
      onClose={onClose}
      title={image?.name || '未命名'}
      subtitle={image ? [image.category, formatSize(image.width, image.height), image.format].join(' · ') : null}
      width={940}
      height={600}
      bodyClassName="ql-body"
      footer={
        image && (
          <>
            <Button icon="folder" onClick={reveal}>
              在访达中显示
            </Button>
            <span className="grow" />
            <Button onClick={onClose}>关闭</Button>
            <Button variant="primary" icon="copy" onClick={() => void copyImage(image.ref, image.name)}>
              复制
            </Button>
          </>
        )
      }
    >
      {image && (
        <>
          <div className="ql-stage">
            <img
              src={imageUrl(image.ref)}
              alt={image.name}
              draggable={false}
              className={fit && fit.scale >= 2 ? 'checker px' : 'checker'}
              style={fit ? { width: fit.width, height: fit.height } : undefined}
            />
          </div>
          <div className="ql-info">
            <GroupList>
              <GroupRow labelWidth="auto" label="分类" value={image.category} />
              <GroupRow labelWidth="auto" label="尺寸" value={formatSize(image.width, image.height)} />
              <GroupRow labelWidth="auto" label="格式" value={image.format} />
              <GroupRow labelWidth="auto" label="大小" value={formatBytes(image.bytes)} />
              <GroupRow labelWidth="auto" label="添加时间" value={formatDate(image.addedAt, { time: true })} />
              {extraRows?.map((r) => (
                <GroupRow key={r.label} labelWidth="auto" label={r.label} value={r.value} />
              ))}
            </GroupList>
            <section className="gsec">
              <div className="gh">标签</div>
              {onTagsChange ? (
                <TagEditor tags={image.tags} onChange={onTagsChange} />
              ) : image.tags.length > 0 ? (
                <div className="tags" style={{ padding: '0 4px' }}>
                  {image.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              ) : (
                <div className="lbl none">没有标签</div>
              )}
            </section>
          </div>
        </>
      )}
    </Sheet>
  )
}
