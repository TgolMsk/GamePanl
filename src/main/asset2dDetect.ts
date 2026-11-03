// 2D 资产识别：只读传入的文件表、JSON 和图片尺寸，不依赖文件系统或 Electron。
import { posix } from 'path'
import { ASSET2D_CATEGORIES } from '@shared/types'
import type { Asset2DAnimation, Asset2DCategory, Asset2DFrame, LibAsset2D } from '@shared/types'

export const ASSET2D_EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg', 'gif']
const PREVIEW_NAMES = ['preview.png', 'preview.webp', 'thumbnail.png', 'thumb.png']
const LOOP_NAME = /([_\-\s.]loop|[_\-\s.]cycle)$|^(idle|walk|run|fly|swim|breath)/i
const CATEGORY_WORDS: Array<[Asset2DCategory, RegExp]> = [
  ['特效', /effect|\bfx\b|vfx|特效/i],
  ['瓦片', /tile|tileset|瓦片/i],
  ['UI', /\bui\b|button|icon|界面/i],
  ['背景', /\bbg\b|background|背景/i],
  ['道具', /item|prop|weapon|道具/i],
  ['怪物', /monster|enemy|boss|怪/i],
  ['角色', /character|hero|player|npc|角色/i]
]

const str = (v: unknown): string => typeof v === 'string' ? v.trim() : ''
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

export function isAsset2DImage(file: string): boolean {
  return ASSET2D_EXTENSIONS.includes(posix.extname(file).slice(1).toLowerCase())
}

/** 清单中的相对路径只能指向资产目录里面；同时拒绝 Windows 的绝对路径。 */
export function asset2dRelativePath(file: string, base = ''): string | null {
  if (!file || file.includes('\0') || file.includes('\\') || /^(\/|[a-z]:)/i.test(file)) return null
  const normalized = posix.normalize(posix.join(base, file))
  return normalized === '.' || normalized === '..' || normalized.startsWith('../') ? null : normalized
}

export interface Asset2DDetectionInput {
  files: string[]
  name: string
  readJson: (file: string) => unknown | Promise<unknown>
  readImageSize: (file: string) => [number, number] | null | Promise<[number, number] | null>
}

export type DetectedAsset2D = Pick<LibAsset2D, 'name' | 'category' | 'tags' | 'preview' | 'frameSize' | 'animations' | 'imageCount' | 'formats' | 'hasAssetJson' | 'source' | 'references'> & {
  idHint: string
}

function guessCategory(words: string[]): Asset2DCategory {
  if ((ASSET2D_CATEGORIES as readonly string[]).includes(words[0])) return words[0] as Asset2DCategory
  const text = words.join(' ').replace(/[_-]/g, ' ')
  return CATEGORY_WORDS.find(([, re]) => re.test(text))?.[0] ?? '其他'
}

function frameRect(value: unknown): Asset2DFrame['rect'] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isSafeInteger)) return null
  return value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0 ? value as [number, number, number, number] : null
}

