// 序列帧导出：确定性的 PNG / GIF 编码、图集与游戏引擎资源。
import * as fs from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { safeFileName } from '@shared/sprites'
import type { SpriteExportAction, SpriteExportBundle, SpriteExportResult } from '@shared/sprites'

type FrameRect = { x: number; y: number; w: number; h: number }

/** 恰好落在两个整数中间时取偶数，不用误差容限扩大半整数范围。 */
function roundHalfEven(value: number): number {
  const lower = Math.floor(value)
  const fraction = value - lower
  return fraction < 0.5 || (fraction === 0.5 && lower % 2 === 0) ? lower : lower + 1
}

function imageLength(width: number, height: number, channels: number, limit = 0x7fffffff): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > limit || height > limit) {
    throw new Error('图像宽高必须是有效的正整数')
  }
  const length = width * height * channels
  if (!Number.isSafeInteger(length)) throw new Error('图像尺寸过大')
  return length
}

function checkAction(action: SpriteExportAction): void {
  const length = imageLength(action.frameWidth, action.frameHeight, 4)
  if (!action.frames.length) throw new Error(`动作没有帧：${action.name}`)
  for (const frame of action.frames) {
    if (frame.length !== length) throw new Error(`RGBA 帧长度与尺寸不符：${action.name}`)
  }
}

function checkFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('帧率必须是有限的正数')
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function pngChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, 4, 'ascii')
  chunk.set(data, 8)
  let crc = 0xffffffff
  for (let i = 4; i < chunk.length - 4; i++) crc = crcTable[(crc ^ chunk[i]) & 255] ^ (crc >>> 8)
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4)
  return chunk
}

/** 8 位 RGBA PNG；固定无过滤扫描行和 zlib 级别 9，不写时间或附加信息。 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  if (rgba.length !== imageLength(width, height, 4)) throw new Error('RGBA 长度与 PNG 尺寸不符')
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const stride = width * 4
  const rows = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows, { level: 9 })),
    pngChunk('IEND', new Uint8Array())
  ])
}

/** GIF 的 LZW 码按低位优先写入；字典最多 4096 项，满后发清除码。 */
function gifLzw(indices: Uint8Array, minCodeSize: number): Buffer {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  const dictionary = new Map<number, number>()
  const bytes: number[] = []
  let nextCode = endCode + 1
  let codeSize = minCodeSize + 1
  let bits = 0
  let bitCount = 0
  const write = (code: number): void => {
    bits |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      bytes.push(bits & 255)
      bits >>>= 8
      bitCount -= 8
    }
  }
  const writeData = (code: number): void => {
    write(code)
    // 解码器建表比编码器晚一个码；写出当前码后才增长下一码的位宽。
    if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++
  }
  write(clearCode)
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const suffix = indices[i]
    const key = prefix * 256 + suffix
    const found = dictionary.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    writeData(prefix)
    if (nextCode < 4096) {
      dictionary.set(key, nextCode++)
    } else {
      write(clearCode)
      dictionary.clear()
      nextCode = endCode + 1
      codeSize = minCodeSize + 1
    }
    prefix = suffix
  }
  writeData(prefix)
  write(endCode)
  if (bitCount) bytes.push(bits & 255)
  return Buffer.from(bytes)
}

