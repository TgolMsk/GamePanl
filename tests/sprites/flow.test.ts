// 序列帧流程化：动作标签、重复下载去重、空角色、照搬动作清单、从「下载」收件、软件里生成（bl / codex 用假的脚本代替）。
// node_modules/.bin/esbuild tests/sprites/flow.test.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --alias:@renderer=./src/renderer/src --alias:electron=./tests/stubs/electron.ts --outfile=/tmp/gp-flow.mjs && node /tmp/gp-flow.mjs
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'gp-flow-'))
process.env['GAMEPANL_DATA_ROOT'] = join(root, 'data')
process.env['GAMEPANL_STUB_PATHS'] = join(root, 'sys')
process.env['GAMEPANL_INBOX_DIR'] = join(root, 'Downloads')
process.env['CODEX_HOME'] = join(root, 'codex-home')
await mkdir(join(root, 'Downloads'), { recursive: true })

const shared = await import('@shared/sprites')
const { actionFromTag, actionTag, buildAnchorPrompt, buildDesignPrompt, buildSpritePrompt, DEFAULT_FRAME_SETUP, DEFAULT_SPRITE_PARAMS, fileNameTokens, stripCopySuffix } = shared
const sprites = await import('../../src/main/sprites')
const { encodePng } = await import('../../src/main/spriteExport')
const { connectSpriteEvents } = await import('../../src/main/spriteEvents')
const inbox = await import('../../src/main/spriteInbox')
const gen = await import('../../src/main/spriteGen')
const { imageInfo } = await import('../../src/main/images')
import type { SpriteEvent } from '../../src/shared/spriteGen'

let passed = 0
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn()
  passed++
  console.log(`通过：${name}`)
}

const events: SpriteEvent[] = []
let changed = 0
connectSpriteEvents((e) => events.push(e), () => changed++)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until(what: string, ok: () => Promise<boolean> | boolean, ms = 15000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await ok()) return
    await sleep(100)
  }
  assert.fail(`等不到：${what}`)
}
let seq = 0
async function video(dir: string, name: string, size = 100 + ++seq): Promise<string> {
  await mkdir(dir, { recursive: true })
  const p = join(dir, name)
  await writeFile(p, Buffer.alloc(size))
  return p
}
function pngBuf(color: number, w = 16, h = 9): Buffer {
  const rgba = new Uint8Array(w * h * 4).fill(255)
  for (let i = 0; i < rgba.length; i += 4) rgba[i] = color
  return encodePng(rgba, w, h)
}
const act = (id: string, name: string) => ({ id, name, brief: '', params: DEFAULT_SPRITE_PARAMS })

await test('动作标签：英文名直接用、中文名用 act- 加 id；提示词第一行是标签', () => {
  assert.equal(actionTag({ id: 'abcdef123456', name: 'attack1' }), 'attack1')
  assert.equal(actionTag({ id: 'abcdef123456', name: '蓄力斩' }), 'act-abcdef')
  assert.equal(actionTag({ id: 'abcdef123456', name: 'walk down' }), 'act-abcdef')
  const p = buildSpritePrompt({ description: '红发剑士', view: 'side', promptExtra: '', refs: [], frameSetup: DEFAULT_FRAME_SETUP }, act('x1', 'attack1'))
  assert.equal(p.prompt.split('\n')[0], '[attack1]')
})

