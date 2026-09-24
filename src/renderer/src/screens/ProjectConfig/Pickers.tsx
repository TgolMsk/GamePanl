// 配置页的三个选择 sheet：封面（本项目资料）、美术风格（全局库风格）、常用提示词（全局库提示词）。
import { useState } from 'react'
import { imageUrl } from '@shared/api'
import type { ID, ProjectAsset, Prompt, Style } from '@shared/types'
import { formatSize } from '@renderer/app/format'
import { go } from '@renderer/app/nav'
import { Button, EmptyState, Icon, SearchField, Sheet, Tag, cx } from '@renderer/ui'
import { StyleVisual, Thumb } from './parts'

function CurrentBadge(): React.JSX.Element {
  return (
    <span className="done">
      <Icon name="check" size={11} strokeWidth={2.4} />
      当前
    </span>
  )
}

export interface CoverPickerProps {
  projectId: ID
  projectName: string
  assets: ProjectAsset[]
  current: ID | null
  onPick: (asset: ProjectAsset) => void
  onClose: () => void
}

/** 从本项目资料里选一张做封面，点选即更换 */
export function CoverPicker({
  projectId,
  projectName,
  assets,
  current,
  onPick,
  onClose
}: CoverPickerProps): React.JSX.Element {
  const empty = assets.length === 0
  return (
    <Sheet
      open
      onClose={onClose}
      title="选择封面"
      subtitle={`从「${projectName}」的资料里选一张`}
      width={760}
      height={empty ? undefined : 580}
      footer={
        <>
          {!empty && <span className="lbl">点选即更换</span>}
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
        </>
      }
    >
      {empty ? (
        <EmptyState icon="photo" title="资料里还没有图片" hint="先在「资料」里添加图片，再回来选封面。">
          <Button
            onClick={() => {
              onClose()
              go({ view: 'project', projectId, tab: 'assets' })
            }}
          >
            去资料
          </Button>
        </EmptyState>
      ) : (
        <div className="cf-grid cf-g5">
          {assets.map((a) => {
            const on = a.id === current
            return (
              <button
                key={a.id}
                type="button"
                className={cx('cf-pick', on && 'on')}
                aria-pressed={on}
                aria-label={`用「${a.name}」做封面`}
                onClick={() => onPick(a)}
              >
                <span className="cf-frame cf-sq">
                  <Thumb src={imageUrl({ scope: 'project', projectId, id: a.id }, 320)} alt={a.name} />
                  {on && <CurrentBadge />}
                </span>
                <span className="cap">{a.name}</span>
                <span className="meta">{formatSize(a.width, a.height)}</span>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

export interface StylePickerProps {
  styles: Style[]
  current: ID | null
  onPick: (style: Style) => void
  onClose: () => void
}

/** 从全局库风格里选一个，点选即更换 */
export function StylePicker({ styles, current, onPick, onClose }: StylePickerProps): React.JSX.Element {
  const empty = styles.length === 0
  return (
    <Sheet
      open
      onClose={onClose}
      title={current ? '更换美术风格' : '选择美术风格'}
      subtitle={`全局库 · ${styles.length} 种风格`}
      width={760}
      footer={
        <>
          {!empty && <span className="lbl">点选即更换，色板和提示词随之更新</span>}
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
        </>
      }
    >
      {empty ? (
        <EmptyState icon="palette" title="全局库里还没有风格" hint="先在全局库的「风格」里添加，再回来选。">
          <Button
            onClick={() => {
              onClose()
              go({ view: 'library', tab: 'styles' })
            }}
          >
            去全局库
          </Button>
        </EmptyState>
      ) : (
        <div className="cf-grid cf-g3">
          {styles.map((s) => {
            const on = s.id === current
            return (
              <button
                key={s.id}
                type="button"
                className={cx('cf-pick', on && 'on')}
                aria-pressed={on}
                onClick={() => onPick(s)}
              >
                <span className="cf-frame cf-st">
                  <StyleVisual style={s} thumb={480} strip />
                  {on && <CurrentBadge />}
                </span>
                <span className="cap cf-pname">{s.name}</span>
                <span className="meta">{s.desc}</span>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

export interface PromptPickerProps {
  prompts: Prompt[]
  /** 已经在常用里的 */
  pinned: ID[]
  onAdd: (ids: ID[]) => void
  onClose: () => void
}

function matches(p: Prompt, needle: string): boolean {
  return [p.title, p.body, p.category].some((s) => s.toLowerCase().includes(needle))
}

/** 从全局库提示词里多选，加进常用 */
export function PromptPicker({ prompts, pinned, onAdd, onClose }: PromptPickerProps): React.JSX.Element {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<ID[]>([])
  const empty = prompts.length === 0
  const needle = q.trim().toLowerCase()
  const shown = needle ? prompts.filter((p) => matches(p, needle)) : prompts
  const toggle = (id: ID): void => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  // 按全局库里的顺序加
  const add = (): void => onAdd(prompts.filter((p) => sel.includes(p.id)).map((p) => p.id))

  return (
    <Sheet
      open
      onClose={onClose}
      title="添加常用提示词"
      subtitle={`全局库 · ${prompts.length} 条提示词`}
      width={640}
      height={empty ? undefined : 580}
      accessory={
        empty ? undefined : <SearchField value={q} onChange={setQ} placeholder="搜索提示词" width={200} autoFocus />
      }
      footer={
        <>
          {!empty && <span className="lbl">{sel.length > 0 ? `已选 ${sel.length} 条` : '可以多选'}</span>}
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
          {!empty && (
            <Button variant="primary" disabled={sel.length === 0} onClick={add}>
              添加
            </Button>
          )}
        </>
      }
    >
      {empty ? (
        <EmptyState icon="text" title="全局库里还没有提示词" hint="先在全局库的「提示词」里添加，再回来选。">
          <Button
            onClick={() => {
              onClose()
              go({ view: 'library', tab: 'prompts' })
            }}
          >
            去全局库
          </Button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <div className="cf-none">没有找到「{q.trim()}」</div>
      ) : (
        <div className="cf-plist">
          {shown.map((p) => {
            const isPinned = pinned.includes(p.id)
            const on = sel.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                className={cx('cf-prk', on && 'on')}
                disabled={isPinned}
                aria-pressed={isPinned ? undefined : on}
                onClick={() => toggle(p.id)}
              >
                <span className="ck">
                  <Icon name={on || isPinned ? 'checkmark.square' : 'square'} size={18} />
                </span>
                <span className="cf-pcol">
                  <span className="cf-ptitle">
                    <span className="t">{p.title}</span>
                    <Tag size="xs">{p.category}</Tag>
                    <span className="cf-uses">{isPinned ? '已在常用里' : `用过 ${p.uses} 次`}</span>
                  </span>
                  <span className="cf-pbody cf-clamp">{p.body}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