/** asset.json 优先；没有时从图集、数字帧名识别动作，格式信息另外汇总。 */
export async function detectAsset2D(input: Asset2DDetectionInput): Promise<DetectedAsset2D> {
  const files = [...new Set(input.files.map((file) => asset2dRelativePath(file)).filter((file): file is string => file !== null))].sort()
  const fileSet = new Set(files)
  const images = files.filter(isAsset2DImage)
  const imageSet = new Set(images)
  const json = async (file: string): Promise<Record<string, unknown> | null> => {
    try {
      const value = await input.readJson(file)
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  const sizes = new Map<string, Promise<[number, number] | null>>()
  const size = (file: string): Promise<[number, number] | null> => {
    if (!sizes.has(file)) sizes.set(file, Promise.resolve().then(() => input.readImageSize(file)).then((s) =>
      s && s.length === 2 && s.every((n) => Number.isSafeInteger(n) && n > 0) ? s : null).catch(() => null))
    return sizes.get(file)!
  }
  const imagePath = (value: unknown, base = ''): string | null => {
    const rel = asset2dRelativePath(str(value), base)
    return rel && imageSet.has(rel) ? rel : null
  }
  const validFrame = async (value: unknown): Promise<Asset2DFrame | null> => {
    const raw = obj(value)
    const file = imagePath(typeof value === 'string' ? value : raw['file'])
    if (!file) return null
    if (typeof value === 'string' || raw['rect'] == null) return { file, rect: null }
    const rect = frameRect(raw['rect'])
    if (!rect) return null
    const dimensions = await size(file)
    if (dimensions && (rect[0] + rect[2] > dimensions[0] || rect[1] + rect[3] > dimensions[1])) return null
    return { file, rect }
  }
  const asset = fileSet.has('asset.json') ? await json('asset.json') : null
  const tags = Array.isArray(asset?.['tags']) ? [...new Set(asset['tags'].map(str).filter(Boolean))].slice(0, 30).map((tag) => tag.slice(0, 60)) : []
  const name = (str(asset?.['name']) || input.name || '未命名资产').slice(0, 200)
  const animations: Asset2DAnimation[] = []
  const formats = new Set<string>()
  if (asset && Array.isArray(asset['animations'])) {
    for (const value of asset['animations']) {
      const raw = obj(value)
      const name = str(raw['name'])
      if (!name || !Array.isArray(raw['frames'])) continue
      const frames = (await Promise.all(raw['frames'].map(validFrame))).filter((frame): frame is Asset2DFrame => frame !== null)
      const group = str(raw['group']).slice(0, 40)
      if (frames.length) animations.push({ name, fps: positive(raw['fps']) ? raw['fps'] : 12, loop: typeof raw['loop'] === 'boolean' ? raw['loop'] : LOOP_NAME.test(name), frames, ...(group && { group }) })
    }
  }

  const atlasImages = new Set<string>()
  for (const file of files.filter((file) => file !== 'asset.json' && posix.extname(file).toLowerCase() === '.json')) {
    const atlas = await json(file)
    const meta = obj(atlas?.['meta'])
    const image = imagePath(meta['image'], posix.dirname(file))
    const rawFrames = atlas?.['frames']
    if (!image || !rawFrames || typeof rawFrames !== 'object') continue
    const values = Array.isArray(rawFrames) ? rawFrames : Object.values(rawFrames)
    const frames = await Promise.all(values.map(async (value) => {
      const raw = obj(value)
      const rect = obj(raw['frame'])
      const frame = await validFrame({ file: image, rect: [rect['x'], rect['y'], rect['w'], rect['h']] })
      return frame ? { frame, duration: positive(raw['duration']) ? raw['duration'] : null } : null
    }))
    if (!frames.some(Boolean)) continue
    const aseprite = /aseprite/i.test(str(meta['app'])) || /\.aseprite\.json$/i.test(file) || Array.isArray(meta['frameTags'])
    formats.add(aseprite ? 'Aseprite' : 'JSON 图集')
    // 同一张图集有多份 JSON（如 Aseprite 和 TexturePacker 各一份）时只取第一份的动作
    if (asset || atlasImages.has(image)) continue
    atlasImages.add(image)
    const append = (name: string, from: number, to: number): void => {
      const part = frames.slice(from, to + 1).filter((frame): frame is NonNullable<typeof frame> => frame !== null)
      if (!part.length) return
      const durations = part.map((frame) => frame.duration).filter((duration): duration is number => duration !== null)
      const fps = durations.length ? Math.max(1, Math.round(1000 * durations.length / durations.reduce((sum, value) => sum + value, 0))) : 12
      animations.push({ name, fps, loop: LOOP_NAME.test(name), frames: part.map((frame) => frame.frame) })
    }
    const tags = Array.isArray(meta['frameTags']) ? meta['frameTags'] : []
    if (!tags.length) append(posix.basename(file, posix.extname(file)), 0, frames.length - 1)
    else for (const value of tags) {
      const tag = obj(value)
      const from = tag['from']
      const to = tag['to']
      if (str(tag['name']) && typeof from === 'number' && typeof to === 'number' && Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to >= from && to < frames.length) {
        append(str(tag['name']), from, to)
      }
    }
  }

  // 人物素材（立绘、三视图）不算动画帧
  const references = Array.isArray(asset?.['references'])
    ? [...new Set(asset['references'].map((v) => imagePath(v)).filter((f): f is string => f !== null))].slice(0, 50)
    : []
  const groups = new Map<string, Array<{ file: string; number: number; prefix: string; dir: string }>>()
  for (const file of images) {
    if (atlasImages.has(file) || references.includes(file)) continue
    const match = posix.basename(file, posix.extname(file)).match(/^(.*?)(\d+)$/)
    if (!match) continue
    const dir = posix.dirname(file)
    const key = `${dir}/${match[1]}`
    const group = groups.get(key) ?? []
    group.push({ file, number: Number(match[2]), prefix: match[1].replace(/[_\- .]+$/, ''), dir })
    groups.set(key, group)
  }
  // 图集里已经有的同名动作不再按单帧序列重复列出（导出文件夹里图集和单帧往往都有）
  const fromAtlas = new Set(animations.map((a) => a.name.toLowerCase()))
  const seqNames = new Set<string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    formats.add('PNG 序列')
    if (asset) continue
    group.sort((a, b) => a.number - b.number || a.file.localeCompare(b.file))
    const first = group[0]
    const folder = posix.basename(first.dir)
    const directoryName = folder.toLowerCase() === 'frames' ? posix.basename(posix.dirname(first.dir)) : folder
    const name = ((folder.toLowerCase() === 'frames' ? '' : first.prefix) || (directoryName !== '.' ? directoryName : '') || input.name).trim() || '动画'
    if (fromAtlas.has(name.toLowerCase())) continue
    // 不同目录的序列同名时加编号区分
    let unique = name
    for (let n = 2; seqNames.has(unique.toLowerCase()); n++) unique = `${name} ${n}`
    seqNames.add(unique.toLowerCase())
    animations.push({ name: unique, fps: 12, loop: LOOP_NAME.test(name), frames: group.map(({ file }) => ({ file, rect: null })) })
  }
  if (!formats.size) for (const file of images) formats.add(posix.extname(file).slice(1).toUpperCase().replace('JPEG', 'JPG'))
  if (files.some((file) => /\.(tres|tscn)$/i.test(file))) formats.add('Godot')

  const preview = imagePath(asset?.['preview']) ?? PREVIEW_NAMES.find((file) => imageSet.has(file)) ?? animations[0]?.frames[0]?.file ?? images[0] ?? null
  const first = animations[0]?.frames[0]
  const frameSize: [number, number] | null = first?.rect ? [first.rect[2], first.rect[3]] : first ? await size(first.file) : preview ? await size(preview) : null
  const source = obj(asset?.['source'])
  return {
    idHint: str(asset?.['id']), name, category: guessCategory([str(asset?.['category']), ...tags, name]), tags,
    preview, frameSize, animations, imageCount: images.length, formats: [...formats], hasAssetJson: fileSet.has('asset.json'),
    ...(references.length && { references }),
    source: [str(source['how_made']) || str(asset?.['source']), str(source['license'])].filter(Boolean).join(' · ').slice(0, 1000)
  }
}
