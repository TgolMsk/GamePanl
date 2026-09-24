// 示例内容：全局库图片、提示词、风格和示例项目「雾港」（resources/sample）。
// 可以重复导入：图片按内容去重，提示词按标题 + 正文、风格按名称、项目按名称判断是否已经有了。
import { app } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import type { AssetCategory, ID, ImageCategory, NoteBlock, NoteCategory, Project, PromptCategory, ScalingMode, Size2 } from '@shared/types'
import { candidateFromFile } from './images'
import type { Candidate } from './images'
import { addLibraryImages, createPrompt, createStyle, listPrompts, listStyles } from './library'
import { addProjectAssets, createNote, createProject, listProjects } from './projects'
import { paths, updateJson, withLock } from './storage'
import { fail } from './validate'

interface SampleImage {
  key: string
  file: string
  name: string
  category: ImageCategory
  tags: string[]
  addedAt: string
}

interface SamplePrompt {
  key: string
  title: string
  body: string
  category: PromptCategory
  uses: number
  createdAt: string
}

interface SampleStyle {
  key: string
  name: string
  desc: string
  palette: string[]
  prompt: string
  /** 样张：全局库图片的 key */
  sample: string | null
  createdAt: string
}

interface SampleAsset {
  key: string
  file: string
  name: string
  category: AssetCategory
  tags: string[]
  addedAt: string
}

type SampleBlock =
  | { type: 'p'; text: string }
  | { type: 'todo'; text: string; checked: boolean }
  /** asset：本项目资料的 key */
  | { type: 'image'; asset: string }

interface SampleNote {
  title: string
  category: NoteCategory
  done: boolean
  updatedAt: string
  blocks: SampleBlock[]
}

interface SampleProject {
  name: string
  pitch: string
  genres: string[]
  platforms: string[]
  targetPlayers: string
  sessionLength: string
  /** 风格的 key */
  style: string
  resolution: Size2
  scaling: ScalingMode
  sizes: Project['sizes']
  /** 封面：资料的 key */
  cover: string
  /** 常用提示词的 key */
  pinnedPrompts: string[]
  createdAt: string
  updatedAt: string
  assets: SampleAsset[]
  notes: SampleNote[]
}

interface SampleData {
  /** 示例数据里的"今天"；导入时所有时间整体平移到以导入当天为"今天" */
  baseDate: string
  library: { images: SampleImage[]; prompts: SamplePrompt[]; styles: SampleStyle[] }
  project: SampleProject
}

/** 内置示例目录：打包后在 Resources/sample，开发时在项目的 resources/sample
 *  （`electron .` 时应用目录是项目根目录；`electron out/main/index.js` 时要从构建产物往上找） */
function sampleDir(): string {
  const candidates = [
    join(process.resourcesPath, 'sample'),
    join(app.getAppPath(), 'resources', 'sample'),
    join(__dirname, '..', '..', 'resources', 'sample')
  ]
  const dir = candidates.find((d) => existsSync(join(d, 'sample.json')))
  if (!dir) fail('找不到内置的示例内容')
  return dir
}

/** 本地时间 "YYYY-MM-DD HH:mm" */
function parseLocal(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(s)
  if (!m) fail(`示例数据里的时间格式不对：${s}`)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
}

/** 把示例里的时间平移到"今天"，并保证都不晚于现在 */
function makeClock(data: SampleData): (s: string) => string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayShift = Math.round((today.getTime() - parseLocal(data.baseDate).getTime()) / 86_400_000)
  const shifted = (s: string): number => {
    const d = parseLocal(s)
    d.setDate(d.getDate() + dayShift)
    return d.getTime()
  }
  const p = data.project
  const all = [
    ...data.library.images.map((x) => x.addedAt),
    ...data.library.prompts.map((x) => x.createdAt),
    ...data.library.styles.map((x) => x.createdAt),
    p.createdAt,
    p.updatedAt,
    ...p.assets.map((x) => x.addedAt),
    ...p.notes.map((x) => x.updatedAt)
  ]
  const latest = Math.max(...all.map(shifted))
  const overflow = Math.max(0, latest - Date.now() + 60_000)
  return (s) => new Date(shifted(s) - overflow).toISOString()
}

