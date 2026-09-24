// 全局库：图片素材、提示词、风格。
import { IMAGE_CATEGORIES, PROMPT_CATEGORIES } from '@shared/types'
import type { ID, ImageCategory, LibImage, Prompt, Style } from '@shared/types'
import type { PromptInput, StyleInput } from '@shared/api'
import {
  addToStore,
  candidateFromClipboard,
  candidatesFromFiles,
  findInStore,
  listStore,
  removeFromStore,
  updateInStore
} from './images'
import type { AddResult, Candidate, ImageStore } from './images'
import { modifyJson, newId, nowIso, paths, readJson, updateJson } from './storage'
import { dropThumbs } from './thumbs'
import { asId, asLine, asObject, asOneOf, asString, asStringList, fail, has } from './validate'

export function libraryStore(): ImageStore {
  return { dir: paths.libImagesDir(), index: paths.libImages(), hashes: paths.libHashes() }
}

// ---------- 图片 ----------

export function listImages(): Promise<LibImage[]> {
  return listStore<LibImage>(libraryStore())
}

export function getImage(id: ID): Promise<LibImage | undefined> {
  return findInStore<LibImage>(libraryStore(), id)
}

export interface LibImageMeta {
  name?: string
  category?: ImageCategory
  tags?: string[]
  addedAt?: string
}

/** 把图片加入全局库（按内容去重） */
export function addLibraryImages(
  candidates: Candidate[],
  meta: (c: Candidate, index: number) => LibImageMeta = () => ({})
): Promise<AddResult<LibImage>[]> {
  const metaOf = new Map(candidates.map((c, i) => [c, meta(c, i)]))
  return addToStore<LibImage>(libraryStore(), candidates, (c, id, file) => {
    const m = metaOf.get(c) ?? {}
    return {
      id,
      name: m.name ?? c.name,
      file,
      category: m.category ?? '其他',
      tags: m.tags ?? [],
      width: c.info.width,
      height: c.info.height,
      format: c.info.format,
      bytes: c.buf.length,
      addedAt: m.addedAt ?? nowIso()
    }
  })
}

/** 从本地文件导入；返回新加入的图片 */
export async function importImages(files: string[]): Promise<LibImage[]> {
  const results = await addLibraryImages(await candidatesFromFiles(files))
  return results.filter((r) => r.isNew).map((r) => r.item)
}

/** 从系统剪贴板导入；剪贴板里没有图片时返回 null，已在库里时返回原来那张 */
export async function importImageFromClipboard(): Promise<AddResult<LibImage> | null> {
  const c = await candidateFromClipboard()
  if (!c) return null
  const [r] = await addLibraryImages([c])
  return r
}

export function updateImage(id: ID, patch: unknown): Promise<LibImage> {
  const p = asObject(patch, '修改内容')
  const name = has(p, 'name') ? asLine(p['name'], '名称').trim() : undefined
  if (name !== undefined && !name) fail('名称不能为空')
  const category = has(p, 'category') ? asOneOf(p['category'], IMAGE_CATEGORIES, '分类') : undefined
  const tags = has(p, 'tags') ? asStringList(p['tags'], '标签') : undefined
  return updateInStore<LibImage>(libraryStore(), id, '图片不存在', (img) => ({
    ...img,
    ...(name !== undefined && { name }),
    ...(category !== undefined && { category }),
    ...(tags !== undefined && { tags })
  }))
}

/** 删除图片（原图移到废纸篓）；用它做样张的风格改为没有样张。返回是否改动了风格 */
export async function deleteImage(id: ID): Promise<{ stylesChanged: boolean }> {
  await removeFromStore<LibImage>(libraryStore(), id, '图片不存在')
  await dropThumbs(`lib.${id}.`)
  const stylesChanged = await modifyJson<Style[]>(paths.styles(), [], (styles) => {
    let changed = false
    for (const s of styles) {
      if (s.sampleImageId === id) {
        s.sampleImageId = null
        changed = true
      }
    }
    return changed
  })
  return { stylesChanged }
}

// ---------- 提示词 ----------

export async function listPrompts(): Promise<Prompt[]> {
  return readJson<Prompt[]>(paths.prompts(), [])
}

function promptFields(input: Record<string, unknown>, partial: boolean): Partial<PromptInput> {
  const out: Partial<PromptInput> = {}
  if (!partial || has(input, 'title')) out.title = asLine(input['title'], '标题')
  if (!partial || has(input, 'body')) out.body = asString(input['body'], '正文', 20_000)
  if (!partial || has(input, 'category')) out.category = asOneOf(input['category'], PROMPT_CATEGORIES, '分类')
  return out
}

