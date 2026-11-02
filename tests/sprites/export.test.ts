import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeFileName } from '@shared/sprites'
import type { SpriteExportAction, SpriteExportBundle } from '@shared/sprites'
import { actionPreviewGif, composeAtlas, encodeGif, encodePng, writeSpriteExport } from '../../src/main/spriteExport'

interface ImageCheck {
  file: string
  width: number
  height: number
  mode: 'RGBA' | 'RGB'
  pixels: string[]
  duration?: number
}

const colors = [[214, 50, 43], [35, 94, 177], [245, 202, 52]]

function makeAction(name: string, count: number, width: number, height: number, fps: number, loop: boolean): SpriteExportAction {
  return {
    name,
    loop,
    fps,
    frameWidth: width,
    frameHeight: height,
    pivot: [Math.floor(width / 2), height - 2],
    cols: 3,
    frames: Array.from({ length: count }, (_, frame) => {
      const rgba = new Uint8Array(width * height * 4)
      for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
          if ((x + frame * 3) % 17 >= 11) continue
          rgba.set([...colors[(Math.floor(y / 9) + frame) % colors.length], 255], (y * width + x) * 4)
        }
      }
      return rgba
    }),
    sourceFrames: Array.from({ length: count }, (_, frame) => frame * 3 + 7),
    meta: { source_video: `${name}.mp4`, quality: { score: 0.875 }, samples: [1, 3, 5] }
  }
}

const bundle: SpriteExportBundle = {
  name: '测试角色',
  palette: ['#d6322b', '#235eb1', '#f5ca34'],
  pixelScale: 0.125,
  exportScale: 1,
  canvas: { width: 64, height: 74, pivot: [32, 70] },
  actions: [makeAction('run', 8, 53, 66, 12.632, true), makeAction('attack', 5, 60, 70, 10, false)],
  report: { passed: true, checks: [{ name: 'alpha', errors: 0 }] },
  godotPrefix: null,
  appVersion: '1.2.3'
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

// 按坐标复制期望像素，避免拿被测的 composeAtlas 作为图片正确性的依据。
function place(target: Uint8Array, targetWidth: number, frame: Uint8Array, width: number, height: number, left: number, top: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        target[((top + y) * targetWidth + left + x) * 4 + channel] = frame[(y * width + x) * 4 + channel]
      }
    }
  }
}

function grayScale(rgba: Uint8Array, width: number, height: number, scale: number, channels: 3 | 4): Uint8Array {
  const result = new Uint8Array(width * height * scale * scale * channels)
  for (let y = 0; y < height * scale; y++) {
    for (let x = 0; x < width * scale; x++) {
      const source = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4
      const target = (y * width * scale + x) * channels
      for (let channel = 0; channel < 3; channel++) {
        result[target + channel] = rgba[source + 3] === 255 ? rgba[source + channel] : 186
      }
      if (channels === 4) result[target + 3] = 255
    }
  }
  return result
}

