// 主进程后端自检：在 Electron 里真实跑一遍全部接口。由 scripts/selftest.mjs 打包后启动，不要直接运行。
// 数据目录必须用环境变量 GAMEPANL_DATA_ROOT 指向一个测试目录（会被清空重建）。
import { app, BrowserWindow, clipboard, ClipboardItem, nativeImage, net, protocol } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, promises as fs, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { isDeepStrictEqual } from 'util'
import type { DataChange, LibImage, Note, NoteBlock, Project, ProjectAsset, ProjectSummary, Prompt, Style } from '../src/shared/types'
import { headerSize, imageInfo } from '../src/main/images'
import { registerIpc } from '../src/main/ipc'
import { parseNote, serializeNote } from '../src/main/notesmd'
import { registerImageProtocol } from '../src/main/protocol'
import { initStorage, paths } from '../src/main/storage'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gp',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

const ROOT = process.env['GAMEPANL_DATA_ROOT'] ? resolve(process.env['GAMEPANL_DATA_ROOT']) : ''
const PROJECT_DIR = process.env['GAMEPANL_PROJECT_DIR'] ?? ''
const MARKER = '.gamepanl-selftest'
if (ROOT) app.setPath('userData', join(dirname(ROOT), 'selftest-electron'))

// ---------- 小工具 ----------

let failed = 0
let passed = 0

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
    passed++
    console.log(`  ok    ${name}`)
  } catch (err) {
    failed++
    console.log(`  FAIL  ${name}\n        ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${msg}\n        实际: ${JSON.stringify(actual)}\n        期望: ${JSON.stringify(expected)}`)
  }
}

let win: BrowserWindow

/** 在界面里调用 window.gp 的方法，和真实界面走同一条 IPC 通道 */
async function gp<T>(method: string, ...args: unknown[]): Promise<T> {
  const r = (await win.webContents.executeJavaScript(
    `(async () => { try { return { ok: true, value: await window.gp.${method}(...${JSON.stringify(args)}) } } catch (e) { return { ok: false, error: String((e && e.message) || e) } } })()`
  )) as { ok: boolean; value?: T; error?: string }
  if (!r.ok) throw new Error(`${method} 失败: ${r.error}`)
  return r.value as T
}

/** 期望调用失败，返回错误信息 */
async function gpFails(method: string, ...args: unknown[]): Promise<string> {
  try {
    await gp(method, ...args)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error(`${method} 本应失败却成功了`)
}

async function takeEvents(): Promise<DataChange[]> {
  return (await win.webContents.executeJavaScript('window.__events.splice(0)')) as DataChange[]
}

function hasEvent(events: DataChange[], change: DataChange): boolean {
  return events.some((e) => isDeepStrictEqual(e, change))
}

/** 生成一张内容独特的 PNG */
function makePng(width: number, height: number, seed: number): Buffer {
  const buf = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = (i * 7 + seed * 31) & 0xff
    buf[i * 4 + 1] = (i * 13 + seed * 17) & 0xff
    buf[i * 4 + 2] = (seed * 101) & 0xff
    buf[i * 4 + 3] = 0xff
  }
  return nativeImage.createFromBitmap(buf, { width, height }).toPNG()
}

// 1×1 GIF，逻辑屏幕尺寸改成 3×2（用来检查宽高没有读反）
const GIF = (() => {
  const b = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  b.writeUInt16LE(3, 6)
  b.writeUInt16LE(2, 8)
  return b
})()
// 1×1 无损 WEBP
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

function webpHeader(chunk: 'VP8X' | 'VP8 ', width: number, height: number): Buffer {
  const b = Buffer.alloc(40)
  b.write('RIFF', 0, 'latin1')
  b.writeUInt32LE(32, 4)
  b.write('WEBP', 8, 'latin1')
  b.write(chunk, 12, 'latin1')
  if (chunk === 'VP8X') {
    b.writeUIntLE(width - 1, 24, 3)
    b.writeUIntLE(height - 1, 27, 3)
  } else {
    b[23] = 0x9d
    b[24] = 0x01
    b[25] = 0x2a
    b.writeUInt16LE(width, 26)
    b.writeUInt16LE(height, 28)
  }
  return b
}

async function fetchMain(url: string): Promise<{ status: number; type: string; body: Buffer }> {
  const res = await net.fetch(url)
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: Buffer.from(await res.arrayBuffer()) }
}

async function thumbFiles(): Promise<string[]> {
  return (await fs.readdir(paths.thumbs())).filter((n) => !n.startsWith('.'))
}

// ---------- 剪贴板：测试前保存，测试后恢复 ----------

type SavedClipboard = Array<Record<string, Blob>>

async function saveClipboard(): Promise<SavedClipboard> {
  const out: SavedClipboard = []
  for (const item of await clipboard.read()) {
    const rec: Record<string, Blob> = {}
    for (const t of item.types) {
      try {
        const v = await item.getType(t)
        if (v instanceof Blob) rec[t] = v
      } catch {
        // 读不出的格式跳过
      }
    }
    if (Object.keys(rec).length) out.push(rec)
  }
  return out
}

async function restoreClipboard(saved: SavedClipboard): Promise<void> {
  if (saved.length) await clipboard.write(saved.map((r) => new ClipboardItem(r)))
  else await clipboard.clear()
}

async function writeClipboardPng(png: Buffer): Promise<void> {
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
}

async function clipboardPngSize(): Promise<{ width: number; height: number } | null> {
  for (const item of await clipboard.read()) {
    if (!item.types.includes('image/png')) continue
    const blob = await item.getType('image/png')
    if (!(blob instanceof Blob)) continue
    return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize()
  }
  return null
}

// ---------- 笔记 Markdown 往返 ----------

