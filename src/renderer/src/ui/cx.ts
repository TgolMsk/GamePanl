/** 拼接 className，忽略假值：cx('btn', on && 'on') */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}