function checkImages(checks: ImageCheck[]): void {
  const output = execFileSync('python3', ['-c', `
import base64, json, sys
from PIL import Image
checks = json.load(sys.stdin)
for check in checks:
    with Image.open(check['file']) as image:
        assert image.size == (check['width'], check['height']), check['file']
        assert getattr(image, 'n_frames', 1) == len(check['pixels']), check['file']
        if 'duration' in check:
            assert image.format == 'GIF', check['file']
            assert image.info.get('loop') == 0, check['file']
        else:
            assert image.format == 'PNG' and image.mode == 'RGBA', check['file']
        for index, expected in enumerate(check['pixels']):
            image.seek(index)
            if 'duration' in check:
                assert image.info.get('duration') == check['duration'], (check['file'], index, image.info)
                assert image.disposal_method == 2, (check['file'], index)
            assert image.convert(check['mode']).tobytes() == base64.b64decode(expected), (check['file'], index, 'pixels')
print('Pillow: ' + str(len(checks)) + ' images decoded; exact dimensions, pixels, GIF frames/durations/loop/disposal passed')
`], { input: JSON.stringify(checks), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  process.stdout.write(output)
}

async function snapshot(folder: string, prefix = ''): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>()
  for (const entry of (await readdir(join(folder, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) {
      for (const [file, bytes] of await snapshot(folder, relative)) result.set(file, bytes)
    } else {
      result.set(relative, await readFile(join(folder, relative)))
    }
  }
  return result
}

async function jsonFile(file: string): Promise<any> {
  const text = await readFile(file, 'utf8')
  const value: unknown = JSON.parse(text)
  assert.equal(text, JSON.stringify(value, null, 2) + '\n', `${file}: JSON 格式`)
  return value
}

function pngChunks(png: Buffer): string[] {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const result: string[] = []
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset)
    result.push(png.toString('ascii', offset + 4, offset + 8))
    offset += size + 12
    assert.ok(offset <= png.length)
    if (result[result.length - 1] === 'IEND') assert.equal(offset, png.length)
  }
  return result
}

async function checkExport(root: string): Promise<void> {
  const result = await writeSpriteExport(root, bundle)
  assert.equal(result.folder, join(root, bundle.name))
  assert.equal(result.files, 26)
  const first = await snapshot(result.folder)
  const expectedNames = [
    `${bundle.name}_atlas.png`, `${bundle.name}.json`, `${bundle.name}.aseprite.json`,
    `${bundle.name}_spriteframes.tres`, `${bundle.name}.tscn`, 'report.json', 'README.txt',
    ...bundle.actions.flatMap(action => [
      `${action.name}/sheet.png`, `${action.name}/preview.gif`, `${action.name}/preview_x4.png`,
      ...action.frames.map((_, index) => `${action.name}/frames/frame_${String(index).padStart(2, '0')}.png`)
    ])
  ]
  assert.deepEqual([...first.keys()].sort(), expectedNames.sort())

  const atlasWidth = 424
  const atlasHeight = 136
  const expectedAtlas = new Uint8Array(atlasWidth * atlasHeight * 4)
  const rects = bundle.actions.map((action, actionIndex) => action.frames.map((frame, frameIndex) => {
    const rect = { x: frameIndex * action.frameWidth, y: actionIndex === 0 ? 0 : 66, w: action.frameWidth, h: action.frameHeight }
    place(expectedAtlas, atlasWidth, frame, rect.w, rect.h, rect.x, rect.y)
    return rect
  }))
  assert.deepEqual(composeAtlas(bundle), { rgba: expectedAtlas, width: atlasWidth, height: atlasHeight, rects })
  const checks: ImageCheck[] = [{ file: join(result.folder, `${bundle.name}_atlas.png`), width: atlasWidth, height: atlasHeight, mode: 'RGBA', pixels: [base64(expectedAtlas)] }]
  for (const action of bundle.actions) {
    const folder = join(result.folder, action.name)
    const width = action.cols * action.frameWidth
    const height = Math.ceil(action.frames.length / action.cols) * action.frameHeight
    const sheet = new Uint8Array(width * height * 4)
    action.frames.forEach((frame, index) => {
      place(sheet, width, frame, action.frameWidth, action.frameHeight, index % action.cols * action.frameWidth, Math.floor(index / action.cols) * action.frameHeight)
      checks.push({ file: join(folder, 'frames', `frame_${String(index).padStart(2, '0')}.png`), width: action.frameWidth, height: action.frameHeight, mode: 'RGBA', pixels: [base64(frame)] })
    })
    checks.push({ file: join(folder, 'sheet.png'), width, height, mode: 'RGBA', pixels: [base64(sheet)] })
    checks.push({ file: join(folder, 'preview_x4.png'), width: width * 4, height: height * 4, mode: 'RGBA', pixels: [base64(grayScale(sheet, width, height, 4, 4))] })
    checks.push({ file: join(folder, 'preview.gif'), width: action.frameWidth * 4, height: action.frameHeight * 4, mode: 'RGB', duration: action.name === 'run' ? 80 : 100, pixels: action.frames.map(frame => base64(grayScale(frame, action.frameWidth, action.frameHeight, 4, 3))) })
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', join(folder, 'preview.gif')], { encoding: 'utf8' }))
    assert.deepEqual(probe.streams, [{ codec_name: 'gif', width: action.frameWidth * 4, height: action.frameHeight * 4, nb_read_frames: String(action.frames.length) }])
  }
  checkImages(checks)
  console.log('ffprobe: run (8 frames, 212x264) and attack (5 frames, 240x280) passed')

  const metadata = await jsonFile(join(result.folder, `${bundle.name}.json`))
  assert.deepEqual(metadata, {
    name: bundle.name, image: `${bundle.name}_atlas.png`, size: [424, 136], pixel_scale: 0.125, export_scale: 1,
    palette: bundle.palette, canvas: { size: [64, 74], pivot: [32, 70] },
    actions: bundle.actions.map((action, index) => ({
      name: action.name, loop: action.loop, fps: action.fps, frame_size: [action.frameWidth, action.frameHeight], pivot: action.pivot,
      offset: [32 - action.pivot[0], 70 - action.pivot[1]],
      frames: rects[index].map((rect, frame) => ({ ...rect, source: action.sourceFrames[frame] })), ...action.meta
    }))
  })
  assert.deepEqual(await jsonFile(join(result.folder, 'report.json')), bundle.report)
  const aseprite = await jsonFile(join(result.folder, `${bundle.name}.aseprite.json`))
  assert.deepEqual(aseprite.frames, bundle.actions.flatMap((action, index) => action.frames.map((_, frame) => ({
    filename: `${action.name} ${frame}.png`, frame: rects[index][frame], rotated: false, trimmed: true,
    spriteSourceSize: { x: 32 - action.pivot[0], y: 70 - action.pivot[1], w: action.frameWidth, h: action.frameHeight },
    sourceSize: { w: 64, h: 74 }, duration: index === 0 ? 79 : 100
  }))))
  assert.deepEqual(aseprite.meta, {
    app: 'GamePanl', version: '1.2.3', image: `${bundle.name}_atlas.png`, format: 'RGBA8888',
    size: { w: 424, h: 136 }, scale: '1', frameTags: [
      { name: 'run', from: 0, to: 7, direction: 'forward' }, { name: 'attack', from: 8, to: 12, direction: 'forward' }
    ]
  })
  const tres = await readFile(join(result.folder, `${bundle.name}_spriteframes.tres`), 'utf8')
  assert.ok(tres.includes('[gd_resource type="SpriteFrames" load_steps=15 format=3]'))
  assert.equal((tres.match(/\[sub_resource type="AtlasTexture"/g) ?? []).length, 13)
  assert.equal((tres.match(/margin = Rect2\(6, 6, 11, 8\)/g) ?? []).length, 8)
  assert.equal((tres.match(/margin = Rect2\(2, 2, 4, 4\)/g) ?? []).length, 5)
  assert.equal((tres.match(/"duration": 1\.0/g) ?? []).length, 13)
  assert.ok(tres.includes(`path="${bundle.name}_atlas.png"`))
  assert.ok(tres.includes('"speed": 12.632'))
  assert.ok(tres.includes('"loop": false'))
  for (let action = 0; action < rects.length; action++) {
    for (let frame = 0; frame < rects[action].length; frame++) {
      const rect = rects[action][frame]
      assert.ok(tres.includes(`id="AtlasTexture_${action}_${frame}"`))
      assert.ok(tres.includes(`region = Rect2(${rect.x}, ${rect.y}, ${rect.w}, ${rect.h})`))
    }
  }
  const scene = await readFile(join(result.folder, `${bundle.name}.tscn`), 'utf8')
  for (const line of ['[gd_scene load_steps=2 format=3]', `path="${bundle.name}_spriteframes.tres"`, 'texture_filter = 1', 'animation = &"run"', 'autoplay = "run"', 'centered = false', 'offset = Vector2(-32, -70)']) assert.ok(scene.includes(line), line)
  const readme = await readFile(join(result.folder, 'README.txt'), 'utf8')
  for (const text of [bundle.name, '64', '74', '32', '70', 'run', 'attack', '12.63', '10.00', '循环', '单次', 'Godot 4', 'Nearest', 'Unity', 'Point', 'None', 'Phaser', 'Cocos', 'sheet.png', 'frames/']) assert.ok(readme.includes(text), text)
  const second = await writeSpriteExport(root, bundle)
  assert.deepEqual(second, result)
  assert.deepEqual(await snapshot(result.folder), first)
  console.log('Export: all 26 files, atlas/sheets/frames/previews, metadata, Godot margins and byte-identical repeat passed')
}

async function checkCodecs(root: string): Promise<void> {
  const checks: ImageCheck[] = []
  const rgba = Uint8Array.from([1, 2, 3, 0, 255, 32, 64, 128, 3, 8, 13, 255, 0, 0, 0, 255])
  const png = encodePng(rgba, 2, 2)
  assert.deepEqual(png, encodePng(rgba, 2, 2))
  assert.deepEqual(pngChunks(png), ['IHDR', 'IDAT', 'IEND'])
  assert.equal(png[24], 8)
  assert.equal(png[25], 6)
  const pngFile = join(root, 'codec.png')
  await writeFile(pngFile, png)
  checks.push({ file: pngFile, width: 2, height: 2, mode: 'RGBA', pixels: [base64(rgba)] })
  for (const count of [1, 2, 3, 16, 256]) {
    const width = 257
    const height = 193
    let state = 0x12345678
    const frames = Array.from({ length: 2 }, () => {
      const rgb = new Uint8Array(width * height * 3)
      for (let pixel = 0; pixel < width * height; pixel++) {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        const color = (state >>> 0) % count
        rgb.set([color, (color * 37) % 256, 255 - color], pixel * 3)
      }
      return rgb
    })
    const gif = encodeGif(frames, width, height, 7)
    assert.deepEqual(gif, encodeGif(frames, width, height, 7))
    assert.equal(gif.toString('ascii', 0, 6), 'GIF89a')
    assert.ok((gif[10] & 0x80) !== 0, '必须有全局调色板')
    const file = join(root, `colors-${count}.gif`)
    await writeFile(file, gif)
    checks.push({ file, width, height, mode: 'RGB', pixels: frames.map(base64), duration: 70 })
  }
  const first = new Uint8Array(256 * 3)
  for (let index = 0; index < 256; index++) first.set([index, 0, 0], index * 3)
  const second = first.slice()
  second.set([0, 1, 0], 0)
  assert.throws(() => encodeGif([first, second], 256, 1, 10), /256/)
  for (const [fps, duration] of [[40, 20], [100 / 3.5, 40], [1000, 20]]) {
    const action = makeAction('rounding', 2, 5, 5, fps, true)
    const file = join(root, `round-${fps}.gif`)
    await writeFile(file, actionPreviewGif(action, 1))
    checks.push({ file, width: 5, height: 5, mode: 'RGB', duration, pixels: action.frames.map(frame => base64(grayScale(frame, 5, 5, 1, 3))) })
  }
  assert.deepEqual(actionPreviewGif(bundle.actions[0]), actionPreviewGif(bundle.actions[0], 4))
  checkImages(checks)
  console.log('Codecs: PNG RGBA/chunks/determinism; GIF 1/2/3/16/256 colors, large LZW streams, 257-color rejection and half-even timing passed')
}

async function checkCleanupAndPaths(root: string): Promise<void> {
  const folder = join(root, bundle.name)
  await mkdir(join(folder, 'user-art'), { recursive: true })
  await writeFile(join(folder, 'user-art', 'sheet.png'), '用户图片')
  await writeFile(join(folder, 'attack', 'notes.txt'), '保留动作说明')
  await writeFile(join(folder, 'attack', 'frames', 'notes.txt'), '保留帧说明')
  await writeFile(join(folder, 'custom.json'), '{"keep":true}')
  const shortened = { ...bundle, actions: [{ ...bundle.actions[0], frames: bundle.actions[0].frames.slice(0, 2), sourceFrames: bundle.actions[0].sourceFrames.slice(0, 2) }, bundle.actions[1]] }
  await writeSpriteExport(root, shortened)
  assert.deepEqual((await readdir(join(folder, 'run', 'frames'))).sort(), ['frame_00.png', 'frame_01.png'])
  const idle = makeAction('idle', 1, 4, 4, 16, true)
  idle.pivot = [2, 2]
  idle.cols = 1
  const next = { ...bundle, canvas: { width: 4, height: 4, pivot: [2, 2] as [number, number] }, actions: [idle] }
  await writeSpriteExport(root, next)
  await assert.rejects(stat(join(folder, 'run')), { code: 'ENOENT' })
  assert.deepEqual((await readdir(join(folder, 'attack'))).sort(), ['frames', 'notes.txt'])
  assert.deepEqual(await readdir(join(folder, 'attack', 'frames')), ['notes.txt'])
  assert.equal(await readFile(join(folder, 'attack', 'notes.txt'), 'utf8'), '保留动作说明')
  assert.equal(await readFile(join(folder, 'attack', 'frames', 'notes.txt'), 'utf8'), '保留帧说明')
  assert.equal(await readFile(join(folder, 'user-art', 'sheet.png'), 'utf8'), '用户图片')
  assert.equal(await readFile(join(folder, 'custom.json'), 'utf8'), '{"keep":true}')
  const tres = await readFile(join(folder, `${bundle.name}_spriteframes.tres`), 'utf8')
  assert.ok(!tres.includes('margin ='))
  const aseprite = await jsonFile(join(folder, `${bundle.name}.aseprite.json`))
  assert.equal(aseprite.frames[0].trimmed, false)
  assert.equal(aseprite.frames[0].duration, 62)

  const quotedName = 'say"\\go'
  const escapedName = 'say\\"\\\\go'
  const special: SpriteExportBundle = { ...next, name: 'Hero.@%', actions: [{ ...idle, name: quotedName, fps: 1000 / 3.5 }, idle], godotPrefix: 'res://art/hero///' }
  const specialResult = await writeSpriteExport(root, special)
  await stat(join(specialResult.folder, safeFileName(quotedName), 'sheet.png'))
  const specialTres = await readFile(join(specialResult.folder, `${special.name}_spriteframes.tres`), 'utf8')
  assert.ok(specialTres.includes('path="res://art/hero/Hero.@%/Hero.@%_atlas.png"'))
  assert.ok(specialTres.includes(`"name": &"${escapedName}"`))
  assert.equal((await jsonFile(join(specialResult.folder, `${special.name}.aseprite.json`))).frames[0].duration, 4)
  const scene = await readFile(join(specialResult.folder, `${special.name}.tscn`), 'utf8')
  assert.ok(scene.includes('[node name="Hero___" type="AnimatedSprite2D"]'))
  assert.ok(scene.includes('path="res://art/hero/Hero.@%/Hero.@%_spriteframes.tres"'))
  assert.ok(scene.includes('animation = &"idle"'))
  assert.ok(scene.includes('autoplay = "idle"'))
  await writeSpriteExport(root, { ...special, actions: special.actions.slice(0, 1), godotPrefix: 'res://' })
  const rootScene = await readFile(join(specialResult.folder, `${special.name}.tscn`), 'utf8')
  assert.ok(rootScene.includes('path="res://Hero.@%/Hero.@%_spriteframes.tres"'))
  assert.ok(rootScene.includes(`animation = &"${escapedName}"`))
  assert.ok(rootScene.includes(`autoplay = "${escapedName}"`))

  const many = { ...next, name: 'many', actions: [{ ...idle, frames: Array.from({ length: 101 }, () => idle.frames[0]), sourceFrames: Array.from({ length: 101 }, (_, index) => index) }] }
  const manyResult = await writeSpriteExport(root, many)
  const frameFiles = (await readdir(join(manyResult.folder, 'idle', 'frames'))).sort()
  assert.equal(frameFiles.length, 101)
  assert.equal(frameFiles[0], 'frame_000.png')
  assert.equal(frameFiles[100], 'frame_100.png')
  console.log('Re-export: stale frames/actions removed, user files preserved; safe names, Godot escaping/prefixes, idle default, zero margins and 101-frame numbering passed')

  await assert.rejects(writeSpriteExport(root, { ...next, name: 'report' }), /冲突/)
  await assert.rejects(stat(join(root, 'report')), { code: 'ENOENT' })

  const renamed = { ...next, name: 'case-rename', actions: [{ ...idle, name: 'run' }] }
  const renamedResult = await writeSpriteExport(root, renamed)
  await writeSpriteExport(root, { ...renamed, actions: [{ ...idle, name: 'Run' }] })
  assert.deepEqual(await readFile(join(renamedResult.folder, 'Run', 'sheet.png')), encodePng(idle.frames[0], 4, 4))
  const currentDirectory = await stat(join(renamedResult.folder, 'Run'))
  // 大小写不敏感的卷允许旧拼写继续指向同一个目录，不能据此删除新产物。
  try {
    const oldDirectory = await stat(join(renamedResult.folder, 'run'))
    assert.equal(oldDirectory.dev, currentDirectory.dev)
    assert.equal(oldDirectory.ino, currentDirectory.ino)
  } catch (error) {
    assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT')
  }

  const overridden = { ...next, name: 'metadata-name', actions: [{ ...idle, name: 'run', meta: { name: 'user-art' } }] }
  const overriddenResult = await writeSpriteExport(root, overridden)
  await mkdir(join(overriddenResult.folder, 'user-art'))
  await writeFile(join(overriddenResult.folder, 'user-art', 'sheet.png'), '用户图片')
  await writeSpriteExport(root, { ...overridden, actions: [idle] })
  await assert.rejects(stat(join(overriddenResult.folder, 'run')), { code: 'ENOENT' })
  assert.equal(await readFile(join(overriddenResult.folder, 'user-art', 'sheet.png'), 'utf8'), '用户图片')
  await writeSpriteExport(root, overridden)
  await writeFile(join(overriddenResult.folder, `${overridden.name}.aseprite.json`), '{broken')
  await writeSpriteExport(root, { ...overridden, actions: [idle] })
  // 可靠清单损坏后宁可留下旧动作，也不能按被 meta 覆盖的名字误删用户目录。
  await stat(join(overriddenResult.folder, 'run', 'sheet.png'))
  assert.equal(await readFile(join(overriddenResult.folder, 'user-art', 'sheet.png'), 'utf8'), '用户图片')
  console.log('Boundaries: report.json collision rejected before writing; case-only rename, metadata name override and damaged manifest preserve correct files')
}

const root = await mkdtemp(join(tmpdir(), 'gp-sprite-export-'))
try {
  await checkExport(root)
  await checkCodecs(root)
  await checkCleanupAndPaths(root)
  console.log('PASS: sprite export tests')
} finally {
  await rm(root, { recursive: true, force: true })
}