/** 全局调色板、无限循环、disposal = 2 的 GIF89a；不进行有损量化。 */
export function encodeGif(frames: Uint8Array[], width: number, height: number, delayCs: number): Buffer {
  const length = imageLength(width, height, 3, 65535)
  if (!frames.length) throw new Error('GIF 至少需要一帧')
  if (!Number.isInteger(delayCs) || delayCs < 0 || delayCs > 65535) throw new Error('GIF 延时必须是 0–65535 的整数')
  const palette = new Map<number, number>()
  const indexed = frames.map((frame) => {
    if (frame.length !== length) throw new Error('RGB 长度与 GIF 尺寸不符')
    const indices = new Uint8Array(width * height)
    for (let i = 0, pixel = 0; i < frame.length; i += 3, pixel++) {
      const color = (frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2]
      let index = palette.get(color)
      if (index === undefined) {
        index = palette.size
        if (index === 256) throw new Error('GIF 全部帧的颜色总数不能超过 256')
        palette.set(color, index)
      }
      indices[pixel] = index
    }
    return indices
  })
  const tableBits = Math.max(1, Math.ceil(Math.log2(palette.size)))
  const minCodeSize = Math.max(2, tableBits)
  const table = Buffer.alloc((1 << tableBits) * 3)
  for (const [color, index] of palette) {
    table[index * 3] = color >>> 16
    table[index * 3 + 1] = (color >>> 8) & 255
    table[index * 3 + 2] = color & 255
  }
  const header = Buffer.alloc(13)
  header.write('GIF89a', 'ascii')
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  header[10] = 0xf0 | (tableBits - 1)
  const chunks: Buffer[] = [header, table, Buffer.from([0x21, 0xff, 11]), Buffer.from('NETSCAPE2.0', 'ascii'), Buffer.from([3, 1, 0, 0, 0])]
  for (const indices of indexed) {
    const control = Buffer.from([0x21, 0xf9, 4, 8, 0, 0, 0, 0])
    control.writeUInt16LE(delayCs, 4)
    const descriptor = Buffer.alloc(10)
    descriptor[0] = 0x2c
    descriptor.writeUInt16LE(width, 5)
    descriptor.writeUInt16LE(height, 7)
    chunks.push(control, descriptor, Buffer.from([minCodeSize]))
    const compressed = gifLzw(indices, minCodeSize)
    for (let start = 0; start < compressed.length; start += 255) {
      const block = compressed.subarray(start, start + 255)
      chunks.push(Buffer.from([block.length]), block)
    }
    chunks.push(Buffer.from([0]))
  }
  chunks.push(Buffer.from([0x3b]))
  return Buffer.concat(chunks)
}

/** 先铺灰底，再做整数倍最近邻放大；RGBA 输出的 Alpha 恒为 255。 */
function grayPreview(rgba: Uint8Array, width: number, height: number, scale: number, channels: 3 | 4): Uint8Array {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('预览放大倍数必须是正整数')
  const outWidth = width * scale
  const output = new Uint8Array(imageLength(outWidth, height * scale, channels))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4
      const alpha = rgba[source + 3]
      const target = (y * scale * outWidth + x * scale) * channels
      for (let channel = 0; channel < 3; channel++) {
        output[target + channel] = Math.round((rgba[source + channel] * alpha + 186 * (255 - alpha)) / 255)
      }
      if (channels === 4) output[target + 3] = 255
      for (let dx = 1; dx < scale; dx++) output.copyWithin(target + dx * channels, target, target + channels)
    }
    const row = y * scale * outWidth * channels
    for (let dy = 1; dy < scale; dy++) output.copyWithin(row + dy * outWidth * channels, row, row + outWidth * channels)
  }
  return output
}

/** 单动作灰底预览；延时以厘秒计，半整数取偶数且最少为 2。 */
export function actionPreviewGif(action: SpriteExportAction, scale = 4): Buffer {
  checkAction(action)
  checkFps(action.fps)
  imageLength(action.frameWidth * scale, action.frameHeight * scale, 3, 65535)
  const frames = action.frames.map((frame) => grayPreview(frame, action.frameWidth, action.frameHeight, scale, 3))
  return encodeGif(frames, action.frameWidth * scale, action.frameHeight * scale, Math.max(2, roundHalfEven(100 / action.fps)))
}

function copyFrame(target: Uint8Array, width: number, frame: Uint8Array, rect: FrameRect): void {
  const stride = rect.w * 4
  for (let row = 0; row < rect.h; row++) {
    target.set(frame.subarray(row * stride, (row + 1) * stride), ((rect.y + row) * width + rect.x) * 4)
  }
}

/** 每个动作占一行；只复制原始 RGBA，行尾空白保持透明。 */
export function composeAtlas(bundle: SpriteExportBundle): { rgba: Uint8Array; width: number; height: number; rects: FrameRect[][] } {
  if (!bundle.actions.length) throw new Error('导出包至少需要一个动作')
  let width = 0
  let height = 0
  const rects = bundle.actions.map((action) => {
    checkAction(action)
    const y = height
    width = Math.max(width, action.frameWidth * action.frames.length)
    height += action.frameHeight
    return action.frames.map((_, index) => ({ x: index * action.frameWidth, y, w: action.frameWidth, h: action.frameHeight }))
  })
  const rgba = new Uint8Array(imageLength(width, height, 4))
  bundle.actions.forEach((action, index) => action.frames.forEach((frame, frameIndex) => copyFrame(rgba, width, frame, rects[index][frameIndex])))
  return { rgba, width, height, rects }
}

function composeSheet(action: SpriteExportAction): { rgba: Uint8Array; width: number; height: number } {
  const width = action.frameWidth * action.cols
  const height = action.frameHeight * Math.ceil(action.frames.length / action.cols)
  const rgba = new Uint8Array(imageLength(width, height, 4))
  action.frames.forEach((frame, index) => copyFrame(rgba, width, frame, {
    x: (index % action.cols) * action.frameWidth,
    y: Math.floor(index / action.cols) * action.frameHeight,
    w: action.frameWidth,
    h: action.frameHeight
  }))
  return { rgba, width, height }
}

