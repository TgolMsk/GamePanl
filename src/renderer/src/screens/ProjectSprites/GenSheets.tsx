// 软件里生成：设置（模型、分辨率、时长、版本数、并发、自动收件）和任务列表。
import { useEffect, useState } from 'react'
import { showError } from '@renderer/screens/Library/shared'
import { Button, Segmented, Sheet, Stepper, cx } from '@renderer/ui'
import { SPRITE_VIDEO_MODELS, SPRITE_VIDEO_RESOLUTIONS, type SpriteJob, type SpriteJobState, type SpriteVideoModel, type SpriteVideoResolution } from '@shared/spriteGen'
import type { SpriteOwner } from '@shared/sprites'
import { costText, isActive, refreshTools, saveGenSettings, useGen } from './gen'

export function GenSettingsSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useGen((s) => s.settings)
  const tools = useGen((s) => s.tools)
  const [checking, setChecking] = useState(false)
  const set = (patch: Parameters<typeof saveGenSettings>[0]): void => void saveGenSettings(patch).catch((err) => showError('没能保存设置', err))
  const recheck = async (): Promise<void> => {
    setChecking(true)
    await refreshTools()
    setChecking(false)
  }
  const price = settings ? SPRITE_VIDEO_MODELS[settings.videoModel].price : null
  return (
    <Sheet open title="在软件里生成" subtitle="视频用百炼万相（按秒计费），人物图用本机的 codex（ChatGPT 订阅自带的生图）" width={600} bodyClassName="sp-gen-settings" onClose={onClose} footer={<><span className="grow" /><Button variant="primary" onClick={onClose}>完成</Button></>}>
      <section className="sp-gen-tools" aria-label="本机工具">
        <ToolRow name="百炼命令行 bl" path={tools?.bl ?? null} install="npm i -g bailian-cli，然后 bl auth login --console" />
        <ToolRow name="codex" path={tools?.codex ?? null} install="npm i -g @openai/codex，然后 codex login" />
        <Button size="sm" variant="plain" disabled={checking} onClick={() => void recheck()}>{checking ? '检测中…' : '重新检测'}</Button>
      </section>
      {settings && price ? (
        <>
          <div className="sp-text-field"><span>视频模型</span>
            <Segmented<SpriteVideoModel> value={settings.videoModel} ariaLabel="视频模型" options={(Object.keys(SPRITE_VIDEO_MODELS) as SpriteVideoModel[]).map((m) => ({ value: m, label: SPRITE_VIDEO_MODELS[m].label }))} onChange={(videoModel) => set({ videoModel })} />
            {settings.videoModel === 'wan3.0-video-prime' && <span className="sp-note">高速版走百炼 Prime 专属接入点，要先设好工作空间：在终端运行 bl config set --key workspace_id --value 工作空间 ID（百炼控制台里能查到）</span>}
          </div>
          <div className="sp-text-field"><span>分辨率（拆成像素帧用 480P 就够）</span>
            <Segmented<SpriteVideoResolution> value={settings.resolution} ariaLabel="分辨率" options={SPRITE_VIDEO_RESOLUTIONS.map((r) => ({ value: r, label: `${r} · ${price[r]} 元/秒` }))} onChange={(resolution) => set({ resolution })} />
          </div>
          <div className="sp-gen-steppers">
            <div className="sp-text-field"><span>时长</span><span className="sp-gen-stepper"><Stepper value={settings.duration} min={2} max={10} label="时长" onChange={(duration) => set({ duration })} />{settings.duration} 秒</span></div>
            <div className="sp-text-field"><span>每个动作生成</span><span className="sp-gen-stepper"><Stepper value={settings.takes} min={1} max={4} label="版本数" onChange={(takes) => set({ takes })} />{settings.takes} 个版本</span></div>
            <div className="sp-text-field"><span>同时生成</span><span className="sp-gen-stepper"><Stepper value={settings.concurrency} min={1} max={4} label="同时生成数" onChange={(concurrency) => set({ concurrency })} />{settings.concurrency} 个</span></div>
          </div>
          <p className="sp-note">一个版本{costText(settings, 1)}（{price[settings.resolution]} 元/秒 × {settings.duration} 秒，按百炼文档价估算）。几个版本都导进来后按和定妆照的相似度标出「最像」。已经交给百炼的任务，取消或关掉软件后仍会计费。</p>
          <label className="sp-gen-check">
            <input type="checkbox" checked={settings.inbox} onChange={(e) => set({ inbox: e.target.checked })} />
            <span>自动收件：复制提示词后两小时内，「下载」里新出现的视频按动作标签放进对应动作，图片放进人物素材（第一次会问能不能读「下载」文件夹）</span>
          </label>
        </>
      ) : (
        <p className="sp-note">读取设置中…</p>
      )}
    </Sheet>
  )
}

