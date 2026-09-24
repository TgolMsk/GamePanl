// 显示用的格式化：文件大小、日期、图片尺寸。

/** 字节 → 「860 KB」「2.4 MB」 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1).replace(/\.0$/, '')} MB`
}

const pad = (n: number): string => String(n).padStart(2, '0')

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * ISO 时间 → 「今天 14:32」「昨天」「9月21日」（不是今年时带年份）。
 * time: true 时每种都带时间：「昨天 11:40」「9月21日 14:25」。
 */
export function formatDate(iso: string, opts: { time?: boolean } = {}): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (days === 0) return `今天 ${hm}`
  if (days === 1) return opts.time ? `昨天 ${hm}` : '昨天'
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  const day = d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
  return opts.time ? `${day} ${hm}` : day
}

/** 图片尺寸 → 「1536×1024」 */
export function formatSize(width: number, height: number): string {
  return `${width}×${height}`
}
