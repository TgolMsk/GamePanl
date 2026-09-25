// 应用自身的设置（和项目数据无关），存在 Electron 的配置目录 userData/settings.json。
import { app } from 'electron'
import { join } from 'path'
import { readJson, updateJson } from './storage'

export interface AppSettings {
  /** 启动时和运行期间定时到 GitHub 检查新版本 */
  autoCheckUpdates: boolean
  /** 用户选了「跳过这个版本」的版本号 */
  skippedVersion: string | null
  lastUpdateCheckAt: string | null
}

const DEFAULTS: AppSettings = { autoCheckUpdates: true, skippedVersion: null, lastUpdateCheckAt: null }

const file = (): string => join(app.getPath('userData'), 'settings.json')

export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULTS, ...(await readJson<Partial<AppSettings>>(file(), {})) }
}

export function patchSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return updateJson<Partial<AppSettings>, AppSettings>(file(), {}, (data) => {
    Object.assign(data, patch)
    return { ...DEFAULTS, ...data }
  })
}
