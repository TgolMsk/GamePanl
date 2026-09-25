import './update.css'
import { dismissUpdateBanner, openUpdateSheet, useUpdateStore } from '../app/update'
import { Icon } from '../ui/Icon'

/** 侧栏底部的更新提示：有新版本 / 正在下载 / 已下载。点击打开「软件更新」窗口。 */
export function UpdateBanner(): React.JSX.Element | null {
  const state = useUpdateStore((s) => s.state)
  const dismissed = useUpdateStore((s) => s.dismissedVersion)
  const release = state?.release
  if (!state || !release) return null
  if (state.phase !== 'available' && state.phase !== 'downloading' && state.phase !== 'downloaded') return null
  if (state.phase === 'available' && dismissed === release.version) return null

  let title = `有新版本 ${release.version}`
  let hint = '查看更新内容'
  if (state.phase === 'downloading') {
    const p = state.progress
    const pct = p && p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : null
    title = `正在下载 ${release.version}…`
    hint = pct === null ? '请稍候' : `${pct}%`
  } else if (state.phase === 'downloaded') {
    title = `${release.version} 已下载`
    hint = '打开安装包'
  }

  return (
    <div className="upd-banner">
      <button type="button" className="upd-banner-main" onClick={openUpdateSheet}>
        <span className="ic">
          <Icon name="tray.down" />
        </span>
        <span className="upd-banner-text">
          <span className="t">{title}</span>
          <span className="h">{hint}</span>
        </span>
      </button>
      {state.phase === 'available' && (
        <button
          type="button"
          className="upd-banner-x"
          aria-label="暂不提醒"
          onClick={() => dismissUpdateBanner(release.version)}
        >
          <Icon name="xmark" size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
