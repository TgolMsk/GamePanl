import { useState, type KeyboardEvent } from 'react'
import { create } from 'zustand'
import { useProjects } from '../app/data'
import { hud } from '../app/hud'
import { go } from '../app/nav'
import { Button } from '../ui/Button'
import { Sheet } from '../ui/Sheet'
import { TextField } from '../ui/TextField'

const useNewProject = create<{ open: boolean }>(() => ({ open: false }))

/** 打开「新建项目」（侧栏底部和欢迎页共用） */
export function openNewProject(): void {
  useNewProject.setState({ open: true })
}

function closeNewProject(): void {
  useNewProject.setState({ open: false })
}

/** 外壳渲染一次 */
export function NewProjectSheet(): React.JSX.Element | null {
  const open = useNewProject((s) => s.open)
  // 每次打开都是新的输入框
  return open ? <NewProjectDialog /> : null
}

function NewProjectDialog(): React.JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const projects = useProjects()
  const trimmed = name.trim()

  const create = async (): Promise<void> => {
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const project = await window.gp.projects.create(trimmed)
      // 先让侧栏的项目列表里有它，再跳过去
      await projects.refresh()
      closeNewProject()
      go({ view: 'project', projectId: project.id, tab: 'config' })
    } catch {
      setBusy(false)
      hud.show('创建失败')
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void create()
  }

  return (
    <Sheet
      open
      onClose={closeNewProject}
      title="新建项目"
      width={420}
      footer={
        <>
          <span className="grow" />
          <Button onClick={closeNewProject}>取消</Button>
          <Button variant="primary" disabled={!trimmed || busy} onClick={() => void create()}>
            创建
          </Button>
        </>
      }
    >
      <label className="gh" htmlFor="new-project-name" style={{ display: 'block' }}>
        项目名称
      </label>
      <TextField
        id="new-project-name"
        autoFocus
        value={name}
        maxLength={60}
        placeholder="比如：雾港"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="lbl" style={{ padding: '8px 4px 0' }}>
        之后可以在配置里改名，补上类型、平台和美术风格。
      </div>
    </Sheet>
  )
}
