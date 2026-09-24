import { createPortal } from 'react-dom'
import { hud, useHudStore } from '../app/hud'
import { Icon } from './Icon'

/** 底部居中的深色提示胶囊。外壳渲染一次，各处用 hud.show() 触发 */
export function Hud(): React.JSX.Element {
  const cur = useHudStore((s) => s.current)
  return createPortal(
    <div className="hud-region" role="status" aria-live="polite">
      {cur && (
        <div key={cur.id} className="hud">
          {cur.ok && <Icon name="check" size={14} strokeWidth={2.2} />}
          <span>{cur.msg}</span>
          {cur.action && (
            <>
              <span className="dv" />
              <button
                type="button"
                className="act"
                onClick={() => {
                  cur.action?.run()
                  hud.hide()
                }}
              >
                {cur.action.label}
              </button>
            </>
          )}
        </div>
      )}
    </div>,
    document.body
  )
}
