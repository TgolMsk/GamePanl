// 应用元信息：从 package.json 取仓库地址等，代码里不再手写第二份。
import pkg from '../../package.json'

export const APP_NAME = 'GamePanl'
export const COPYRIGHT = 'Copyright © 2026 TgolMsk'

function repoSlug(): string {
  const url = typeof pkg.repository === 'object' ? pkg.repository.url : String(pkg.repository ?? '')
  const m = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url)
  if (!m) throw new Error('package.json 的 repository 里没有 GitHub 仓库地址')
  return m[1]
}

/** owner/repo */
export const REPO = repoSlug()
export const REPO_URL = `https://github.com/${REPO}`
export const RELEASES_URL = `${REPO_URL}/releases`
export const ISSUES_URL = `${REPO_URL}/issues/new`
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