function godotString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
}

function godotPath(bundle: SpriteExportBundle, file: string): string {
  if (bundle.godotPrefix === null) return godotString(file)
  const prefix = bundle.godotPrefix.replace(/\/+$/, '')
  // res:// 本身也可以作为前缀，不能把协议分隔符裁成 res:/。
  return godotString(`${prefix}${prefix.endsWith(':') ? '//' : '/'}${bundle.name}/${file}`)
}

function spriteFramesResource(bundle: SpriteExportBundle, rects: FrameRect[][]): string {
  const count = rects.reduce((total, row) => total + row.length, 0)
  const lines = [
    `[gd_resource type="SpriteFrames" load_steps=${count + 2} format=3]`,
    '',
    `[ext_resource type="Texture2D" path="${godotPath(bundle, `${bundle.name}_atlas.png`)}" id="1_atlas"]`,
    ''
  ]
  bundle.actions.forEach((action, actionIndex) => {
    const margin = [bundle.canvas.pivot[0] - action.pivot[0], bundle.canvas.pivot[1] - action.pivot[1], bundle.canvas.width - action.frameWidth, bundle.canvas.height - action.frameHeight]
    rects[actionIndex].forEach((rect, frameIndex) => {
      lines.push(
        `[sub_resource type="AtlasTexture" id="AtlasTexture_${actionIndex}_${frameIndex}"]`,
        'atlas = ExtResource("1_atlas")',
        `region = Rect2(${rect.x}, ${rect.y}, ${rect.w}, ${rect.h})`
      )
      if (margin.some((value) => value !== 0)) lines.push(`margin = Rect2(${margin.join(', ')})`)
      lines.push('')
    })
  })
  const animations = bundle.actions.map((action, actionIndex) => {
    const frames = action.frames.map((_, frameIndex) => `{
"duration": 1.0,
"texture": SubResource("AtlasTexture_${actionIndex}_${frameIndex}")
}`).join(', ')
    return `{
"frames": [${frames}],
"loop": ${action.loop},
"name": &"${godotString(action.name)}",
"speed": ${action.fps}
}`
  })
  lines.push('[resource]', `animations = [${animations.join(', ')}]`, '')
  return lines.join('\n')
}

