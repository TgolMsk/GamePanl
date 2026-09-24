import { cx } from './cx'
import { Icon } from './Icon'

export interface StepperProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  /** 默认 1 */
  step?: number
  /** 读屏用：「减小{label}」「增大{label}」，如 label="角色尺寸" */
  label?: string
  className?: string
}

/** − / + 步进按钮（灰底小胶囊），到边界时对应按钮不可点 */
export function Stepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  label = '',
  className
}: StepperProps): React.JSX.Element {
  const dec = Math.max(min, value - step)
  const inc = Math.min(max, value + step)
  return (
    <div className={cx('stp', className)}>
      <button type="button" aria-label={`减小${label}`} disabled={dec === value} onClick={() => onChange(dec)}>
        <Icon name="minus" size={12} strokeWidth={2} />
      </button>
      <button type="button" aria-label={`增大${label}`} disabled={inc === value} onClick={() => onChange(inc)}>
        <Icon name="plus" size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