function roundTripCases(pid: string): Note[] {
  const base = { createdAt: '2026-09-24T06:32:00.000Z', updatedAt: '2026-09-24T07:00:00.000Z' }
  const P = (id: string, text: string): NoteBlock => ({ id, type: 'p', text })
  const T = (id: string, text: string, checked: boolean): NoteBlock => ({ id, type: 'todo', text, checked })
  return [
    {
      id: 'n1',
      title: '核心玩法「提灯与雾」',
      category: '玩法',
      done: false,
      blocks: [
        P('b1', '一句话：灯油既是时间，也是记忆。'),
        { id: 'b2', type: 'image', image: { scope: 'project', projectId: pid, id: 'a5' } },
        T('b3', '每关 2–3 根灯柱', true),
        T('b4', '拨亮会把附近的雾妖引过来', false),
        { id: 'b5', type: 'image', image: { scope: 'library', id: 'lib-01_x' } },
        P('b6', '最后一段')
      ],
      ...base
    },
    {
      id: 'n2',
      title: '  前后有空格: 还有冒号 #号 ',
      category: '其他',
      done: true,
      blocks: [
        P('e1', ''),
        P('e2', '第一行\n\n第三行（中间有空行）\n   \n缩进行'),
        P('e3', '- [ ] 看起来像清单\n- [x] 也像\n![](gp-ref:library/abc)\n\\反斜杠开头\n<br>\n---'),
        T('e4', '', false),
        T('e5', '   前面有空格的清单项  ', true),
        P('e6', '\n前面有换行'),
        P('e7', '后面有换行\n'),
        P('e8', '<br>'),
        P('e9', '\\'),
        T('e10', '紧跟段落的清单', false),
        P('e11', '  两个空格开头'),
        P('e12', '')
      ],
      ...base
    },
    { id: 'n3', title: '', category: '故事', done: false, blocks: [], ...base },
    {
      id: 'n4',
      title: '"引号开头',
      category: '美术',
      done: false,
      blocks: [T('t1', 'a', false), T('t2', 'b', true), P('p1', 'x'), T('t3', 'c', false)],
      ...base
    }
  ]
}

// ---------- 主流程 ----------

async function prepareRoot(): Promise<void> {
  assert(ROOT, '请用环境变量 GAMEPANL_DATA_ROOT 指定测试数据目录')
  assert(ROOT !== resolve(homedir(), 'GamePanl'), '不能用真实数据目录 ~/GamePanl 做自检')
  if (existsSync(ROOT)) {
    const names = await fs.readdir(ROOT)
    assert(names.length === 0 || names.includes(MARKER), `${ROOT} 不是自检创建的目录，拒绝清空`)
    await fs.rm(ROOT, { recursive: true, force: true })
  }
  await fs.mkdir(ROOT, { recursive: true })
  await fs.writeFile(join(ROOT, MARKER), '')
}

