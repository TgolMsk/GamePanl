// 2D 资产识别测试：文件、JSON 和尺寸均为内存数据，不需要 Electron。
// node_modules/.bin/esbuild tests/assets2d/detect.test.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --alias:@renderer=./src/renderer/src --outfile=/tmp/a2d.mjs && node /tmp/a2d.mjs
import assert from 'node:assert/strict'
import { asset2dRelativePath, detectAsset2D } from '../../src/main/asset2dDetect'

let passed = 0
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn()
  passed++
  console.log(`通过：${name}`)
}

function detect(files: string[], json: Record<string, unknown> = {}, sizes: Record<string, [number, number]> = {}, name = 'hero') {
  return detectAsset2D({ files, name, readJson: (file) => json[file], readImageSize: (file) => sizes[file] ?? [64, 64] })
}

const atlasFrames = [
  { frame: { x: 0, y: 0, w: 16, h: 24 }, duration: 100 },
  { frame: { x: 16, y: 0, w: 16, h: 24 }, duration: 100 },
  { frame: { x: 32, y: 0, w: 16, h: 24 }, duration: 200 }
]

await test('asset.json 优先读取字符串帧和 rect 帧，丢掉非法路径、矩形和空动画', async () => {
  const result = await detect(['asset.json', 'run/frame.png', 'sheet.png', 'preview.webp'], {
    'asset.json': {
      id: 'swordsman', name: '剑士', category: '角色', tags: ['序列帧', '序列帧'], preview: 'preview.webp',
      animations: [
        { name: 'run', fps: 20, loop: true, frames: ['run/frame.png', '../outside.png', '/sheet.png', 'missing.png'] },
        { name: 'hit', fps: 10, loop: false, frames: [{ file: 'sheet.png', rect: [4, 8, 16, 24] }, { file: 'sheet.png', rect: [-1, 0, 3, 3] }, { file: 'sheet.png', rect: [63, 0, 3, 3] }] },
        { name: 'empty', frames: ['missing.png'] }
      ], source: { how_made: '绘制', license: '自有' }
    }
  }, { 'run/frame.png': [20, 30] })
  assert.equal(result.idHint, 'swordsman')
  assert.equal(result.name, '剑士')
  assert.equal(result.category, '角色')
  assert.deepEqual(result.tags, ['序列帧'])
  assert.deepEqual(result.animations, [
    { name: 'run', fps: 20, loop: true, frames: [{ file: 'run/frame.png', rect: null }] },
    { name: 'hit', fps: 10, loop: false, frames: [{ file: 'sheet.png', rect: [4, 8, 16, 24] }] }
  ])
  assert.deepEqual(result.frameSize, [20, 30])
  assert.equal(result.preview, 'preview.webp')
  assert.equal(result.source, '绘制 · 自有')
  assert.equal(result.hasAssetJson, true)
})

await test('rect 帧尺寸优先于整张图和 frame_size', async () => {
  const result = await detect(['asset.json', 'sheet.png'], {
    'asset.json': { frame_size: [64, 64], animations: [{ name: 'idle', frames: [{ file: 'sheet.png', rect: [0, 0, 16, 24] }] }] }
  })
  assert.deepEqual(result.frameSize, [16, 24])
  assert.equal(result.animations[0].fps, 12)
  assert.equal(result.animations[0].loop, true)
})

await test('Aseprite 数组 frames 按 frameTags 分动画并计算平均帧率', async () => {
  const result = await detect(['actor.json', 'sheet.png'], {
    'actor.json': { frames: atlasFrames, meta: { app: 'https://www.aseprite.org/', image: 'sheet.png', frameTags: [{ name: 'run', from: 0, to: 1 }, { name: 'hit', from: 2, to: 2 }] } }
  })
  assert.deepEqual(result.formats, ['Aseprite'])
  assert.deepEqual(result.animations.map(({ name, fps, loop, frames }) => [name, fps, loop, frames.length]), [['run', 10, true, 2], ['hit', 5, false, 1]])
  assert.deepEqual(result.frameSize, [16, 24])
})

await test('JSON 图集对象 frames 保留对象顺序，没有标签时用 JSON 文件名', async () => {
  const result = await detect(['pack/attack.json', 'pack/atlas.png'], {
    'pack/attack.json': { frames: { attack_b: atlasFrames[1], attack_a: atlasFrames[0], attack_c: atlasFrames[2] }, meta: { app: 'TexturePacker', image: 'atlas.png' } }
  })
  assert.deepEqual(result.formats, ['JSON 图集'])
  assert.equal(result.animations[0].name, 'attack')
  assert.equal(result.animations[0].fps, 8)
  assert.deepEqual(result.animations[0].frames[0], { file: 'pack/atlas.png', rect: [16, 0, 16, 24] })
})

await test('对象 frames 同样支持标签，缺少 duration 时用 12 fps', async () => {
  const result = await detect(['pack.json', 'pack.png'], {
    'pack.json': { frames: { a: { frame: atlasFrames[0].frame }, b: { frame: atlasFrames[1].frame } }, meta: { image: 'pack.png', frameTags: [{ name: 'idle', from: 0, to: 1 }] } }
  })
  assert.equal(result.animations[0].fps, 12)
  assert.equal(result.animations[0].frames.length, 2)
})