async function loadCandidates(dir: string, files: string[]): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const f of files) {
    const c = await candidateFromFile(join(dir, 'images', f))
    if (!c) fail(`示例图片读取失败：${f}`)
    out.push(c)
  }
  return out
}

export interface SampleResult {
  /** 这次新建的示例项目 id；已经有了时为 null */
  projectId: ID | null
}

export function importSample(): Promise<SampleResult> {
  return withLock('sample-import', async () => {
    const dir = sampleDir()
    const data = JSON.parse(await fs.readFile(join(dir, 'sample.json'), 'utf8')) as SampleData
    const clock = makeClock(data)

    // 全局库图片（内容相同的不重复加入）
    const libSample = data.library.images
    const libCands = await loadCandidates(
      dir,
      libSample.map((x) => x.file)
    )
    const libResults = await addLibraryImages(libCands, (_c, i) => ({
      name: libSample[i].name,
      category: libSample[i].category,
      tags: libSample[i].tags,
      addedAt: clock(libSample[i].addedAt)
    }))
    const libId = new Map(libSample.map((x, i) => [x.key, libResults[i].item.id]))

    // 提示词、风格：倒着加，新加的排在最前，最后顺序和示例一致
    const promptId = new Map<string, ID>()
    const prompts = await listPrompts()
    for (const sp of [...data.library.prompts].reverse()) {
      const hit = prompts.find((p) => p.title === sp.title && p.body === sp.body)
      const p =
        hit ?? (await createPrompt({ title: sp.title, body: sp.body, category: sp.category }, sp.uses, clock(sp.createdAt)))
      promptId.set(sp.key, p.id)
    }
    const styleId = new Map<string, ID>()
    const styles = await listStyles()
    for (const ss of [...data.library.styles].reverse()) {
      const hit = styles.find((s) => s.name === ss.name)
      const s =
        hit ??
        (await createStyle(
          {
            name: ss.name,
            desc: ss.desc,
            palette: ss.palette,
            prompt: ss.prompt,
            sampleImageId: ss.sample ? (libId.get(ss.sample) ?? null) : null
          },
          clock(ss.createdAt)
        ))
      styleId.set(ss.key, s.id)
    }

    // 示例项目
    const sp = data.project
    if ((await listProjects()).some((p) => p.name === sp.name)) return { projectId: null }
    const project = await createProject(sp.name, clock(sp.createdAt))
    const pid = project.id
    const assetCands = await loadCandidates(
      dir,
      sp.assets.map((a) => a.file)
    )
    const assetResults = await addProjectAssets(
      pid,
      assetCands,
      (_c, i) => ({
        name: sp.assets[i].name,
        category: sp.assets[i].category,
        tags: sp.assets[i].tags,
        addedAt: clock(sp.assets[i].addedAt)
      }),
      false
    )
    const assetId = new Map(sp.assets.map((a, i) => [a.key, assetResults[i].item.id]))

    for (const n of sp.notes) {
      const blocks = n.blocks.map((b, i): NoteBlock => {
        const id = `b${i + 1}`
        if (b.type !== 'image') return { id, ...b }
        const asset = assetId.get(b.asset)
        if (!asset) fail(`示例笔记引用了不存在的资料：${b.asset}`)
        return { id, type: 'image', image: { scope: 'project', projectId: pid, id: asset } }
      })
      const at = clock(n.updatedAt)
      await createNote(pid, { title: n.title, category: n.category, blocks }, {
        createdAt: at,
        updatedAt: at,
        done: n.done
      })
    }

    await updateJson<Project | null, void>(paths.projectFile(pid), null, (p) => {
      if (!p) fail('示例项目创建失败')
      Object.assign(p, {
        pitch: sp.pitch,
        genres: sp.genres,
        platforms: sp.platforms,
        targetPlayers: sp.targetPlayers,
        sessionLength: sp.sessionLength,
        styleId: styleId.get(sp.style) ?? null,
        resolution: sp.resolution,
        scaling: sp.scaling,
        sizes: sp.sizes,
        coverAssetId: assetId.get(sp.cover) ?? null,
        pinnedPromptIds: sp.pinnedPrompts.map((k) => promptId.get(k)).filter((x): x is ID => !!x),
        updatedAt: clock(sp.updatedAt)
      })
    })
    return { projectId: pid }
  })
}