export function createPrompt(input: unknown, uses = 0, createdAt = nowIso()): Promise<Prompt> {
  const f = promptFields(asObject(input, '提示词'), false) as PromptInput
  return updateJson<Prompt[], Prompt>(paths.prompts(), [], (list) => {
    const prompt: Prompt = {
      id: newId((x) => list.some((p) => p.id === x)),
      title: f.title,
      body: f.body,
      category: f.category,
      uses,
      createdAt,
      updatedAt: createdAt
    }
    list.unshift(prompt)
    return prompt
  })
}

function modifyPrompt(id: ID, fn: (p: Prompt) => Prompt): Promise<Prompt> {
  return updateJson<Prompt[], Prompt>(paths.prompts(), [], (list) => {
    const i = list.findIndex((p) => p.id === id)
    if (i < 0) fail('提示词不存在')
    list[i] = fn(list[i])
    return list[i]
  })
}

export function updatePrompt(id: ID, patch: unknown): Promise<Prompt> {
  const f = promptFields(asObject(patch, '修改内容'), true)
  return modifyPrompt(id, (p) => ({ ...p, ...f, updatedAt: nowIso() }))
}

export function markPromptUsed(id: ID): Promise<Prompt> {
  return modifyPrompt(id, (p) => ({ ...p, uses: (p.uses || 0) + 1 }))
}

export function deletePrompt(id: ID): Promise<void> {
  return updateJson<Prompt[], void>(paths.prompts(), [], (list) => {
    const i = list.findIndex((p) => p.id === id)
    if (i < 0) fail('提示词不存在')
    list.splice(i, 1)
  })
}

// ---------- 风格 ----------

export async function listStyles(): Promise<Style[]> {
  return readJson<Style[]>(paths.styles(), [])
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function asPalette(v: unknown): string[] {
  if (!Array.isArray(v)) fail('色板必须是数组')
  if (v.length > 12) fail('色板颜色太多了')
  return v.map((x) => {
    const s = typeof x === 'string' ? x.trim() : ''
    if (!HEX.test(s)) fail('色值必须是 #RRGGBB')
    const hex = s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s
    return hex.toUpperCase()
  })
}

async function styleFields(input: Record<string, unknown>, partial: boolean): Promise<Partial<StyleInput>> {
  const out: Partial<StyleInput> = {}
  if (!partial || has(input, 'name')) out.name = asLine(input['name'], '名称')
  if (!partial || has(input, 'desc')) out.desc = asLine(input['desc'], '描述', 1000)
  if (!partial || has(input, 'palette')) out.palette = asPalette(input['palette'])
  if (!partial || has(input, 'prompt')) out.prompt = asString(input['prompt'], '提示词', 20_000)
  const v = input['sampleImageId']
  if (!partial || v !== undefined) {
    if (v === null || v === undefined) out.sampleImageId = null
    else {
      const sid = asId(v, '样张 id')
      if (!(await getImage(sid))) fail('样张图片不存在')
      out.sampleImageId = sid
    }
  }
  return out
}

export async function createStyle(input: unknown, createdAt = nowIso()): Promise<Style> {
  const f = (await styleFields(asObject(input, '风格'), false)) as StyleInput
  return updateJson<Style[], Style>(paths.styles(), [], (list) => {
    const style: Style = {
      id: newId((x) => list.some((s) => s.id === x)),
      name: f.name,
      desc: f.desc,
      palette: f.palette,
      prompt: f.prompt,
      sampleImageId: f.sampleImageId,
      createdAt,
      updatedAt: createdAt
    }
    list.unshift(style)
    return style
  })
}

export async function updateStyle(id: ID, patch: unknown): Promise<Style> {
  const f = await styleFields(asObject(patch, '修改内容'), true)
  return updateJson<Style[], Style>(paths.styles(), [], (list) => {
    const i = list.findIndex((s) => s.id === id)
    if (i < 0) fail('风格不存在')
    list[i] = { ...list[i], ...f, updatedAt: nowIso() }
    return list[i]
  })
}

export function deleteStyle(id: ID): Promise<void> {
  return updateJson<Style[], void>(paths.styles(), [], (list) => {
    const i = list.findIndex((s) => s.id === id)
    if (i < 0) fail('风格不存在')
    list.splice(i, 1)
  })
}

/** 全局库是否还是空的 */
export async function libraryEmpty(): Promise<boolean> {
  const [images, prompts, styles] = await Promise.all([listImages(), listPrompts(), listStyles()])
  return images.length === 0 && prompts.length === 0 && styles.length === 0
}
