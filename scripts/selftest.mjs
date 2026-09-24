// 主进程后端自检的启动脚本：把 scripts/selftest.ts 和预加载脚本打包到临时目录，再用 Electron 运行。
//
//   GAMEPANL_DATA_ROOT=/某个/测试目录 node scripts/selftest.mjs
//
// 测试目录会被清空重建（只接受空目录或上次自检留下的目录），绝不要指向 ~/GamePanl。
// 自检会临时使用系统剪贴板（结束后恢复原内容），删除操作会把少量测试文件移到废纸篓。
import { build } from 'esbuild'
import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

if (!process.env.GAMEPANL_DATA_ROOT) {
  console.error('请先设置 GAMEPANL_DATA_ROOT，指向一个专门用于测试的目录')
  process.exit(2)
}

// 让 @shared/* 指向 src/shared/*（与 electron.vite.config.ts 相同）
const sharedAlias = {
  name: 'shared-alias',
  setup(b) {
    b.onResolve({ filter: /^@shared\// }, async (args) =>
      b.resolve('./' + args.path.slice('@shared/'.length), {
        kind: args.kind,
        resolveDir: join(projectDir, 'src', 'shared')
      })
    )
  }
}

const appDir = await mkdtemp(join(tmpdir(), 'gamepanl-selftest-'))
let code = 1
try {
  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    plugins: [sharedAlias],
    logLevel: 'warning'
  }
  await build({ ...common, entryPoints: [join(projectDir, 'scripts', 'selftest.ts')], outfile: join(appDir, 'main.js') })
  await build({ ...common, entryPoints: [join(projectDir, 'src', 'preload', 'index.ts')], outfile: join(appDir, 'preload.js') })
  const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'))
  await writeFile(join(appDir, 'package.json'), JSON.stringify({ name: 'gamepanl-selftest', version: pkg.version, main: 'main.js' }))
  // 示例内容按 app.getAppPath()/resources/sample 查找
  await symlink(join(projectDir, 'resources'), join(appDir, 'resources'))

  const electron = require('electron')
  code = await new Promise((done) => {
    const child = spawn(electron, [appDir], {
      stdio: 'inherit',
      env: { ...process.env, GAMEPANL_PROJECT_DIR: projectDir }
    })
    child.on('exit', (c) => done(c ?? 1))
  })
} finally {
  await rm(appDir, { recursive: true, force: true })
}
process.exit(code)