await test('文件名认标签：Muse、即梦的下载名，长标签优先、靠前的优先，中文标点也拆开', () => {
  const actions = [act('a1', 'walk'), act('a2', 'walk_down'), act('a3', 'attack1'), act('abcdef9', '蓄力斩'), act('a5', 'idle')]
  const find = (f: string): string | undefined => actionFromTag(f, actions)?.name
  assert.equal(find('media-generation-attack1-2D-Q-3-15-90-90-00FF00-2D-1-0c9a1e2f.mp4'), 'attack1')
  assert.equal(find('media-generation-walk-down-2D-1-uuid.mp4'), 'walk_down')
  assert.equal(find('media-generation-walk-2D-1-uuid.mp4'), 'walk')
  assert.equal(find('jimeng-2026-11-02-1234-[attack1]首帧图中的角色.mp4'), 'attack1')
  assert.equal(find('jimeng-2026-11-02-1234-[attack1]，首帧图.mp4'), 'attack1')
  assert.equal(find('media-generation-act-abcdef-1-uuid.mp4'), '蓄力斩')
  assert.equal(find('media-generation-idle-attack1-uuid.mp4'), 'idle')
  assert.equal(find('Attack1.MP4'), 'attack1')
  assert.equal(find('attack10.mp4'), undefined)
  assert.equal(find('kling_20251102_123456.mp4'), undefined)
  assert.deepEqual(fileNameTokens('a【b】c，d。e.mp4'), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(stripCopySuffix('run (1).mp4'), 'run.mp4')
  assert.equal(stripCopySuffix('run（12）.mp4'), 'run.mp4')
  assert.equal(stripCopySuffix('run (1234).mp4'), 'run (1234).mp4')
  assert.equal(stripCopySuffix('run.mp4'), 'run.mp4')
})

await test('设定图提示词：从零画、带项目风格和朝向；定妆照提示词照参考图画', () => {
  const ch = { description: '红发少年剑士，蓝色短披风', view: 'side' as const, promptExtra: '16-bit 像素风', frameSetup: DEFAULT_FRAME_SETUP }
  const d = buildDesignPrompt(ch, 'side', '赛博朋克霓虹')
  assert.match(d, /红发少年剑士/)
  assert.match(d, /【风格】赛博朋克霓虹/)
  assert.match(d, /16-bit 像素风/)
  assert.doesNotMatch(d, /参考图/)
  const blank = buildDesignPrompt({ ...ch, description: '' }, 'front', '水彩')
  assert.match(blank, /一个原创的游戏角色/)
  assert.doesNotMatch(buildDesignPrompt(ch, 'side'), /【风格】/)
  assert.match(buildAnchorPrompt(ch, 'side'), /参考图中的角色/)
})

let heroId = ''
await test('空角色：名字自动编号、可以指定；全局库默认身高和风格为空', async () => {
  const a = await sprites.createBlank(null, undefined)
  const b = await sprites.createBlank(null, null)
  const c = await sprites.createBlank(null, '勇者')
  assert.equal(a.name, '角色 1')
  assert.equal(b.name, '角色 2')
  assert.equal(c.name, '勇者')
  assert.equal((await sprites.createBlank(null, '勇者')).name, '勇者_2')
  assert.equal(c.refs.length + c.actions.length, 0)
  assert.equal((await sprites.getCharacter(null, c.id)).name, '勇者')
  assert.equal(await sprites.defaultHeight(null), undefined)
  assert.equal(await sprites.stylePrompt(null), '')
  heroId = c.id
})

await test('粘贴的图：加进人物素材当主图、同一张不重复；没有角色时新建', async () => {
  const buf = pngBuf(200)
  const cand = { buf, info: imageInfo(buf)!, name: '粘贴的图片' }
  const r = await sprites.addRefImage(null, heroId, cand)
  assert.ok(r.ref)
  assert.equal(r.character.mainRef, r.ref!.id)
  assert.equal((await sprites.addRefImage(null, heroId, cand)).ref, null)
  const fresh = await sprites.addRefImage(null, null, { ...cand, buf: pngBuf(10), info: imageInfo(pngBuf(10))! }, 48)
  assert.ok(fresh.ref)
  assert.equal(fresh.character.settings.height, 48)
  assert.equal(fresh.character.mainRef, fresh.ref!.id)
  await assert.rejects(sprites.addRefImage(null, heroId, { ...cand, info: { ...cand.info, ext: 'gif' } }), /只支持/)
})

await test('重复下载的「 (1)」不算新视频；版本记下提示词和来源', async () => {
  const dir = join(root, 'src-dup')
  const first = await video(dir, 'hero_run.mp4', 5000)
  const r = await sprites.addToCharacter(null, heroId, [first])
  assert.equal(r.placed.length, 1)
  const again = await video(join(dir, 'again'), 'hero_run (1).mp4', 5000)
  const r2 = await sprites.addToCharacter(null, heroId, [again])
  assert.equal(r2.placed.length, 0)
  assert.match(r2.skipped[0].reason, /已经有这个视频/)
  const run = r.character.actions.find((a) => a.name === 'run')!
  assert.equal(run.takes[0].via, 'file')
  assert.equal(run.takes[0].prompt, '')
  const other = await video(dir, 'other.mp4', 5001)
  const t = await sprites.addTakeFile(null, heroId, run.id, other, { prompt: '[run]\n跑', via: 'inbox' }, false)
  assert.ok(t)
  assert.equal(t!.take.prompt, '[run]\n跑')
  assert.equal(t!.take.via, 'inbox')
  assert.notEqual(t!.action.video, t!.take.video, '已有视频且不要求切换时不切')
  assert.equal(await sprites.addTakeFile(null, heroId, run.id, other, { prompt: '', via: 'inbox' }, true), null, '同一个视频再收一次跳过')
  const back = await sprites.getCharacter(null, heroId)
  const saved = back.actions.find((a) => a.id === run.id)!.takes.find((x) => x.id === t!.take.id)!
  assert.equal(saved.prompt, '[run]\n跑')
  assert.equal(saved.via, 'inbox')
})

await test('照搬动作清单：分组、动作名、说明、循环 / 单次和视角；同名的只补空着的；自己和空角色报错', async () => {
  const src = await sprites.createBlank(null, '模板角色')
  await sprites.applyTemplate(null, src.id, 'topdown4')
  const s0 = await sprites.getCharacter(null, src.id)
  const first = s0.actions[0]
  await sprites.updateAction(null, src.id, first.id, { brief: '原地踏步' })
  const dst = await sprites.createBlank(null, '新角色')
  await sprites.addPlanned(null, dst.id, [first.name], null)
  const r = await sprites.applyActionList(null, dst.id, null, src.id)
  const s = await sprites.getCharacter(null, src.id)
  assert.equal(r.view, s.view)
  assert.deepEqual(r.actions.map((a) => a.name).sort(), s.actions.map((a) => a.name).sort())
  assert.deepEqual(r.groups.map((g) => g.name), s.groups.map((g) => g.name))
  assert.equal(r.actions.find((a) => a.name === first.name)!.brief, '原地踏步')
  for (const a of s.actions) assert.equal(r.actions.find((x) => x.name === a.name)!.params.kind, a.params.kind)
  assert.ok(r.actions.every((a) => !a.video))
  await assert.rejects(sprites.applyActionList(null, dst.id, null, dst.id), /同一个角色/)
  const empty = await sprites.createBlank(null, '空的')
  await assert.rejects(sprites.applyActionList(null, dst.id, null, empty.id), /还没有动作/)
})

await test('从「下载」收件：标签认动作、认不出放进最近复制的动作、图片进人物素材、旧文件和别的类型不收', async () => {
  const dl = join(root, 'Downloads')
  const c = await sprites.createBlank(null, '收件角色')
  const withActs = await sprites.addPlanned(null, c.id, ['idle', 'attack1', '蓄力斩'], null)
  const [idle, attack1, charge] = ['idle', 'attack1', '蓄力斩'].map((n) => withActs.actions.find((a) => a.name === n)!)
  await video(dl, 'media-generation-attack1-old-1-uuid.mp4', 7001)
  await inbox.expect(null, c.id, idle.id, 'IDLE PROMPT')
  await inbox.expect(null, c.id, attack1.id, 'ATTACK PROMPT')
  await inbox.expect(null, c.id, null, 'DESIGN PROMPT')
  assert.equal(inbox.waiting().length, 3)
  assert.ok(events.some((e) => e.type === 'waiting'))
  await video(dl, 'media-generation-attack1-2D-Q-1-0c9a.mp4', 7002)
  await video(dl, `media-generation-act-${charge.id.slice(0, 6)}-2D-1-x.mp4`, 7003)
  await video(dl, 'kling_20261102_120000.mp4', 7004)
  await writeFile(join(dl, 'design.png'), pngBuf(90))
  await writeFile(join(dl, 'notes.txt'), 'x')
  await writeFile(join(dl, 'big.mp4.crdownload'), Buffer.alloc(10))
  await until('四个文件都收进来', async () => events.filter((e) => e.type === 'inbox').length >= 4)
  const after = await sprites.getCharacter(null, c.id)
  const takes = (id: string) => after.actions.find((a) => a.id === id)!.takes
  assert.equal(takes(attack1.id).length, 2, 'attack1：带标签的那个，加上认不出标签的放进最近复制的动作（attack1）')
  assert.deepEqual(takes(attack1.id).map((t) => t.prompt).sort(), ['ATTACK PROMPT', 'ATTACK PROMPT'])
  assert.equal(takes(charge.id).length, 1, '中文动作名用 act- 标签认出来')
  assert.equal(takes(charge.id)[0].prompt, '', '没复制过这个动作的提示词')
  assert.equal(takes(idle.id).length, 0)
  assert.ok(after.actions.find((a) => a.id === attack1.id)!.video, '收进来的视频切成当前版本')
  assert.equal(after.refs.length, 1)
  assert.equal(after.refs[0].name, 'design')
  assert.ok(takes(attack1.id).every((t) => t.via === 'inbox'))
  // 下载两次的同一个视频不再收
  const n = events.filter((e) => e.type === 'inbox').length
  await video(dl, 'media-generation-attack1-2D-Q-1-0c9a (1).mp4', 7002)
  await sleep(5000)
  assert.equal(events.filter((e) => e.type === 'inbox').length, n)
  inbox.stopInbox()
  assert.equal(inbox.waiting().length, 0)
})

// ---------- 软件里生成：假的 bl、codex ----------

const bin = join(root, 'bin')
await mkdir(bin, { recursive: true })
const blLog = join(root, 'bl-args.json')
await writeFile(join(bin, 'bl'), `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
const get = (k) => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1] }
const log = ${JSON.stringify(blLog)}
const list = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : []
list.push(args)
fs.writeFileSync(log, JSON.stringify(list))
const prompt = get('--prompt') || ''
if (prompt.includes('审核')) { process.stderr.write('Error: content filter\\n'); process.exit(10) }
if (prompt.includes('慢慢来')) { setTimeout(() => {}, 60000); return }
fs.writeFileSync(get('--download'), Buffer.alloc(3000 + list.length))
console.log(JSON.stringify({ task_id: 't' + list.length, status: 'SUCCEEDED', saved: get('--download') }))
`)
await writeFile(join(bin, 'codex'), `#!/usr/bin/env node
const fs = require('fs'); const path = require('path')
const home = process.env.CODEX_HOME
const id = 'thread-' + Date.now()
console.log(JSON.stringify({ type: 'thread.started', thread_id: id }))
const dir = path.join(home, 'generated_images', id)
fs.mkdirSync(dir, { recursive: true })
fs.copyFileSync(${JSON.stringify(join(root, 'codex.png'))}, path.join(dir, 'exec-1.png'))
fs.writeFileSync(${JSON.stringify(join(root, 'codex-args.json'))}, JSON.stringify(process.argv.slice(2)))
console.log(JSON.stringify({ type: 'turn.completed' }))
`)
await writeFile(join(root, 'codex.png'), pngBuf(30, 32, 18))
await chmod(join(bin, 'bl'), 0o755)
await chmod(join(bin, 'codex'), 0o755)
process.env['GAMEPANL_BL'] = join(bin, 'bl')
process.env['GAMEPANL_CODEX'] = join(bin, 'codex')

const jobOf = (id: string) => gen.listJobs().find((j) => j.id === id)!

await test('生成视频：定妆照当首帧（单次动作首尾帧）、参数照设置、做好放进动作；没定妆照不让生成', async () => {
  const c = await sprites.createBlank(null, '生成角色')
  const planned = await sprites.addPlanned(null, c.id, ['attack1', 'idle'], null)
  const attack1 = planned.actions.find((a) => a.name === 'attack1')!
  const idle = planned.actions.find((a) => a.name === 'idle')!
  await assert.rejects(gen.generateVideos(null, c.id, [attack1.id], 1), /定妆照还没做/)
  await sprites.saveAnchor(null, c.id, 'side', null, pngBuf(60, 32, 18))
  assert.equal((await gen.tools()).bl, join(bin, 'bl'))
  const jobs = await gen.generateVideos(null, c.id, [attack1.id, idle.id], 2)
  assert.equal(jobs.length, 4)
  assert.ok(jobs.every((j) => j.cost === 1.2), '480P × 4 秒 × 0.3 元')
  await until('四个视频都生成完', () => jobs.every((j) => jobOf(j.id).state === 'done'))
  const after = await sprites.getCharacter(null, c.id)
  const a1 = after.actions.find((a) => a.id === attack1.id)!
  assert.equal(a1.takes.length, 2)
  assert.ok(a1.video, '第一个做好的版本成为当前版本')
  assert.ok(a1.takes.every((t) => t.via === 'generate' && t.prompt.startsWith('[attack1]')))
  assert.equal(jobOf(jobs[0].id).resultId !== null, true)
  const calls = JSON.parse(await readFile(blLog, 'utf8')) as string[][]
  const flag = (args: string[], k: string): string | null => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
  const onceCall = calls.find((x) => flag(x, '--prompt')!.startsWith('[attack1]'))!
  const loopCall = calls.find((x) => flag(x, '--prompt')!.startsWith('[idle]'))!
  assert.equal(flag(onceCall, '--model'), 'wan3.0-video')
  assert.equal(flag(onceCall, '--resolution'), '480P')
  assert.equal(flag(onceCall, '--duration'), '4')
  assert.equal(flag(onceCall, '--watermark'), 'false')
  assert.equal(flag(onceCall, '--prompt-extend'), 'false')
  assert.equal(flag(onceCall, '--last-frame'), flag(onceCall, '--image'), '单次动作首尾帧是同一张定妆照')
  assert.equal(flag(loopCall, '--last-frame'), null, '循环动作只用首帧')
  assert.ok(flag(onceCall, '--negative-prompt'))
  assert.ok(events.some((e) => e.type === 'jobs'))
})

await test('生成失败给出原因；取消排队和运行中的任务；清掉已结束的', async () => {
  const c = await sprites.createBlank(null, '失败角色')
  await sprites.saveAnchor(null, c.id, 'side', null, pngBuf(61, 32, 18))
  const p = await sprites.addPlanned(null, c.id, ['idle', 'run'], null)
  const idle = p.actions.find((a) => a.name === 'idle')!
  const run = p.actions.find((a) => a.name === 'run')!
  await sprites.updateAction(null, c.id, idle.id, { brief: '审核不过的动作' })
  const [bad] = await gen.generateVideos(null, c.id, [idle.id], 1)
  await until('失败', () => jobOf(bad.id).state === 'failed')
  assert.match(jobOf(bad.id).message, /内容审核没通过/)
  await sprites.updateAction(null, c.id, run.id, { brief: '慢慢来' })
  const slow = await gen.generateVideos(null, c.id, [run.id], 4)
  await until('前两个开始跑', () => slow.filter((j) => jobOf(j.id).state === 'running').length === 2)
  assert.equal(jobOf(slow[2].id).state, 'queued', '同时最多跑两个')
  gen.cancelJob(slow[3].id)
  assert.equal(jobOf(slow[3].id).state, 'canceled')
  for (const j of slow.slice(0, 3)) gen.cancelJob(j.id)
  await until('都取消了', () => slow.every((j) => jobOf(j.id).state === 'canceled'))
  gen.clearJobs()
  assert.ok(gen.listJobs().every((j) => j.state === 'queued' || j.state === 'running'))
})

await test('codex 画人物图：按描述画、照主图画，放进人物素材；没描述也没风格时不画', async () => {
  const c = await sprites.createBlank(null, '画图角色')
  await assert.rejects(gen.generateImage(null, c.id, 'side', 'design'), /先写人物描述/)
  await assert.rejects(gen.generateImage(null, c.id, 'side', 'anchor'), /先添加一张人物图/)
  await sprites.updateCharacter(null, c.id, { description: '戴草帽的少女' })
  const job = await gen.generateImage(null, c.id, 'side', 'design')
  await until('画好', () => jobOf(job.id).state === 'done')
  const after = await sprites.getCharacter(null, c.id)
  assert.equal(after.refs.length, 1)
  assert.equal(after.refs[0].id, jobOf(job.id).resultId)
  assert.equal(after.refs[0].name, '设定图·侧面')
  assert.equal(after.mainRef, after.refs[0].id)
  const args = JSON.parse(await readFile(join(root, 'codex-args.json'), 'utf8')) as string[]
  assert.ok(args.includes('--json') && args.includes('read-only'))
  assert.ok(args.some((a) => a.includes('戴草帽的少女')))
  assert.ok(!args.includes('-i'), '按描述画不带参考图')
  const job2 = await gen.generateImage(null, c.id, 'side', 'anchor')
  await until('照主图画好', () => jobOf(job2.id).state === 'done' || jobOf(job2.id).state === 'failed')
  assert.equal(jobOf(job2.id).state, 'done', jobOf(job2.id).message)
  const after2 = await sprites.getCharacter(null, c.id)
  assert.equal(after2.refs.length, 2)
  assert.equal(after2.refs[1].name, '定妆照草稿·侧面')
  assert.equal(after2.mainRef, after.refs[0].id, '主图不变')
  const args2 = JSON.parse(await readFile(join(root, 'codex-args.json'), 'utf8')) as string[]
  assert.ok(args2.includes('-i'), '照主图画带上主图')
})

await test('生成设置：超出范围的值夹到范围里、不认识的模型用默认', () => {
  const s = gen.normalizeGenSettings({ videoModel: 'toString', resolution: '4K', duration: 99, takes: 0, concurrency: 2.6, inbox: 'yes' })
  assert.deepEqual(s, { videoModel: 'wan3.0-video', resolution: '480P', duration: 10, takes: 1, concurrency: 3, inbox: true })
})

gen.stopAllJobs()
console.log(`\n${passed} 项流程化测试通过`)
process.exit(0)