function ToolRow({ name, path, install }: { name: string; path: string | null; install: string }): React.JSX.Element {
  return (
    <div className="sp-gen-tool">
      <span className={cx('dot', path && 'ok')} aria-hidden />
      <span className="nm">{name}</span>
      <span className="sp-note" title={path ?? undefined}>{path ? `已找到 · ${path}` : `没找到：在终端运行 ${install}`}</span>
    </div>
  )
}

const STATE_TEXT: Record<SpriteJobState, string> = { queued: '排队中', running: '生成中', done: '完成', failed: '失败', canceled: '已取消' }

function elapsed(job: SpriteJob, now: number): string {
  if (!job.startedAt) return ''
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now
  const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000))
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

export function JobsSheet({ owner, onClose, onOpen }: { owner: SpriteOwner; onClose: () => void; onOpen: (job: SpriteJob) => void }): React.JSX.Element {
  const jobs = useGen((s) => s.jobs)
  const [now, setNow] = useState(Date.now())
  const running = jobs.some((j) => j.state === 'running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  const list = [...jobs].reverse()
  const spent = jobs.filter((j) => j.state === 'done' || j.state === 'running' || (j.state === 'canceled' && j.startedAt)).reduce((n, j) => n + j.cost, 0)
  const ended = jobs.some((j) => !isActive(j))
  const cancel = (id: string): void => void window.gp.sprites.cancelJob(id).catch((err) => showError('没能取消', err))
  return (
    <Sheet
      open
      title="生成任务"
      subtitle="关掉软件后任务会清空；视频生成好会自动放进对应动作，人物图放进人物素材"
      width={640}
      bodyClassName="sp-jobs"
      onClose={onClose}
      footer={<>
        <span className="sp-note">本次预估花费 ¥{spent.toFixed(1)}</span>
        <span className="grow" />
        <Button disabled={!ended} onClick={() => void window.gp.sprites.clearJobs().catch((err) => showError('没能清除', err))}>清掉已结束的</Button>
        <Button variant="primary" onClick={onClose}>完成</Button>
      </>}
    >
      {list.length === 0 ? <p className="sp-note">还没有任务。在待生成的动作里点「在软件里生成」，或在人物素材里让 codex 画设定图。</p> : (
        <ul className="sp-job-list">
          {list.map((j) => (
            <li key={j.id} className={cx('sp-job', `is-${j.state}`)}>
              <div className="sp-job-main">
                <span className="nm">{j.characterName} · {j.label}</span>
                <span className="sp-note">{STATE_TEXT[j.state]}{j.startedAt ? ` · ${elapsed(j, now)}` : ''}{j.cost ? ` · ¥${j.cost.toFixed(1)}` : ''}{j.message && j.state !== 'done' ? ` · ${j.message}` : ''}</span>
              </div>
              {isActive(j) && <Button size="sm" onClick={() => cancel(j.id)}>{j.state === 'running' && j.kind === 'video' ? '取消（仍会计费）' : '取消'}</Button>}
              {j.state === 'done' && j.owner === owner && <Button size="sm" variant="plain" onClick={() => onOpen(j)}>查看</Button>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