function spriteScene(bundle: SpriteExportBundle): string {
  const animation = godotString(bundle.actions.find((action) => action.name === 'idle')?.name ?? bundle.actions[0].name)
  const node = godotString(bundle.name.replace(/[.:@/"%]/g, '_'))
  return `[gd_scene load_steps=2 format=3]

[ext_resource type="SpriteFrames" path="${godotPath(bundle, `${bundle.name}_spriteframes.tres`)}" id="1_frames"]

[node name="${node}" type="AnimatedSprite2D"]
texture_filter = 1
sprite_frames = ExtResource("1_frames")
animation = &"${animation}"
autoplay = "${animation}"
centered = false
offset = Vector2(${-bundle.canvas.pivot[0]}, ${-bundle.canvas.pivot[1]})
`
}

function readme(bundle: SpriteExportBundle): string {
  return [
    `角色名：${bundle.name}`,
    `公共画布：${bundle.canvas.width} × ${bundle.canvas.height}，落脚点：(${bundle.canvas.pivot.join(', ')})`,
    `调色板颜色数：${bundle.palette.length}`,
    ...(bundle.exportScale > 1 ? [`导出放大倍数：${bundle.exportScale}×（每个像素放大成 ${bundle.exportScale}×${bundle.exportScale}，尺寸、落脚点都已按放大后计算）`] : []),
    '',
    ...bundle.actions.map((action) => `${action.name}：${action.loop ? '循环' : '单次'}，${action.frames.length} 帧，帧率 ${action.fps.toFixed(2)}，单元格 ${action.frameWidth} × ${action.frameHeight}，落脚点 (${action.pivot.join(', ')})`),
    '',
    '导入说明：',
    `Godot 4：把整个文件夹放进项目，直接用 ${bundle.name}.tscn（已设最近邻过滤，落脚点在节点原点），或在 AnimatedSprite2D 里用 ${bundle.name}_spriteframes.tres；项目设置 → 渲染 → 纹理 → 默认纹理过滤设为 Nearest。`,
    `Unity：Texture 导入设置 Filter Mode = Point、Compression = None；配合 Aseprite 导入插件读 ${bundle.name}.aseprite.json。`,
    `Phaser / Cocos：用 ${bundle.name}.aseprite.json（Aseprite 数组格式）+ ${bundle.name}_atlas.png。`,
    '各动作单独的横条在各自文件夹的 sheet.png（按设定列数排列），frames/ 里是单帧。',
    ''
  ].join('\n')
}

function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code
}

async function statIfExists(file: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(file)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null
    throw error
  }
}

async function ensureDirectory(folder: string): Promise<void> {
  const stat = await statIfExists(folder)
  if (stat && !stat.isDirectory()) throw new Error(`导出目录不是普通文件夹：${folder}`)
  await fs.mkdir(folder, { recursive: true })
}

/** 只信任上次 Aseprite 标签；通用 JSON 的动作名可能被 action.meta 覆盖。 */
async function previousActionFolders(folder: string, name: string): Promise<Set<string>> {
  const names = new Set<string>()
  const file = join(folder, `${name}.aseprite.json`)
  if (!(await statIfExists(file))?.isFile()) return names
  let value: { meta?: { app?: string; frameTags?: Array<{ name?: unknown }> } }
  try {
    value = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    // 清单损坏时保留无法确认归属的目录，不把用户文件误当旧产物删除。
    if (error instanceof SyntaxError) return names
    throw error
  }
  const actions = value?.meta?.app === 'GamePanl' ? value.meta.frameTags : undefined
  if (Array.isArray(actions)) {
    for (const action of actions) if (typeof action?.name === 'string') names.add(safeFileName(action.name))
  }
  return names
}

async function removeEmptyDirectory(folder: string): Promise<void> {
  try {
    await fs.rmdir(folder)
  } catch (error) {
    if (!hasCode(error, 'ENOENT') && !hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST')) throw error
  }
}

async function cleanAction(folder: string, keepFrames?: Set<string>): Promise<void> {
  if (!(await statIfExists(folder))?.isDirectory()) return
  if (!keepFrames) {
    for (const name of ['sheet.png', 'preview.gif', 'preview_x4.png']) {
      const file = join(folder, name)
      if ((await statIfExists(file))?.isFile()) await fs.unlink(file)
    }
  }
  const frames = join(folder, 'frames')
  if ((await statIfExists(frames))?.isDirectory()) {
    for (const entry of await fs.readdir(frames, { withFileTypes: true })) {
      if (entry.isFile() && /^frame_\d{2,}\.png$/.test(entry.name) && !keepFrames?.has(entry.name)) await fs.unlink(join(frames, entry.name))
    }
    if (!keepFrames) await removeEmptyDirectory(frames)
  }
  if (!keepFrames) await removeEmptyDirectory(folder)
}

/** 写入完整角色导出包；旧动作只清理本模块约定的文件，保留用户文件。 */
export async function writeSpriteExport(dir: string, bundle: SpriteExportBundle): Promise<SpriteExportResult> {
  if (safeFileName(bundle.name) !== bundle.name) throw new Error('角色名必须是安全的文件名')
  const atlas = composeAtlas(bundle)
  imageLength(bundle.canvas.width, bundle.canvas.height, 4)
  const folder = resolve(dir, bundle.name)
  const rootFiles = [`${bundle.name}_atlas.png`, `${bundle.name}.json`, `${bundle.name}.aseprite.json`, `${bundle.name}_spriteframes.tres`, `${bundle.name}.tscn`, 'report.json', 'README.txt']
  const nameKey = (name: string): string => name.normalize('NFC').toLowerCase()
  const taken = new Set(rootFiles.map(nameKey))
  if (taken.size !== rootFiles.length) throw new Error(`角色名与固定导出文件名称冲突：${bundle.name}`)
  const actionFolders = bundle.actions.map((action) => {
    checkFps(action.fps)
    if (!Number.isInteger(action.cols) || action.cols < 1) throw new Error('动作列数必须是正整数')
    if (action.sourceFrames.length !== action.frames.length) throw new Error(`源帧号数量与动作帧数不符：${action.name}`)
    const name = safeFileName(action.name)
    const key = nameKey(name)
    if (taken.has(key)) throw new Error(`导出文件夹名称冲突：${name}`)
    taken.add(key)
    return name
  })
  await ensureDirectory(folder)
  const previous = await previousActionFolders(folder, bundle.name)
  let files = 0
  const write = async (file: string, data: string | Buffer): Promise<void> => {
    const stat = await statIfExists(file)
    if (stat && !stat.isFile()) throw new Error(`导出目标不是普通文件：${file}`)
    await fs.writeFile(file, data)
    files++
  }
  const writeJson = (file: string, data: unknown): Promise<void> => write(join(folder, file), JSON.stringify(data, null, 2) + '\n')
  await write(join(folder, `${bundle.name}_atlas.png`), encodePng(atlas.rgba, atlas.width, atlas.height))
  for (let index = 0; index < bundle.actions.length; index++) {
    const action = bundle.actions[index]
    const actionFolder = join(folder, actionFolders[index])
    await ensureDirectory(actionFolder)
    await ensureDirectory(join(actionFolder, 'frames'))
    const sheet = composeSheet(action)
    await write(join(actionFolder, 'sheet.png'), encodePng(sheet.rgba, sheet.width, sheet.height))
    await write(join(actionFolder, 'preview.gif'), actionPreviewGif(action, 4))
    await write(join(actionFolder, 'preview_x4.png'), encodePng(grayPreview(sheet.rgba, sheet.width, sheet.height, 4, 4), sheet.width * 4, sheet.height * 4))
    const digits = action.frames.length > 100 ? 3 : 2
    const keepFrames = new Set<string>()
    for (let frameIndex = 0; frameIndex < action.frames.length; frameIndex++) {
      const name = `frame_${String(frameIndex).padStart(digits, '0')}.png`
      keepFrames.add(name)
      await write(join(actionFolder, 'frames', name), encodePng(action.frames[frameIndex], action.frameWidth, action.frameHeight))
    }
    await cleanAction(actionFolder, keepFrames)
  }
  const current = new Map(actionFolders.map((name) => [nameKey(name), name]))
  for (const name of previous) {
    const replacement = current.get(nameKey(name))
    if (replacement === name) continue
    if (replacement !== undefined) {
      // 不区分大小写的卷上 run / Run 可能就是同一目录，不能误删新产物。
      const oldStat = await statIfExists(join(folder, name))
      const newStat = await statIfExists(join(folder, replacement))
      if (oldStat && newStat && oldStat.dev === newStat.dev && oldStat.ino === newStat.ino) continue
    }
    await cleanAction(join(folder, name))
  }
  await writeJson(`${bundle.name}.json`, {
    name: bundle.name,
    image: `${bundle.name}_atlas.png`,
    size: [atlas.width, atlas.height],
    pixel_scale: bundle.pixelScale,
    export_scale: bundle.exportScale,
    palette: bundle.palette,
    canvas: { size: [bundle.canvas.width, bundle.canvas.height], pivot: bundle.canvas.pivot },
    actions: bundle.actions.map((action, index) => ({
      name: action.name,
      loop: action.loop,
      fps: action.fps,
      frame_size: [action.frameWidth, action.frameHeight],
      pivot: action.pivot,
      offset: [bundle.canvas.pivot[0] - action.pivot[0], bundle.canvas.pivot[1] - action.pivot[1]],
      frames: atlas.rects[index].map((rect, frameIndex) => ({ ...rect, source: action.sourceFrames[frameIndex] })),
      ...action.meta
    }))
  })
  let firstFrame = 0
  await writeJson(`${bundle.name}.aseprite.json`, {
    frames: bundle.actions.flatMap((action, index) => atlas.rects[index].map((rect, frameIndex) => ({
      filename: `${action.name} ${frameIndex}.png`,
      frame: rect,
      rotated: false,
      trimmed: action.frameWidth !== bundle.canvas.width || action.frameHeight !== bundle.canvas.height,
      spriteSourceSize: { x: bundle.canvas.pivot[0] - action.pivot[0], y: bundle.canvas.pivot[1] - action.pivot[1], w: action.frameWidth, h: action.frameHeight },
      sourceSize: { w: bundle.canvas.width, h: bundle.canvas.height },
      duration: roundHalfEven(1000 / action.fps)
    }))),
    meta: {
      app: 'GamePanl',
      version: bundle.appVersion,
      image: `${bundle.name}_atlas.png`,
      format: 'RGBA8888',
      size: { w: atlas.width, h: atlas.height },
      scale: '1',
      frameTags: bundle.actions.map((action) => {
        const from = firstFrame
        firstFrame += action.frames.length
        return { name: action.name, from, to: firstFrame - 1, direction: 'forward' }
      })
    }
  })
  await write(join(folder, `${bundle.name}_spriteframes.tres`), spriteFramesResource(bundle, atlas.rects))
  await write(join(folder, `${bundle.name}.tscn`), spriteScene(bundle))
  await writeJson('report.json', bundle.report)
  await write(join(folder, 'README.txt'), readme(bundle))
  return { folder, files }
}
