// 在 Node 里跑主进程模块用的 electron 替身：只实现测试会碰到的几个接口。
import { promises as fs } from 'fs'

const empty = { isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }), resize: () => empty, toPNG: () => Buffer.alloc(0) }

export const nativeImage = {
  createFromBuffer: () => empty,
  createFromPath: () => empty,
  createEmpty: () => empty
}
export const shell = {
  trashItem: (path: string) => fs.rm(path, { recursive: true, force: true })
}
export const clipboard = { write: () => undefined, writeText: () => undefined }
export class ClipboardItem {}
export const app = { getVersion: () => 'test', getPath: () => '/tmp' }
