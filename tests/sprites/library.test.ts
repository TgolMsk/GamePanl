// 序列帧角色的导入、分组、待生成、多版本、人物素材（主进程逻辑，electron 用替身）。
// node_modules/.bin/esbuild tests/sprites/library.test.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --alias:@renderer=./src/renderer/src --alias:electron=./tests/stubs/electron.ts --outfile=/tmp/gp-sprlib.mjs && node /tmp/gp-sprlib.mjs
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'gp-sprlib-'))
process.env['GAMEPANL_DATA_ROOT'] = join(root, 'data')

const { actionFacing, actionNameFromFile, buildSpritePrompt, DEFAULT_FRAME_SETUP, DEFAULT_SPRITE_PARAMS } = await import('@shared/sprites')
const sprites = await import('../../src/main/sprites')
const { encodePng } = await import('../../src/main/spriteExport')

let passed = 0
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn()
  passed++
  console.log(`通过：${name}`)
}

let seq = 0
/** 假视频：导入只拷贝文件，内容不用是真视频；大小不同才不会被当成同一个视频 */
async function video(dir: string, name: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const p = join(dir, name)
  await writeFile(p, Buffer.alloc(100 + ++seq))
  return p
}
async function png(dir: string, name: string, color: number): Promise<string> {
  await mkdir(dir, { recursive: true })
  const rgba = new Uint8Array(8 * 12 * 4).fill(255)
  for (let i = 0; i < rgba.length; i += 4) rgba[i] = color
  const p = join(dir, name)
  await writeFile(p, encodePng(rgba, 8, 12))
  return p
}
const src = (...parts: string[]): string => join(root, 'src', ...parts)

await test('文件名认动作：已有动作名优先取最长的，否则动作词 + 数字 + 方向', () => {
  assert.equal(actionNameFromFile('kling_hero_walk_down_v2.mp4', ['walk', 'walk_down']), 'walk_down')
  assert.equal(actionNameFromFile('hero walk down.mp4', ['walk_down']), 'walk_down')
  assert.equal(actionNameFromFile('swordsman_attack02.mp4'), 'attack2')
  assert.equal(actionNameFromFile('wan3_run_swordsman.mp4'), 'run')
  assert.equal(actionNameFromFile('run (1).mp4'), 'run')
  assert.equal(actionNameFromFile('hero_walk_side.mov'), 'walk_side')
  assert.equal(actionNameFromFile('勇者奔跑.mp4'), 'run')
  assert.equal(actionNameFromFile('勇者_蓄力斩.mp4', ['蓄力斩']), '蓄力斩')
  assert.equal(actionNameFromFile('standing_idle.mp4'), 'idle')
  assert.equal(actionNameFromFile('kling_20251102_123456.mp4'), null)
})

