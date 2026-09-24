import { useState } from 'react'
import { hud } from '../app/hud'
import { go } from '../app/nav'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { openNewProject } from './NewProjectSheet'

/** 首次启动（全局库为空、也没有项目）时显示 */
export function Welcome(): React.JSX.Element {
  const [importing, setImporting] = useState(false)

  const importSample = async (): Promise<void> => {
    setImporting(true)
    try {
      await window.gp.app.importSample()
      go({ view: 'library', tab: 'images' })
      hud.show('已导入示例内容', { ok: true })
    } catch {
      setImporting(false)
      hud.show('导入失败')
    }
  }

  return (
    <div className="welcome">
      <div className="drag-strip" />
      <div className="welcome-body">
        <span className="ic">
          <Icon name="controller" size={48} strokeWidth={1.3} />
        </span>
        <h1>欢迎使用 GamePanl</h1>
        <p>把常用的图片素材、提示词和风格攒在全局库里，每款游戏的配置、构思和资料各放进一个项目。</p>
        <div className="welcome-actions">
          <Button variant="primary" disabled={importing} onClick={() => void importSample()}>
            {importing ? '正在导入…' : '导入示例内容'}
          </Button>
          <Button disabled={importing} onClick={openNewProject}>
            新建项目
          </Button>
        </div>
      </div>
    </div>
  )
}