await test('PNG 序列按目录与前缀分组，数字排序而非字典排序', async () => {
  const result = await detect(['run_010.png', 'run_002.png', 'run_000.png', 'hit-2.png', 'hit-1.png', 'walk 01.png', 'walk 02.png', 'single_0.png'])
  const run = result.animations.find((animation) => animation.name === 'run')!
  assert.deepEqual(run.frames.map((frame) => frame.file), ['run_000.png', 'run_002.png', 'run_010.png'])
  assert.equal(run.loop, true)
  assert.deepEqual(result.animations.map((animation) => animation.name).sort(), ['hit', 'run', 'walk'])
  assert.equal(result.formats.includes('PNG 序列'), true)
})

await test('纯数字帧取目录名，frames 目录取上一级动作名', async () => {
  const result = await detect(['run/frames/frame_00.png', 'run/frames/frame_01.png', 'idle/0001.png', 'idle/0002.png', 'frames/0001.png', 'frames/0002.png', '0001.png', '0002.png'], {}, {}, '勇者')
  assert.deepEqual(result.animations.map((animation) => animation.name).sort(), ['idle', 'run', '勇者', '勇者 2'].sort())
})

await test('导出文件夹里图集和单帧都有时，同名动作只列一次；同一张图集的多份 JSON 只取一份', async () => {
  const result = await detect(['hero_atlas.png', 'hero.aseprite.json', 'hero.tp.json', 'run/frames/frame_00.png', 'run/frames/frame_01.png', 'jump/frames/frame_00.png', 'jump/frames/frame_01.png'], {
    'hero.aseprite.json': { frames: atlasFrames, meta: { app: 'GamePanl', image: 'hero_atlas.png', frameTags: [{ name: 'run', from: 0, to: 1 }] } },
    'hero.tp.json': { frames: atlasFrames, meta: { image: 'hero_atlas.png' } }
  })
  assert.deepEqual(result.animations.map((animation) => animation.name), ['run', 'jump'])
  assert.equal(result.formats.includes('Aseprite'), true)
})

await test('图集已使用的图片不重复识别为 PNG 序列', async () => {
  const result = await detect(['run_001.png', 'run_002.png', 'run.json'], {
    'run.json': { frames: atlasFrames, meta: { image: 'run_001.png' } }
  })
  assert.equal(result.animations.length, 1)
  assert.deepEqual(result.formats, ['JSON 图集'])
})

await test('静态图片用预览尺寸，记录图片格式和按名称推测分类', async () => {
  const result = await detect(['weapon.jpg'], {}, { 'weapon.jpg': [320, 120] }, 'weapon')
  assert.equal(result.preview, 'weapon.jpg')
  assert.deepEqual(result.frameSize, [320, 120])
  assert.equal(result.imageCount, 1)
  assert.deepEqual(result.animations, [])
  assert.deepEqual(result.formats, ['JPG'])
  assert.equal(result.category, '道具')
})

await test('预览依次取清单、常见文件名、首动画帧、排序第一张图', async () => {
  const names = ['preview.png', 'preview.webp', 'thumbnail.png', 'thumb.png']
  for (let index = 0; index < names.length; index++) {
    const result = await detect([...names.slice(index), 'a.png', 'run_1.png', 'run_2.png'])
    assert.equal(result.preview, names[index])
  }
  const manifest = await detect(['asset.json', 'chosen.png', 'preview.png'], { 'asset.json': { preview: 'chosen.png' } })
  assert.equal(manifest.preview, 'chosen.png')
  assert.equal((await detect(['a.png', 'run_1.png', 'run_2.png'])).preview, 'run_1.png')
  assert.equal((await detect(['z.png', 'a.png'])).preview, 'a.png')
  assert.equal((await detect([])).preview, null)
})

await test('Godot 标记可与动画格式同时存在', async () => {
  const result = await detect(['run_1.png', 'run_2.png', 'hero.tres', 'hero.tscn'])
  assert.deepEqual(result.formats, ['PNG 序列', 'Godot'])
  assert.deepEqual((await detect(['art.png', 'scene.tscn'])).formats, ['PNG', 'Godot'])
})

await test('图片尺寸读不出时为 null，不把清单里的尺寸当成已验证值', async () => {
  const result = await detectAsset2D({ files: ['asset.json', 'preview.png'], name: 'hero', readJson: () => ({ frame_size: [64, 64] }), readImageSize: () => null })
  assert.equal(result.frameSize, null)
})

await test('损坏的 asset.json 仍记录文件存在，并继续识别图片', async () => {
  const result = await detect(['asset.json', 'idle_1.png', 'idle_2.png'])
  assert.equal(result.hasAssetJson, true)
  assert.equal(result.animations[0].name, 'idle')
})

await test('路径校验拒绝目录外、绝对路径和 Windows 路径', () => {
  for (const path of ['../a.png', '/a.png', 'C:/a.png', 'C:\\a.png', 'a\0.png', 'a/../../b.png']) assert.equal(asset2dRelativePath(path), null)
  assert.equal(asset2dRelativePath('../a.png', 'frames'), 'a.png')
  assert.equal(asset2dRelativePath('./frames/a.png'), 'frames/a.png')
})

await test('分类优先中文配置，否则按标签与名字识别', async () => {
  const configured = await detect(['asset.json', 'effect.png'], { 'asset.json': { category: '角色', name: 'effect' } })
  assert.equal(configured.category, '角色')
  for (const [name, category] of [['spark_fx', '特效'], ['tileset', '瓦片'], ['ui_button', 'UI'], ['bg_forest', '背景'], ['enemy_boss', '怪物'], ['player', '角色'], ['misc', '其他']]) {
    assert.equal((await detect(['art.png'], {}, {}, name)).category, category)
  }
})

console.log(`\n${passed} 项 2D 资产识别测试通过`)