await test('提示词：写进人物描述、动作说明、朝向、循环要求和补充要求', () => {
  const base = { refs: [], frameSetup: DEFAULT_FRAME_SETUP }
  const p = buildSpritePrompt(
    { ...base, description: '红发少年剑士', view: 'topdown', promptExtra: '16-bit 像素风' },
    { name: 'walk_up', brief: '', params: DEFAULT_SPRITE_PARAMS }
  )
  assert.match(p.prompt, /红发少年剑士/)
  assert.match(p.prompt, /原地行走循环/)
  assert.match(p.prompt, /背对镜头/)
  assert.match(p.prompt, /无缝循环/)
  assert.match(p.prompt, /#00FF00/)
  assert.match(p.prompt, /16-bit 像素风$/)
  assert.equal(p.firstFrame, null)
  const d = buildSpritePrompt({ ...base, description: '', view: 'side', promptExtra: '' }, { name: 'death', brief: '中箭倒下', params: DEFAULT_SPRITE_PARAMS })
  assert.match(d.prompt, /中箭倒下/)
  assert.match(d.prompt, /最后倒地静止/)
  assert.match(d.prompt, /面朝画面右侧/)
})

await test('定妆照提示词：单次动作首尾帧都用定妆照，循环和死亡只用首帧；底色跟着设置；方向动作用对应朝向', () => {
  const ref = { id: 'r1', file: 'r1.png', name: '定妆照·侧面', width: 1280, height: 720, bytes: 1, facing: 'side' as const, from: null, addedAt: '' }
  const ch = { description: '红发剑士', view: 'side' as const, promptExtra: '', refs: [ref], frameSetup: { ...DEFAULT_FRAME_SETUP, screen: 'blue' as const } }
  const atk = buildSpritePrompt(ch, { name: 'attack1', brief: '', params: DEFAULT_SPRITE_PARAMS })
  assert.equal(atk.firstFrame?.id, 'r1')
  assert.equal(atk.lastFrame, true)
  assert.match(atk.prompt, /首帧图中的角色/)
  assert.match(atk.prompt, /回到完全相同的站姿/)
  assert.match(atk.prompt, /#0000FF/)
  assert.equal(buildSpritePrompt(ch, { name: 'run', brief: '', params: DEFAULT_SPRITE_PARAMS }).lastFrame, false)
  assert.equal(buildSpritePrompt(ch, { name: 'death', brief: '', params: DEFAULT_SPRITE_PARAMS }).lastFrame, false)
  // 俯视角：walk_up 要背面定妆照，没有就退回参考图写法
  const top = { ...ch, view: 'topdown' as const }
  assert.equal(actionFacing('topdown', 'walk_up'), 'back')
  assert.equal(actionFacing('topdown', 'attack_side'), 'side')
  assert.equal(actionFacing('topdown', 'hit'), 'front')
  assert.equal(actionFacing('side', 'hit'), 'side')
  const up = buildSpritePrompt(top, { name: 'walk_up', brief: '', params: DEFAULT_SPRITE_PARAMS })
  assert.equal(up.firstFrame, null)
  assert.match(up.prompt, /参考图中的角色/)
})

let heroId = ''
await test('文件夹导入：视频是动作并自动分组，图片是人物素材、第一张当主图', async () => {
  await video(src('hero'), 'hero_idle.mp4')
  await video(src('hero'), 'hero_attack.mp4')
  await png(src('hero'), 'hero_front.png', 10)
  const r = await sprites.importFiles(null, [src('hero')])
  assert.equal(r.created.length, 1)
  const c = r.created[0]
  heroId = c.id
  assert.equal(c.name, 'hero')
  assert.deepEqual(c.actions.map((a) => a.name), ['attack', 'idle'])
  assert.deepEqual(c.groups.map((g) => g.name), ['移动', '攻击'])
  assert.equal(c.actions.find((a) => a.name === 'idle')?.group, c.groups[0].id)
  assert.equal(c.refs.length, 1)
  assert.equal(c.mainRef, c.refs[0].id)
  assert.deepEqual([c.refs[0].width, c.refs[0].height], [8, 12])
  assert.equal(r.refs, 1)
  assert.ok(await sprites.refPath(null, c.id, c.refs[0].id))
})

await test('套用模板：补上分组和待生成动作，已有同名动作不重复，视角改成模板的', async () => {
  const c = await sprites.applyTemplate(null, heroId, 'topdown4')
  assert.equal(c.view, 'topdown')
  assert.ok(c.actions.some((a) => a.name === 'walk_down' && a.video === '' && a.takes.length === 0))
  assert.equal(c.actions.filter((a) => a.name === 'idle').length, 1)
  assert.deepEqual(c.groups.map((g) => g.name), ['移动', '攻击', '受击'])
  assert.equal(c.actions.find((a) => a.name === 'attack_side')?.params.kind, 'once')
})

await test('拖进当前角色：名字对上的补上待生成，对不上的单个视频放进选中的动作', async () => {
  const before = await sprites.getCharacter(null, heroId)
  const walkUp = before.actions.find((a) => a.name === 'walk_up')!
  const r = await sprites.importFiles(null, [await video(src('dl'), 'hero_walk_side_v2.mp4'), await video(src('dl'), 'kling_20251102_88.mp4')], {
    target: { id: heroId, actionId: walkUp.id }
  })
  assert.equal(r.created.length, 0)
  assert.deepEqual(
    r.placed.map((p) => [p.action, p.how]),
    [['walk_side', 'filled'], ['walk_up', 'filled']]
  )
  const c = r.merged[0]
  assert.equal(c.actions.find((a) => a.name === 'walk_up')?.sourceName, 'kling_20251102_88.mp4')
})

await test('同名视频再导入是新版本并切过去；切回旧版本时片段起止和换帧记录各自恢复', async () => {
  let c = await sprites.getCharacter(null, heroId)
  const idle = c.actions.find((a) => a.name === 'idle')!
  c = await sprites.updateAction(null, heroId, idle.id, { params: { start: 5, end: 30 }, edits: [{ from: 7, to: null }] })
  const r = await sprites.addToCharacter(null, heroId, [await video(src('dl2'), 'hero_idle (1).mp4')])
  assert.deepEqual(r.placed.map((p) => p.how), ['take'])
  c = r.character
  let a = c.actions.find((x) => x.id === idle.id)!
  assert.equal(a.takes.length, 2)
  assert.equal(a.sourceName, 'hero_idle (1).mp4')
  assert.equal(a.params.start, null)
  assert.deepEqual(a.edits, [])
  c = await sprites.useTake(null, heroId, idle.id, a.takes[0].id)
  a = c.actions.find((x) => x.id === idle.id)!
  assert.equal(a.sourceName, 'hero_idle.mp4')
  assert.deepEqual([a.params.start, a.params.end], [5, 30])
  assert.deepEqual(a.edits, [{ from: 7, to: null }])
  const again = await sprites.addToCharacter(null, heroId, [src('hero', 'hero_idle.mp4')])
  assert.equal(again.placed.length, 0)
  assert.match(again.skipped[0].reason, /已经有这个视频/)
})

await test('拆版本成单独动作；删光版本变回待生成，视频移走', async () => {
  let c = await sprites.getCharacter(null, heroId)
  const idle = c.actions.find((a) => a.name === 'idle')!
  c = await sprites.splitTake(null, heroId, idle.id, idle.takes[1].id)
  const split = c.actions.find((a) => a.name === 'idle_2')!
  assert.equal(split.group, idle.group)
  assert.equal(split.sourceName, 'hero_idle (1).mp4')
  assert.equal(c.actions.find((a) => a.id === idle.id)!.takes.length, 1)
  c = await sprites.deleteTake(null, heroId, split.id, split.takes[0].id)
  const after = c.actions.find((a) => a.id === split.id)!
  assert.equal(after.video, '')
  assert.equal(after.takes.length, 0)
  assert.equal(await sprites.videoPath(null, heroId, split.id), null)
})

await test('零散文件：没有选中角色、名字也对不上时建新角色；名字对上已有角色时加进去', async () => {
  const r = await sprites.importFiles(null, [await video(src('slime'), 'slime_idle.mp4'), await video(src('slime'), 'slime_hit.mp4')])
  assert.equal(r.created[0]?.name, 'slime')
  const r2 = await sprites.importFiles(null, [await video(src('x'), 'slime_death.mp4')], { target: { id: heroId, actionId: null } })
  assert.equal(r2.created.length, 0)
  assert.equal(r2.merged[0]?.name, 'slime')
  assert.deepEqual(r2.placed.map((p) => p.action), ['death'])
})

await test('只拖进人物图：加进选中角色的人物素材；删主图后主图换成下一张', async () => {
  const r = await sprites.importFiles(null, [await png(src('art'), '三视图.png', 99)], { target: { id: heroId, actionId: null } })
  assert.equal(r.refs, 1)
  let c = r.merged[0]
  assert.equal(c.refs.length, 2)
  assert.equal(c.refs[1].name, '三视图')
  c = await sprites.deleteRef(null, heroId, c.mainRef!)
  assert.equal(c.refs.length, 1)
  assert.equal(c.mainRef, c.refs[0].id)
})

await test('分组：删掉分组后里面的动作变成未分组；新建待生成动作按名字自动归组', async () => {
  let c = await sprites.getCharacter(null, heroId)
  const hitGroup = c.groups.find((g) => g.name === '受击')!
  c = await sprites.updateCharacter(null, heroId, { groups: c.groups.filter((g) => g !== hitGroup) })
  assert.equal(c.actions.find((a) => a.name === 'death')?.group, null)
  c = await sprites.addPlanned(null, heroId, ['victory', 'jump', 'idle'], null)
  assert.equal(c.groups.find((g) => g.id === c.actions.find((a) => a.name === 'victory')?.group)?.name, '交互')
  assert.equal(c.actions.filter((a) => a.name === 'idle').length, 1)
})

await test('早期的角色文件（没有分组和版本）：读出时补上固定的分组和唯一版本', async () => {
  const dir = join(root, 'data', 'library', 'sprites', 'old1')
  await mkdir(join(dir, 'videos'), { recursive: true })
  await writeFile(join(dir, 'videos', 'v1.mp4'), Buffer.alloc(10))
  await writeFile(
    join(dir, 'character.json'),
    JSON.stringify({ name: 'old', settings: {}, actions: [{ id: 'a1', name: 'run', video: 'v1.mp4', sourceName: 'run.mp4', bytes: 10, params: { start: 3 }, edits: [] }] })
  )
  const c = await sprites.getCharacter(null, 'old1')
  assert.deepEqual(c.groups, [{ id: 'grp-move', name: '移动' }])
  assert.equal(c.actions[0].group, 'grp-move')
  assert.deepEqual(c.actions[0].takes.map((t) => [t.video, t.start]), [['v1.mp4', 3]])
  assert.equal(c.settings.paletteFrom, 'video')
  // 再读一次分组 id 不变；改一次之后写进文件
  assert.equal((await sprites.getCharacter(null, 'old1')).groups[0].id, 'grp-move')
  await sprites.updateCharacter(null, 'old1', { description: '老角色' })
  const saved = JSON.parse(await readFile(join(dir, 'character.json'), 'utf8'))
  assert.equal(saved.groups[0].id, 'grp-move')
  assert.equal(saved.description, '老角色')
})

await test('从同一视频再抽一个动作：共用视频文件，片段各自独立；还有动作在用时删动作不移走视频', async () => {
  let c = await sprites.getCharacter(null, heroId)
  const idle = c.actions.find((a) => a.name === 'idle')!
  await sprites.updateAction(null, heroId, idle.id, { params: { ...idle.params, start: 2, end: 20 } })
  c = await sprites.extractAction(null, heroId, idle.id, 'idle_blink', undefined)
  const blink = c.actions.find((a) => a.name === 'idle_blink')!
  assert.equal(c.actions.indexOf(blink), c.actions.findIndex((a) => a.id === idle.id) + 1)
  assert.equal(blink.video, idle.video)
  assert.equal(blink.group, idle.group)
  assert.deepEqual([blink.params.start, blink.params.end], [null, null])
  assert.equal(blink.params.key, idle.params.key)
  await assert.rejects(sprites.extractAction(null, heroId, idle.id, 'IDLE_BLINK', undefined), /已经有/)
  c = await sprites.extractAction(null, heroId, idle.id, 'slash2', 'auto')
  assert.equal(c.groups.find((g) => g.id === c.actions.find((a) => a.name === 'slash2')!.group)?.name, '攻击')
  // 删原动作：视频还被另外两个动作用着
  c = await sprites.deleteAction(null, heroId, idle.id)
  assert.ok(await sprites.videoPath(null, heroId, blink.id))
  c = await sprites.deleteAction(null, heroId, blink.id)
  const slash2 = c.actions.find((a) => a.name === 'slash2')!
  const path = await sprites.videoPath(null, heroId, slash2.id)
  assert.ok(path)
  c = await sprites.deleteAction(null, heroId, slash2.id)
  assert.equal(c.actions.some((a) => a.video === blink.video), false)
  await assert.rejects(readFile(path!))
})

await test('导出存进 2D 资产库：带上人物图、人物描述和分组；从资产再做成角色时人物图回来', async () => {
  const assets2d = await import('../../src/main/assets2d')
  await sprites.updateCharacter(null, heroId, { description: '红发剑士', exportPrefs: { updateAssets: false, toAssets2D: true } })
  const frame = (): Uint8Array => new Uint8Array(4 * 6 * 4).fill(200)
  const action = (name: string, group: string) => ({
    name, loop: true, fps: 8, frameWidth: 4, frameHeight: 6, pivot: [2, 6], cols: 2,
    frames: [frame(), frame()], sourceFrames: [0, 1], meta: { group }
  })
  const payload = {
    palette: ['#c8c8c8'], pixelScale: 1, exportScale: 1,
    canvas: { width: 4, height: 6, pivot: [2, 6] },
    actions: [action('idle', '移动'), action('attack', '攻击')], report: null
  }
  const r = { asset2d: (await sprites.exportCharacter(null, heroId, payload, null, 'test')).assets2d[0] }
  assert.ok(r.asset2d)
  const dir = assets2d.asset2dDir(r.asset2d.id)
  const json = JSON.parse(await readFile(join(dir, 'asset.json'), 'utf8'))
  assert.deepEqual(json.references, ['refs/三视图.png'])
  assert.equal(json.description, '红发剑士')
  assert.deepEqual(json.animations.map((a: { name: string; group?: string }) => [a.name, a.group]), [['idle', '移动'], ['attack', '攻击']])
  assert.deepEqual(r.asset2d.references, ['refs/三视图.png'])
  assert.deepEqual(r.asset2d.animations.map((a) => a.group), ['移动', '攻击'])
  const images = await assets2d.characterImages(r.asset2d.id)
  assert.deepEqual(images, [join(dir, 'refs/三视图.png')])
  const c = await sprites.createFromImages(null, r.asset2d.name, images, r.asset2d.id)
  assert.equal(c.refs[0].name, '三视图')
  assert.equal(c.asset2dId, r.asset2d.id)
  assert.notEqual(c.name, 'hero')
})

await test('每个动作单独存进 2D 资产库：名称可配，再次导出更新同一个资产；整个角色的资产也能改名', async () => {
  const assets2d = await import('../../src/main/assets2d')
  let c = await sprites.updateCharacter(null, heroId, { exportPrefs: { updateAssets: false, toAssets2D: true, assets2dMode: 'action' } })
  const acts = c.actions.filter((a) => a.video).slice(0, 2)
  assert.equal(acts.length, 2)
  const frame = (): Uint8Array => new Uint8Array(4 * 6 * 4).fill(120)
  const payload = {
    palette: ['#787878'], pixelScale: 1, exportScale: 1,
    canvas: { width: 4, height: 6, pivot: [2, 6] },
    actions: acts.map((a) => ({ actionId: a.id, name: a.name, loop: true, fps: 8, frameWidth: 4, frameHeight: 6, pivot: [2, 6], cols: 2, frames: [frame(), frame()], sourceFrames: [0, 1], meta: {} })),
    report: { actions: acts.map((a) => ({ name: a.name })) }
  }
  const r = await sprites.exportCharacter(null, heroId, payload, null, 'test', { actions: { [acts[0].id]: '剑士 起手' } })
  assert.equal(r.assets2d.length, 2)
  assert.deepEqual(r.assets2d.map((x) => x.name), ['剑士 起手', `${c.name} · ${acts[1].name}`])
  assert.deepEqual(r.assets2d.map((x) => x.animations.map((a) => a.name)), [[acts[0].name], [acts[1].name]])
  const report = JSON.parse(await readFile(join(assets2d.asset2dDir(r.assets2d[0].id), `${c.name}_${acts[0].name}`, 'report.json'), 'utf8').catch(() => readFile(join(assets2d.asset2dDir(r.assets2d[0].id), 'report.json'), 'utf8')))
  assert.deepEqual(report.actions.map((x: { name: string }) => x.name), [acts[0].name])
  assert.deepEqual(r.character.actions.filter((a) => a.asset2dId).map((a) => a.asset2dId), r.assets2d.map((x) => x.id))
  // 再导出：同样两个资产，没给名称时保留库里的名称；给了就改
  const again = await sprites.exportCharacter(null, heroId, payload, null, 'test', { actions: { [acts[1].id]: '剑士 收招' } })
  assert.deepEqual(again.assets2d.map((x) => x.id), r.assets2d.map((x) => x.id))
  assert.deepEqual(again.assets2d.map((x) => x.name), ['剑士 起手', '剑士 收招'])
  // 整个角色一个资产：改名
  c = await sprites.updateCharacter(null, heroId, { exportPrefs: { assets2dMode: 'character' } })
  const whole = await sprites.exportCharacter(null, heroId, payload, null, 'test', { character: '剑士（全套）' })
  assert.equal(whole.assets2d.length, 1)
  assert.equal(whole.assets2d[0].name, '剑士（全套）')
  assert.equal(whole.character.asset2dId, whole.assets2d[0].id)
  const kept = await sprites.exportCharacter(null, heroId, payload, null, 'test')
  assert.equal(kept.assets2d[0].name, '剑士（全套）')
})

await test('定妆照：存成人物素材、同朝向替换旧的（主图跟着换）、原图不动直接拷贝、删源图后 from 清空、首帧图设置校验', async () => {
  let c = await sprites.createFromImages(null, '骑士', [await png(src('anchor'), 'knight.png', 30)], null)
  const cid = c.id
  const srcRef = c.refs[0]
  const rgba = new Uint8Array(32 * 18 * 4).fill(200)
  c = await sprites.saveAnchor(null, cid, 'side', srcRef.id, encodePng(rgba, 32, 18))
  const a1 = c.refs.find((r) => r.facing === 'side')
  assert.ok(a1)
  assert.equal(a1.from, srcRef.id)
  assert.deepEqual([a1.width, a1.height], [32, 18])
  assert.equal(a1.name, '定妆照·侧面')
  // 定妆照设成主图，再重做：旧的那张删掉，主图换成新的
  c = await sprites.updateCharacter(null, cid, { mainRef: a1.id })
  c = await sprites.saveAnchor(null, cid, 'side', a1.id, encodePng(new Uint8Array(16 * 9 * 4).fill(90), 16, 9))
  const a2 = c.refs.find((r) => r.facing === 'side')
  assert.ok(a2 && a2.id !== a1.id)
  assert.equal(a2.from, srcRef.id, '用旧定妆照重做时 from 沿用原来的')
  assert.equal(c.mainRef, a2.id)
  assert.equal(c.refs.filter((r) => r.facing === 'side').length, 1)
  assert.equal(await sprites.refPath(null, cid, a1.id), null)
  // 原图不动：直接拷贝那张人物图
  c = await sprites.saveAnchor(null, cid, 'front', srcRef.id, null)
  const front = c.refs.find((r) => r.facing === 'front')
  assert.ok(front && front.bytes === srcRef.bytes)
  await assert.rejects(sprites.saveAnchor(null, cid, 'top', srcRef.id, null), /朝向/)
  // 删掉源图：定妆照留着，from 清空
  c = await sprites.deleteRef(null, cid, srcRef.id)
  assert.ok(c.refs.every((r) => r.from === null))
  assert.equal(c.refs.length, 2)
  // 首帧图设置：不认识的值退回默认，人物大小限制在 40%–80%
  c = await sprites.updateCharacter(null, cid, { frameSetup: { aspect: '21:9', fill: 0.95, screen: 'magenta' } })
  assert.deepEqual(c.frameSetup, { aspect: DEFAULT_FRAME_SETUP.aspect, fill: 0.8, screen: 'magenta' })
})

console.log(`\n${passed} 项序列帧角色测试通过`)
