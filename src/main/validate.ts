// 参数校验：界面传进来的数据一律当作不可信输入。

/** 文件名和 gp:// 地址里用到的 id 只允许这些字符，防止路径穿越 */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function fail(message: string): never {
  throw new Error(message)
}

export function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && SAFE_ID.test(v)
}

export function asId(v: unknown, label = 'id'): string {
  if (!isSafeId(v)) fail(`${label} 不合法`)
  return v
}

export function asIds(v: unknown, label = 'id 列表'): string[] {
  if (!Array.isArray(v)) fail(`${label} 必须是数组`)
  return v.map((x) => asId(x, label))
}

export function asString(v: unknown, label: string, max = 100_000): string {
  if (typeof v !== 'string') fail(`${label} 必须是文字`)
  if (v.length > max) fail(`${label} 太长了`)
  return v
}

/** 单行文字：换行换成空格 */
export function asLine(v: unknown, label: string, max = 500): string {
  return asString(v, label, max).replace(/\r?\n|\r/g, ' ')
}

export function asBoolean(v: unknown, label: string): boolean {
  if (typeof v !== 'boolean') fail(`${label} 必须是 true 或 false`)
  return v
}

export function asOneOf<T extends string>(v: unknown, options: readonly T[], label: string): T {
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) fail(`${label} 不在可选范围内`)
  return v as T
}

/** 字符串数组：去掉首尾空白、空项和重复项 */
export function asStringList(v: unknown, label: string, maxItems = 200, maxLen = 200): string[] {
  if (!Array.isArray(v)) fail(`${label} 必须是数组`)
  if (v.length > maxItems) fail(`${label} 太多了`)
  const out: string[] = []
  for (const x of v) {
    const s = asLine(x, label, maxLen).trim()
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

export function asInt(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(`${label} 必须是 ${min}–${max} 的整数`)
  return v
}

export function asObject(v: unknown, label: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${label} 格式不对`)
  return v as Record<string, unknown>
}

/** 可选的本地路径列表（不传表示弹出文件选择框） */
export function asOptionalPaths(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) fail('文件路径列表必须是数组')
  return v.map((x) => asString(x, '文件路径', 4096))
}

export function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined
}
