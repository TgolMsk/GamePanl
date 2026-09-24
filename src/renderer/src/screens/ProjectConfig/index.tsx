import './config.css'
import { useState } from 'react'
import type { ID, ProjectAsset, Prompt, Style } from '@shared/types'
import { copyText, useCopiedFlag } from '@renderer/app/clipboard'
import { useAssets, usePrompts, useStyles } from '@renderer/app/data'
import { hud } from '@renderer/app/hud'
import { go } from '@renderer/app/nav'
import { Button, ConfirmSheet, EmptyState, Icon, Toolbar } from '@renderer/ui'
import { buildOnePager } from './onePager'
import { CoverPicker, PromptPicker, StylePicker } from './Pickers'
import { BasicSection, DangerZone, PinnedPrompts, ProjectHeader, SizeSection, StyleSection } from './Sections'
import { errorReason, useProjectDraft } from './useProjectDraft'

type SheetKind = 'cover' | 'style' | 'prompts' | 'delete'

function CopyLabel({ done, label }: { done: boolean; label: string }): React.JSX.Element {
  return done ? (
    <>
      <Icon name="check" size={14} className="cf-acc" />
      已复制
    </>
  ) : (
    <>
      <Icon name="copy" size={14} />
      {label}
    </>
  )
}

/** 项目配置：类型、平台、美术风格、分辨率和尺寸、目标玩家、单局时长 */
export default function ProjectConfigScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const { project, saved, error, change, discard } = useProjectDraft(projectId)
  const styles = useStyles()
  const prompts = usePrompts()
  const assets = useAssets(projectId)
  const [copiedId, markCopied] = useCopiedFlag()
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  const closeSheet = (): void => setSheet(null)

  const style = project?.styleId ? styles.data.find((s) => s.id === project.styleId) : undefined
  const coverAsset = project?.coverAssetId ? assets.data.find((a) => a.id === project.coverAssetId) : undefined
  const name = project ? project.name.trim() || '未命名项目' : ''
  const onePager = project ? buildOnePager(project, style) : ''

  const copyOnePager = async (flag: string): Promise<void> => {
    if (await copyText(onePager, '项目一页纸')) markCopied(flag)
  }
  const copyStylePrompt = async (s: Style): Promise<void> => {
    if (await copyText(s.prompt, '风格提示词')) markCopied('style-prompt')
  }
  const copyPrompt = async (p: Prompt): Promise<void> => {
    if (!(await copyText(p.body, '提示词'))) return
    markCopied(p.id)
    window.gp.library.markPromptUsed(p.id).catch(() => undefined)
  }

  const pickCover = (a: ProjectAsset): void => {
    closeSheet()
    if (a.id === project?.coverAssetId) return
    change({ coverAssetId: a.id })
    hud.show('已更换封面', { ok: true })
  }
  const pickStyle = (s: Style): void => {
    closeSheet()
    if (s.id === project?.styleId) return
    change({ styleId: s.id })
    hud.show(`已更换为「${s.name}」`, { ok: true })
  }
  const addPrompts = (ids: ID[]): void => {
    closeSheet()
    if (!project || ids.length === 0) return
    change({ pinnedPromptIds: [...project.pinnedPromptIds, ...ids.filter((id) => !project.pinnedPromptIds.includes(id))] })
    hud.show(`已添加 ${ids.length} 条常用提示词`, { ok: true })
  }
  const removeProject = async (): Promise<void> => {
    await discard()
    try {
      await window.gp.projects.remove(projectId)
    } catch (err) {
      closeSheet()
      hud.show(`没能删除：${errorReason(err)}`)
      return
    }
    go({ view: 'library', tab: 'images' })
    hud.show(`已把「${name}」移到废纸篓`, { ok: true })
  }

  return (
    <div className="screen">
      <Toolbar title={name} subtitle="配置">
        {project && (
          <Button onClick={() => void copyOnePager('onepager-top')}>
            <CopyLabel done={copiedId === 'onepager-top'} label="复制项目一页纸" />
          </Button>
        )}
      </Toolbar>
      <div className="screen-body">
        <main className="screen-main tint">
          {project ? (
            <div className="cf-wrap">
              <ProjectHeader
                project={project}
                change={change}
                coverAsset={coverAsset}
                savedName={saved?.name ?? ''}
                onPickCover={() => setSheet('cover')}
              />
              <BasicSection project={project} change={change} />
              <StyleSection
                style={style}
                copiedId={copiedId}
                onPick={() => setSheet('style')}
                onCopyPrompt={(s) => void copyStylePrompt(s)}
              />
              <SizeSection project={project} change={change} />
              <DangerZone onDelete={() => setSheet('delete')} />
            </div>
          ) : (
            error !== null && <EmptyState icon="info" title="读不到这个项目" hint={error} />
          )}
        </main>
        <aside className="inspector cf-insp" aria-label="项目一页纸和常用提示词">
          {project && (
            <>
              <div className="gh">项目一页纸</div>
              <div className="group cf-onep">{onePager}</div>
              <Button className="cf-full" onClick={() => void copyOnePager('onepager')}>
                <CopyLabel done={copiedId === 'onepager'} label="复制" />
              </Button>
              <PinnedPrompts
                project={project}
                change={change}
                prompts={prompts.data}
                copiedId={copiedId}
                onCopy={(p) => void copyPrompt(p)}
                onAdd={() => setSheet('prompts')}
              />
            </>
          )}
        </aside>
      </div>

      {project && sheet === 'cover' && (
        <CoverPicker
          projectId={projectId}
          projectName={name}
          assets={assets.data}
          current={project.coverAssetId}
          onPick={pickCover}
          onClose={closeSheet}
        />
      )}
      {project && sheet === 'style' && (
        <StylePicker styles={styles.data} current={project.styleId} onPick={pickStyle} onClose={closeSheet} />
      )}
      {project && sheet === 'prompts' && (
        <PromptPicker
          prompts={prompts.data}
          pinned={project.pinnedPromptIds}
          onAdd={addPrompts}
          onClose={closeSheet}
        />
      )}
      <ConfirmSheet
        open={sheet === 'delete'}
        title={`把「${name}」移到废纸篓？`}
        message="这个项目的配置、构思和资料会一起移走，可以在访达的废纸篓里找回。"
        confirmLabel="移到废纸篓"
        destructive
        onCancel={closeSheet}
        onConfirm={removeProject}
      />
    </div>
  )
}