async function run(): Promise<void> {
  await prepareRoot()
  const SRC = join(dirname(ROOT), `${ROOT.split('/').pop()}-src`)
  await fs.rm(SRC, { recursive: true, force: true })
  await fs.mkdir(SRC, { recursive: true })

  await initStorage()
  registerImageProtocol()
  registerIpc()

  win = new BrowserWindow({
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  await win.loadURL('data:text/html,<!doctype html><title>selftest</title>')
  await win.webContents.executeJavaScript(
    'window.__events = []; window.gp.onDataChanged((c) => window.__events.push(c)); true'
  )

  const savedClipboard = await saveClipboard()
  try {
    await runTests(SRC)
  } finally {
    await restoreClipboard(savedClipboard)
  }
}

async function runTests(SRC: string): Promise<void> {
  const sampleImages = join(app.getAppPath(), 'resources', 'sample', 'images')

  console.log('\n[纯逻辑]')
  await test('图片文件头：PNG / JPEG / GIF / WEBP 宽高', async () => {
    eq(headerSize(makePng(40, 30, 1), 'PNG'), { width: 40, height: 30 }, 'PNG')
    eq(headerSize(await fs.readFile(join(sampleImages, 'scene_harbor.jpg')), 'JPG'), { width: 1200, height: 800 }, 'JPEG')
    eq(headerSize(GIF, 'GIF'), { width: 3, height: 2 }, 'GIF')
    eq(headerSize(WEBP, 'WEBP'), { width: 1, height: 1 }, 'WEBP 无损')
    eq(headerSize(webpHeader('VP8X', 100, 50), 'WEBP'), { width: 100, height: 50 }, 'WEBP 扩展')
    eq(headerSize(webpHeader('VP8 ', 70, 20), 'WEBP'), { width: 70, height: 20 }, 'WEBP 有损')
    eq(imageInfo(Buffer.from('not an image')), null, '非图片')
    eq(imageInfo(WEBP)?.format, 'WEBP', 'WEBP 识别')
    eq(imageInfo(GIF)?.format, 'GIF', 'GIF 识别')
  })

  await test('笔记 Markdown：解析与序列化往返一致', () => {
    for (const note of roundTripCases('proj1')) {
      const md = serializeNote(note)
      const back = parseNote(md, 'proj1', { id: note.id, fallbackDate: 'x' })
      eq(back, note, `往返后不一致（${note.id}）\n${md}`)
      eq(serializeNote(back), md, `二次序列化不一致（${note.id}）`)
    }
  })

  await test('笔记 Markdown：外部写的文件也能读，块 id 稳定', () => {
    const md = '# 随手记\n\n第一段\n第一段第二行\n- [ ] 事项\n\n![说明](gp-ref:project/a1)\n'
    const a = parseNote(md, 'p9', { id: 'ext', fallbackDate: '2026-01-01T00:00:00.000Z' })
    const b = parseNote(md, 'p9', { id: 'ext', fallbackDate: '2026-01-01T00:00:00.000Z' })
    eq(a, b, '两次解析结果应相同')
    eq(a.title, '', '没有文件头时标题为空')
    eq(a.category, '其他', '没有文件头时分类为其他')
    eq(a.createdAt, '2026-01-01T00:00:00.000Z', '没有文件头时用文件时间')
    eq(
      a.blocks.map((x) => x.type),
      ['p', 'p', 'todo', 'image'],
      '块类型'
    )
    eq(a.blocks[1], { id: 'b2', type: 'p', text: '第一段\n第一段第二行' }, '段落内换行')
    eq(a.blocks[3], { id: 'b4', type: 'image', image: { scope: 'project', projectId: 'p9', id: 'a1' } }, '图片块补上项目 id')
  })

  console.log('\n[app]')
  await test('getInfo：数据目录、强调色、全局库为空', async () => {
    const info = await gp<{ dataRoot: string; accentColor: string; libraryEmpty: boolean; platform: string; version: string }>(
      'app.getInfo'
    )
    eq(info.dataRoot, ROOT, 'dataRoot')
    assert(/^#[0-9A-F]{6}$/.test(info.accentColor), `强调色格式不对：${info.accentColor}`)
    eq(info.libraryEmpty, true, 'libraryEmpty')
    eq(info.platform, process.platform, 'platform')
    assert(info.version, 'version')
    for (const d of ['library/images', 'library/images.json', 'library/prompts.json', 'library/styles.json', 'projects', '.cache/thumbs']) {
      assert(existsSync(join(ROOT, d)), `缺少 ${d}`)
    }
  })

  let project: Project
  let libImages: LibImage[] = []
  await test('importSample：导入 14 张图、12 条提示词、9 个风格和示例项目「雾港」', async () => {
    await takeEvents()
    await gp('app.importSample')
    libImages = await gp<LibImage[]>('library.listImages')
    const prompts = await gp<Prompt[]>('library.listPrompts')
    const styles = await gp<Style[]>('library.listStyles')
    const projects = await gp<ProjectSummary[]>('projects.list')
    eq(libImages.length, 14, '图片数')
    eq(prompts.length, 12, '提示词数')
    eq(styles.length, 9, '风格数')
    eq(projects.length, 1, '项目数')
    eq(projects[0].name, '雾港', '项目名')
    eq(projects[0].noteCount, 9, '笔记数')
    eq(projects[0].assetCount, 24, '资料数')
    eq(prompts[0].title, '16-bit 像素角色 sprite', '提示词顺序')
    eq(prompts[0].uses, 24, '用过次数')
    eq(styles[0].name, '16-bit 暗调像素', '风格顺序')
    const nameOf = (id: string | null): string | null => libImages.find((x) => x.id === id)?.name ?? null
    eq(
      styles.map((s) => nameOf(s.sampleImageId)),
      ['雾港夜景', '水彩绘本样张', '赛璐璐日系样张', '低多边形样张', null, null, null, null, null],
      '风格样张'
    )
    eq(styles[0].palette, ['#1B1F2E', '#2F3A52', '#56627A', '#C9A15A', '#F2D28B'], '色板')
    const harbor = libImages.find((x) => x.name === '雾港夜景')
    assert(harbor, '缺少雾港夜景')
    eq([harbor.width, harbor.height, harbor.format, harbor.category], [1200, 800, 'JPG', '场景'], '图片信息')
    eq(harbor.tags, ['夜景', '港口', '横版'], '标签')
    assert(existsSync(join(ROOT, 'library', 'images', harbor.file)), '原图没复制进来')

    project = await gp<Project>('projects.get', projects[0].id)
    eq(project.pitch, '守夜人提灯穿过会吞噬记忆的雾', 'pitch')
    eq(project.genres, ['2D 横版动作', '轻解谜'], 'genres')
    eq(project.platforms, ['PC（Steam）', 'Switch'], 'platforms')
    eq(project.resolution, { w: 320, h: 180 }, 'resolution')
    eq(project.scaling, 'integer', 'scaling')
    eq(project.sizes.boss, { w: 64, h: 64 }, 'boss size')
    eq(project.sessionLength, '20–40 分钟', 'sessionLength')
    eq(styles.find((s) => s.id === project.styleId)?.name, '16-bit 暗调像素', '项目风格')
    eq(
      project.pinnedPromptIds.map((id) => prompts.find((p) => p.id === id)?.title),
      ['16-bit 像素角色 sprite', '像素网格严格对齐', '通用负面词'],
      '常用提示词'
    )
    const assets = await gp<ProjectAsset[]>('projects.listAssets', project.id)
    eq(assets.find((a) => a.id === project.coverAssetId)?.name, '主视觉草案 v2', '封面')
    eq(assets[0].name, '主视觉草案 v2', '资料按添加时间排序')
    assert(
      assets.every((a) => Date.parse(a.addedAt) <= Date.now()),
      '示例时间不应晚于现在'
    )
    const notes = await gp<Note[]>('projects.listNotes', project.id)
    eq(notes.length, 9, '笔记数')
    eq(notes[0].title, '核心玩法「提灯与雾」', '最近的笔记在前')
    eq(notes.find((n) => n.title === '守夜人角色设定')?.done, true, '完成标记')
    const imageBlocks = notes.flatMap((n) => n.blocks).filter((b) => b.type === 'image')
    eq(imageBlocks.length, 9, '图片块数')
    for (const b of imageBlocks) {
      if (b.type !== 'image' || b.image.scope !== 'project') throw new Error('图片块应引用本项目资料')
      eq(b.image.projectId, project.id, '图片块项目 id')
      assert(
        assets.some((a) => a.id === b.image.id),
        '图片块引用的资料不存在'
      )
    }
    const info = await gp<{ libraryEmpty: boolean }>('app.getInfo')
    eq(info.libraryEmpty, false, 'libraryEmpty')
    const events = await takeEvents()
    for (const kind of ['library-images', 'library-prompts', 'library-styles', 'projects'] as const) {
      assert(hasEvent(events, { kind }), `没有广播 ${kind}`)
    }
    assert(hasEvent(events, { kind: 'assets', projectId: project.id }), '没有广播 assets')
  })

  await test('importSample 再导入一次：不重复', async () => {
    await gp('app.importSample')
    eq((await gp<LibImage[]>('library.listImages')).length, 14, '图片数')
    eq((await gp<Prompt[]>('library.listPrompts')).length, 12, '提示词数')
    eq((await gp<Style[]>('library.listStyles')).length, 9, '风格数')
    eq((await gp<ProjectSummary[]>('projects.list')).length, 1, '项目数')
  })

  console.log('\n[全局库 · 图片]')
  const pngA = makePng(40, 30, 1)
  const fileA = join(SRC, '新图 A.png')
  await fs.writeFile(fileA, pngA)
  await fs.writeFile(join(SRC, 'A 的副本.png'), pngA)
  await fs.writeFile(join(SRC, 'tiny.gif'), GIF)
  await fs.writeFile(join(SRC, 'tiny.WEBP'), WEBP)
  await fs.writeFile(join(SRC, 'fake.png'), 'not an image')
  await fs.writeFile(join(SRC, 'pic.bmp'), pngA)
  await fs.copyFile(join(sampleImages, 'mon_fog.jpg'), join(SRC, 'mon_fog.jpg'))

  let imgA: LibImage | undefined
  await test('importImages：只收 png/jpg/jpeg/webp/gif，按内容去重', async () => {
    await takeEvents()
    const added = await gp<LibImage[]>('library.importImages', [
      fileA,
      join(SRC, 'A 的副本.png'),
      join(SRC, 'tiny.gif'),
      join(SRC, 'tiny.WEBP'),
      join(SRC, 'fake.png'),
      join(SRC, 'pic.bmp'),
      join(SRC, 'mon_fog.jpg'),
      join(SRC, '不存在.png')
    ])
    eq(
      added.map((x) => [x.name, x.format, x.category]),
      [
        ['新图 A', 'PNG', '其他'],
        ['tiny', 'GIF', '其他'],
        ['tiny', 'WEBP', '其他']
      ],
      '新加入的图片'
    )
    imgA = added[0]
    eq([imgA.width, imgA.height, imgA.bytes], [40, 30, pngA.length], '宽高和大小')
    assert(/^[a-z0-9-]+$/.test(imgA.id), `id 格式不对：${imgA.id}`)
    eq(imgA.file, `${imgA.id}.png`, '文件名')
    assert(Buffer.compare(await fs.readFile(join(ROOT, 'library', 'images', imgA.file)), pngA) === 0, '原图内容不一致')
    eq(added[2].file.endsWith('.webp'), true, 'webp 扩展名')
    const hashes = JSON.parse(await fs.readFile(join(ROOT, 'library', 'hashes.json'), 'utf8')) as Record<string, string>
    eq(Object.keys(hashes).length, 17, '哈希表条数')
    const list = await gp<LibImage[]>('library.listImages')
    eq(list.length, 17, '图片总数')
    eq(list[0].id, imgA.id, '新图排在最前')
    assert(hasEvent(await takeEvents(), { kind: 'library-images' }), '没有广播 library-images')
    eq(await gp<LibImage[]>('library.importImages', [fileA]), [], '重复导入应返回空')
    eq(await takeEvents(), [], '没有新图时不广播')
  })

  await test('importImages：并发导入不丢数据', async () => {
    const files = await Promise.all(
      [11, 12, 13, 14].map(async (seed) => {
        const f = join(SRC, `并发 ${seed}.png`)
        await fs.writeFile(f, makePng(8, 8, seed))
        return f
      })
    )
    const results = await Promise.all(files.map((f) => gp<LibImage[]>('library.importImages', [f])))
    eq(
      results.map((r) => r.length),
      [1, 1, 1, 1],
      '每次各加入一张'
    )
    eq((await gp<LibImage[]>('library.listImages')).length, 21, '图片总数')
  })

  await test('importImageFromClipboard：图片、重复、文件、没有图片', async () => {
    const png = makePng(20, 20, 5)
    await writeClipboardPng(png)
    const a = await gp<LibImage | null>('library.importImageFromClipboard')
    assert(a, '应导入剪贴板图片')
    eq([a.name, a.format, a.width, a.height], ['粘贴的图片', 'PNG', 20, 20], '剪贴板图片信息')
    const again = await gp<LibImage | null>('library.importImageFromClipboard')
    eq(again?.id, a.id, '重复粘贴返回原来那张')
    const finderFile = join(SRC, '从访达拷贝.png')
    await fs.writeFile(finderFile, makePng(12, 9, 6))
    execFileSync('osascript', ['-e', `set the clipboard to POSIX file "${finderFile}"`])
    const f = await gp<LibImage | null>('library.importImageFromClipboard')
    eq([f?.name, f?.width, f?.height], ['从访达拷贝', 12, 9], '访达里拷贝的文件按原文件导入')
    await clipboard.writeText('只有文字')
    eq(await gp('library.importImageFromClipboard'), null, '没有图片时返回 null')
  })

  await test('updateImage：改名称、分类、标签；非法输入报错', async () => {
    assert(imgA, '前置测试失败')
    await takeEvents()
    const u = await gp<LibImage>('library.updateImage', imgA.id, {
      name: ' 新名字 ',
      category: '角色',
      tags: [' 主角 ', '主角', '', '像素']
    })
    eq([u.name, u.category, u.tags], ['新名字', '角色', ['主角', '像素']], '修改结果')
    eq(u.width, 40, '其他字段不变')
    assert(hasEvent(await takeEvents(), { kind: 'library-images' }), '没有广播')
    await gpFails('library.updateImage', imgA.id, { category: '不存在的分类' })
    await gpFails('library.updateImage', imgA.id, { name: '  ' })
    await gpFails('library.updateImage', 'nope', { name: 'x' })
    await gpFails('library.updateImage', '../x', { name: 'x' })
    eq((await gp<LibImage[]>('library.listImages')).find((x) => x.id === imgA?.id)?.name, '新名字', '保存到磁盘')
  })

  console.log('\n[全局库 · 提示词与风格]')
  await test('提示词：增删改、markPromptUsed、并发创建', async () => {
    const p = await gp<Prompt>('library.createPrompt', { title: '测试提示词', body: '正文', category: '约束' })
    eq([p.title, p.body, p.category, p.uses], ['测试提示词', '正文', '约束', 0], '创建')
    const u = await gp<Prompt>('library.updatePrompt', p.id, { body: '新正文' })
    eq([u.title, u.body], ['测试提示词', '新正文'], '修改')
    await gp('library.markPromptUsed', p.id)
    eq((await gp<Prompt>('library.markPromptUsed', p.id)).uses, 2, 'uses + 1')
    await gpFails('library.createPrompt', { title: 'x', body: 'y', category: '不存在' })
    await gpFails('library.createPrompt', { title: 'x' })
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => gp('library.createPrompt', { title: `并发 ${i}`, body: 'b', category: '风格' }))
    )
    eq((await gp<Prompt[]>('library.listPrompts')).length, 23, '并发创建后总数')
    await gp('library.deletePrompt', p.id)
    assert(!(await gp<Prompt[]>('library.listPrompts')).some((x) => x.id === p.id), '删除')
    await gpFails('library.deletePrompt', p.id)
  })

  await test('风格：增删改、色板校验、样张图片删掉后清空', async () => {
    const tmp = await gp<LibImage[]>('library.importImages', [join(SRC, '从访达拷贝.png')])
    eq(tmp.length, 0, '已在库里')
    const sample = (await gp<LibImage[]>('library.listImages')).find((x) => x.name === '从访达拷贝')
    assert(sample, '缺少样张图片')
    const s = await gp<Style>('library.createStyle', {
      name: '测试风格',
      desc: '描述',
      palette: ['#abc', '#1b1f2e'],
      prompt: 'prompt',
      sampleImageId: sample.id
    })
    eq(s.palette, ['#AABBCC', '#1B1F2E'], '色板规范化')
    eq(s.sampleImageId, sample.id, '样张')
    await gpFails('library.createStyle', { name: 'x', desc: '', palette: ['red'], prompt: '', sampleImageId: null })
    await gpFails('library.createStyle', { name: 'x', desc: '', palette: [], prompt: '', sampleImageId: 'nope' })
    const u = await gp<Style>('library.updateStyle', s.id, { desc: '新描述' })
    eq([u.desc, u.sampleImageId], ['新描述', sample.id], '修改只动给出的字段')
    await takeEvents()
    await gp('library.deleteImage', sample.id)
    const events = await takeEvents()
    assert(hasEvent(events, { kind: 'library-images' }) && hasEvent(events, { kind: 'library-styles' }), '删除样张后应广播两类变化')
    eq((await gp<Style[]>('library.listStyles')).find((x) => x.id === s.id)?.sampleImageId, null, '样张清空')
    assert(!existsSync(join(ROOT, 'library', 'images', sample.file)), '原图应移到废纸篓')
    const hashes = JSON.parse(await fs.readFile(join(ROOT, 'library', 'hashes.json'), 'utf8')) as Record<string, string>
    assert(!(sample.id in hashes), '哈希表应去掉')
    await gpFails('library.deleteImage', sample.id)
    const back = await gp<LibImage[]>('library.importImages', [join(SRC, '从访达拷贝.png')])
    eq(back.length, 1, '删掉后可以重新导入')
    await gp('library.deleteStyle', s.id)
    eq((await gp<Style[]>('library.listStyles')).length, 9, '删除风格')
  })

  console.log('\n[项目]')
  let pid = ''
  await test('项目：创建默认值、修改、列表统计', async () => {
    await takeEvents()
    const p = await gp<Project>('projects.create', '  测试项目  ')
    pid = p.id
    eq(
      [p.name, p.resolution, p.scaling, p.sizes, p.sessionLength, p.genres, p.styleId, p.coverAssetId],
      [
        '测试项目',
        { w: 320, h: 180 },
        'integer',
        { tile: { w: 16, h: 16 }, character: { w: 32, h: 32 }, boss: { w: 64, h: 64 }, icon: { w: 16, h: 16 } },
        '20–40 分钟',
        [],
        null,
        null
      ],
      '默认值'
    )
    assert(hasEvent(await takeEvents(), { kind: 'projects' }), '没有广播 projects')
    const styles = await gp<Style[]>('library.listStyles')
    const u = await gp<Project>('projects.update', pid, {
      pitch: '一句话',
      genres: ['轻解谜', '轻解谜'],
      styleId: styles[1].id,
      resolution: { w: 640, h: 360 },
      scaling: 'fit',
      sizes: { tile: { w: 32, h: 32 } },
      targetPlayers: '第一行\n第二行'
    })
    eq(
      [u.pitch, u.genres, u.styleId, u.resolution, u.scaling, u.sizes.tile, u.sizes.boss, u.targetPlayers],
      ['一句话', ['轻解谜'], styles[1].id, { w: 640, h: 360 }, 'fit', { w: 32, h: 32 }, { w: 64, h: 64 }, '第一行\n第二行'],
      '修改结果'
    )
    assert(u.updatedAt >= p.updatedAt, 'updatedAt')
    const events = await takeEvents()
    assert(hasEvent(events, { kind: 'project', projectId: pid }), '没有广播 project')
    await gpFails('projects.update', pid, { resolution: { w: 0, h: 10 } })
    await gpFails('projects.update', pid, { styleId: 'nope' })
    await gpFails('projects.update', pid, { scaling: 'zoom' })
    await gpFails('projects.update', pid, { coverAssetId: 'nope' })
    await gpFails('projects.get', 'nope')
    eq((await gp<Project>('projects.get', pid)).pitch, '一句话', 'get')
    const list = await gp<ProjectSummary[]>('projects.list')
    eq(
      list.map((x) => x.name),
      ['雾港', '测试项目'],
      '按创建时间排'
    )
  })

  await test('删除提示词 / 风格时去掉项目里的引用', async () => {
    const prompts = await gp<Prompt[]>('library.listPrompts')
    const styles = await gp<Style[]>('library.listStyles')
    const extraPrompt = await gp<Prompt>('library.createPrompt', { title: '临时', body: 't', category: '构图' })
    const extraStyle = await gp<Style>('library.createStyle', { name: '临时', desc: '', palette: [], prompt: '', sampleImageId: null })
    await gp('projects.update', pid, { pinnedPromptIds: [prompts[0].id, extraPrompt.id], styleId: extraStyle.id })
    await takeEvents()
    await gp('library.deletePrompt', extraPrompt.id)
    await gp('library.deleteStyle', extraStyle.id)
    const p = await gp<Project>('projects.get', pid)
    eq([p.pinnedPromptIds, p.styleId], [[prompts[0].id], null], '引用已去掉')
    assert(hasEvent(await takeEvents(), { kind: 'project', projectId: pid }), '没有广播 project')
    eq(styles.length, 9, '风格数不变')
  })

  console.log('\n[项目 · 笔记]')
  await test('笔记：新建默认值、整条保存、Markdown 文件往返、删除', async () => {
    await takeEvents()
    const n = await gp<Note>('projects.createNote', pid)
    eq([n.title, n.category, n.done, n.blocks.length, n.blocks[0].type], ['新笔记', '玩法', false, 1, 'p'], '默认值')
    assert(hasEvent(await takeEvents(), { kind: 'notes', projectId: pid }), '没有广播 notes')
    const lib = (await gp<LibImage[]>('library.listImages'))[0]
    const blocks: NoteBlock[] = [
      { id: 'k1', type: 'p', text: '第一段\n\n- [ ] 不是清单' },
      { id: 'k2', type: 'todo', text: '清单\n换行', checked: true },
      { id: 'k3', type: 'image', image: { scope: 'library', id: lib.id } },
      { id: 'k4', type: 'image', image: { scope: 'project', projectId: pid, id: 'someasset' } },
      { id: 'k4', type: 'p', text: '' }
    ]
    const saved = await gp<Note>('projects.saveNote', pid, { ...n, title: '标题: 带冒号', category: '关卡', done: true, blocks })
    eq(saved.blocks.slice(0, 4).map((b) => b.id), ['k1', 'k2', 'k3', 'k4'], '块 id 保留')
    assert(saved.blocks[4].id !== 'k4', '重复的块 id 应换新')
    eq(saved.blocks[1], { id: 'k2', type: 'todo', text: '清单 换行', checked: true }, '清单项换行变空格')
    eq(saved.createdAt, n.createdAt, 'createdAt 不变')
    const listed = (await gp<Note[]>('projects.listNotes', pid)).find((x) => x.id === n.id)
    eq(listed, saved, '读回来和保存的一致')
    const md = await fs.readFile(join(ROOT, 'projects', pid, 'notes', `${n.id}.md`), 'utf8')
    assert(md.startsWith('---\nid: '), '文件头')
    assert(md.includes(`![](gp-ref:library/${lib.id})`) && md.includes('![](gp-ref:project/someasset)'), '图片引用写法')
    assert(md.includes('- [x] 清单 换行'), '清单写法')
    await gpFails('projects.saveNote', pid, {
      ...saved,
      blocks: [{ id: 'z', type: 'image', image: { scope: 'project', projectId: 'other', id: 'x' } }]
    })
    await gpFails('projects.saveNote', pid, { ...saved, id: 'missing' })
    await gpFails('projects.saveNote', pid, { ...saved, category: '不存在' })
    await gpFails('projects.createNote', 'nope')
    const n2 = await gp<Note>('projects.createNote', pid, { title: '第二条', category: '故事', blocks: [] })
    eq((await gp<Note[]>('projects.listNotes', pid))[0].id, n2.id, '最近修改的在前')
    await gp('projects.deleteNote', pid, n2.id)
    assert(!existsSync(join(ROOT, 'projects', pid, 'notes', `${n2.id}.md`)), '笔记文件应移到废纸篓')
    await gpFails('projects.deleteNote', pid, n2.id)
    eq((await gp<ProjectSummary[]>('projects.list')).find((x) => x.id === pid)?.noteCount, 1, 'noteCount')
  })

  console.log('\n[项目 · 资料]')
  let asset: ProjectAsset | undefined
  await test('资料：导入去重、从全局库复制、剪贴板、修改、删除', async () => {
    await takeEvents()
    const added = await gp<ProjectAsset[]>('projects.importAssets', pid, [fileA, join(SRC, 'A 的副本.png'), join(SRC, 'fake.png')])
    eq(
      added.map((a) => [a.name, a.category, a.sourceLibraryId]),
      [['新图 A', '其他', null]],
      '导入'
    )
    asset = added[0]
    assert(existsSync(join(ROOT, 'projects', pid, 'assets', asset.file)), '原图')
    assert(hasEvent(await takeEvents(), { kind: 'assets', projectId: pid }), '没有广播 assets')
    eq(await gp('projects.importAssets', pid, [fileA]), [], '重复导入')

    const lib = await gp<LibImage[]>('library.listImages')
    const fog = lib.find((x) => x.name === '雾妖')
    const tiles = lib.find((x) => x.name === '石砖瓦片')
    const libA = lib.find((x) => x.id === imgA?.id)
    assert(fog && tiles && libA, '缺少全局库图片')
    const fromLib = await gp<ProjectAsset[]>('projects.addAssetsFromLibrary', pid, [fog.id, fog.id, tiles.id, libA.id])
    eq(
      fromLib.map((a) => [a.name, a.category, a.sourceLibraryId, a.tags]),
      [
        ['雾妖', '角色', fog.id, fog.tags],
        ['石砖瓦片', '概念图', tiles.id, tiles.tags]
      ],
      '从全局库复制（内容和已有资料相同的不再加）'
    )
    eq(await gp('projects.addAssetsFromLibrary', pid, [fog.id]), [], '再复制一次不重复')
    await gpFails('projects.addAssetsFromLibrary', pid, ['nope'])

    await writeClipboardPng(makePng(16, 16, 9))
    const clip = await gp<ProjectAsset | null>('projects.importAssetFromClipboard', pid)
    eq([clip?.name, clip?.width, clip?.format], ['粘贴的图片', 16, 'PNG'], '剪贴板导入')

    const u = await gp<ProjectAsset>('projects.updateAsset', pid, asset.id, { name: '改名', category: '截图', tags: ['a'] })
    eq([u.name, u.category, u.tags], ['改名', '截图', ['a']], '修改')
    await gpFails('projects.updateAsset', pid, asset.id, { category: '怪物' })

    await gp('projects.update', pid, { coverAssetId: fromLib[0].id })
    await takeEvents()
    await gp('projects.deleteAsset', pid, fromLib[0].id)
    eq((await gp<Project>('projects.get', pid)).coverAssetId, null, '删掉封面后清空')
    assert(hasEvent(await takeEvents(), { kind: 'project', projectId: pid }), '封面清空后广播 project')
    eq((await gp<ProjectAsset[]>('projects.listAssets', pid)).length, 3, '资料数')
    eq((await gp<ProjectSummary[]>('projects.list')).find((x) => x.id === pid)?.assetCount, 3, 'assetCount')
  })

  console.log('\n[gp:// 协议]')
  await test('原图、缩略图、缓存、失效、404 / 400、防路径穿越', async () => {
    const lib = await gp<LibImage[]>('library.listImages')
    const harbor = lib.find((x) => x.name === '雾港夜景')
    assert(harbor && imgA, '缺少图片')
    const orig = await fetchMain(`gp://image/library/${harbor.id}`)
    eq([orig.status, orig.type], [200, 'image/jpeg'], '原图')
    assert(Buffer.compare(orig.body, await fs.readFile(join(ROOT, 'library', 'images', harbor.file))) === 0, '原图内容')

    const before = (await thumbFiles()).length
    const t = await fetchMain(`gp://image/library/${harbor.id}?thumb=256`)
    eq([t.status, t.type], [200, 'image/jpeg'], '缩略图')
    const ts = nativeImage.createFromBuffer(t.body).getSize()
    assert(Math.max(ts.width, ts.height) <= 256 && Math.max(ts.width, ts.height) >= 200, `缩略图尺寸不对：${ts.width}×${ts.height}`)
    assert(Math.abs(ts.width / ts.height - 1.5) < 0.05, `缩略图比例不对：${ts.width}×${ts.height}`)
    eq((await thumbFiles()).length, before + 1, '缩略图已缓存')
    const t2 = await fetchMain(`gp://image/library/${harbor.id}?thumb=256`)
    assert(Buffer.compare(t.body, t2.body) === 0, '第二次读缓存')
    eq((await thumbFiles()).length, before + 1, '缓存不重复')

    const small = await fetchMain(`gp://image/library/${imgA.id}?thumb=256`)
    eq(small.type, 'image/png', '小图类型')
    assert(Buffer.compare(small.body, pngA) === 0, '小图直接给原图')

    // 原图变了，缩略图要重新生成
    const pa = (await gp<ProjectAsset[]>('projects.listAssets', project.id))[0]
    const pUrl = `gp://image/project/${project.id}/${pa.id}?thumb=128`
    const p1 = await fetchMain(pUrl)
    eq(p1.status, 200, '项目资料缩略图')
    const src = join(ROOT, 'projects', project.id, 'assets', pa.file)
    await fs.copyFile(join(sampleImages, 'ui_kit.jpg'), src)
    await fs.utimes(src, new Date(), new Date(Date.now() + 5000))
    const p2 = await fetchMain(pUrl)
    assert(Buffer.compare(p1.body, p2.body) !== 0, '原图变了缩略图应重新生成')
    eq(nativeImage.createFromBuffer(p2.body).getSize().width, 128, '新缩略图是正方形原图缩小')

    const pOrig = await fetchMain(`gp://image/project/${project.id}/${pa.id}`)
    eq([pOrig.status, pOrig.type], [200, 'image/jpeg'], '项目资料原图')

    const webp = lib.find((x) => x.format === 'WEBP')
    assert(webp, '缺少 webp')
    eq((await fetchMain(`gp://image/library/${webp.id}`)).type, 'image/webp', 'webp 类型')

    for (const bad of [
      'gp://image/library/nope',
      'gp://image/library/..%2F..%2Fimages.json',
      'gp://image/library/..%2Fimages.json',
      `gp://image/project/..%2F..%2Flibrary/${harbor.id}`,
      `gp://image/project/${project.id}/..%2Fproject.json`,
      'gp://image/library/../images.json',
      `gp://image/library/${harbor.id}/extra`,
      `gp://other/library/${harbor.id}`,
      `gp://image/project/nope/${pa.id}`
    ]) {
      eq((await fetchMain(bad)).status, 404, `应返回 404：${bad}`)
    }
    eq((await fetchMain(`gp://image/library/${harbor.id}?thumb=abc`)).status, 400, 'thumb 不是数字')
    eq((await fetchMain(`gp://image/library/${harbor.id}?thumb=-5`)).status, 400, 'thumb 为负')
  })

  await test('界面里 fetch / <img> 能加载 gp:// 图片', async () => {
    const lib = await gp<LibImage[]>('library.listImages')
    const id = lib.find((x) => x.name === '守夜人')?.id
    const r = (await win.webContents.executeJavaScript(`(async () => {
      const res = await fetch('gp://image/library/${id}?thumb=200')
      const blob = await res.blob()
      const img = new Image()
      img.src = 'gp://image/library/${id}'
      await img.decode()
      return { status: res.status, type: blob.type, size: blob.size, w: img.naturalWidth, h: img.naturalHeight }
    })()`)) as { status: number; type: string; size: number; w: number; h: number }
    eq([r.status, r.type, r.w, r.h], [200, 'image/jpeg', 1200, 1200], '界面加载')
    assert(r.size > 0, '缩略图有内容')
  })

  console.log('\n[剪贴板 / 访达]')
  await test('clipboard.copyImage / copyText', async () => {
    const lib = await gp<LibImage[]>('library.listImages')
    const harbor = lib.find((x) => x.name === '雾港夜景')
    assert(harbor, '缺少图片')
    eq(await gp('clipboard.copyImage', { scope: 'library', id: harbor.id }), true, '复制 JPG')
    eq(await clipboardPngSize(), { width: 1200, height: 800 }, '剪贴板里是原尺寸图片')
    eq(await gp('clipboard.copyImage', { scope: 'library', id: imgA?.id }), true, '复制 PNG')
    eq(await clipboardPngSize(), { width: 40, height: 30 }, 'PNG 原样写入')
    const pa = (await gp<ProjectAsset[]>('projects.listAssets', project.id))[1]
    eq(await gp('clipboard.copyImage', { scope: 'project', projectId: project.id, id: pa.id }), true, '复制项目资料')
    await gpFails('clipboard.copyImage', { scope: 'library', id: 'nope' })
    await gpFails('clipboard.copyImage', { scope: 'project', projectId: '..', id: 'x' })
    await gp('clipboard.copyText', '提示词 prompt ✓')
    eq(await clipboard.readText(), '提示词 prompt ✓', '复制文字')
    await gpFails('clipboard.copyText', 42)
    await gpFails('shell.revealImage', { scope: 'library', id: 'nope' })
  })

  await test('WEBP / GIF：读宽高、缩略图、复制到剪贴板', async () => {
    const fx = join(PROJECT_DIR, 'scripts', 'fixtures')
    const added = await gp<LibImage[]>('library.importImages', [join(fx, 'forest.webp'), join(fx, 'fog.gif')])
    eq(
      added.map((x) => [x.name, x.format, x.width, x.height]),
      [
        ['forest', 'WEBP', 96, 72],
        ['fog', 'GIF', 80, 60]
      ],
      '宽高'
    )
    const w = await fetchMain(`gp://image/library/${added[0].id}?thumb=48`)
    eq([w.status, w.type], [200, 'image/png'], 'webp 缩略图')
    eq(nativeImage.createFromBuffer(w.body).getSize(), { width: 48, height: 36 }, 'webp 缩略图尺寸')
    const g = await fetchMain(`gp://image/library/${added[1].id}?thumb=40`)
    eq(nativeImage.createFromBuffer(g.body).getSize(), { width: 40, height: 30 }, 'gif 缩略图尺寸')
    eq((await fetchMain(`gp://image/library/${added[1].id}`)).type, 'image/gif', 'gif 原图类型')
    eq(await gp('clipboard.copyImage', { scope: 'library', id: added[0].id }), true, '复制 webp')
    eq(await clipboardPngSize(), { width: 96, height: 72 }, 'webp 原尺寸')
    eq(await gp('clipboard.copyImage', { scope: 'library', id: added[1].id }), true, '复制 gif')
    eq(await clipboardPngSize(), { width: 80, height: 60 }, 'gif 原尺寸')
  })

  console.log('\n[收尾]')
  await test('projects.remove：整个项目文件夹移到废纸篓，缩略图缓存清掉', async () => {
    const aid = (await gp<ProjectAsset[]>('projects.listAssets', pid)).find((a) => a.width > 64)?.id
    eq((await fetchMain(`gp://image/project/${pid}/${aid}?thumb=32`)).status, 200, '先生成一个缩略图')
    assert((await thumbFiles()).some((n) => n.startsWith(`prj.${pid}.`)), '有缩略图缓存')
    await takeEvents()
    await gp('projects.remove', pid)
    assert(!existsSync(join(ROOT, 'projects', pid)), '项目文件夹还在')
    assert(!(await thumbFiles()).some((n) => n.startsWith(`prj.${pid}.`)), '缩略图缓存没清')
    assert(hasEvent(await takeEvents(), { kind: 'projects' }), '没有广播 projects')
    eq((await gp<ProjectSummary[]>('projects.list')).length, 1, '项目数')
    await gpFails('projects.remove', pid)
    await gpFails('projects.listNotes', pid)
  })

  await test('IPC 通道与 preload 完全一致', async () => {
    assert(PROJECT_DIR, '缺少 GAMEPANL_PROJECT_DIR')
    const preload = readFileSync(join(PROJECT_DIR, 'src', 'preload', 'index.ts'), 'utf8')
    const ipc = readFileSync(join(PROJECT_DIR, 'src', 'main', 'ipc.ts'), 'utf8')
    const a = [...preload.matchAll(/call\('([^']+)'\)/g)].map((m) => m[1]).sort()
    const b = [...ipc.matchAll(/handle\(\s*'([^']+)'/g)].map((m) => m[1]).sort()
    eq(b, a, '通道名')
    eq(a.length, 35, '通道数')
  })

  await test('数据文件都是合法 JSON，没有残留临时文件', async () => {
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = []
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) out.push(...(await walk(p)))
        else out.push(p)
      }
      return out
    }
    const files = await walk(ROOT)
    eq(
      files.filter((f) => f.endsWith('.tmp')),
      [],
      '临时文件'
    )
    for (const f of files.filter((x) => x.endsWith('.json'))) JSON.parse(await fs.readFile(f, 'utf8'))
  })
}

app.whenReady().then(async () => {
  console.log(`GamePanl 后端自检 · 数据目录 ${ROOT}`)
  try {
    await run()
  } catch (err) {
    failed++
    console.error('自检中断:', err)
  }
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  app.exit(failed ? 1 : 0)
})
