import { useEffect, useId, useMemo, useState } from 'react'
import { copyText } from '@renderer/app/clipboard'
import { useLibImages, useLibModels, useStyles } from '@renderer/app/data'
import { LibraryPickerSheet } from '@renderer/screens/ProjectAssets/LibraryPickerSheet'
import { Button, Chip, GroupList, GroupRow, Select, Sheet, TagEditor, TextArea, TextField } from '@renderer/ui'
import { imageUrl } from '@shared/api'
import { MODEL_CATEGORIES, type ID, type ModelCategory } from '@shared/types'
import { dataRoot } from './actions'
import {
  ACTION_PRESETS,
  ASSET_ID,
  buildGeneratePrompt,
  DEFAULT_ACTIONS,
  ENGINES,
  FACE_BUDGETS,
  type ConceptMode,
  type Engine
} from './generatePrompt'

export interface GenerateSheetProps {
  open: boolean
  onClose: () => void
  /** 打开时的分类（正在看某个分类时用它） */
  category: ModelCategory
  /** 导入做好的资产（整个资产文件夹）；有模型落地返回 true */
  onImport: (paths: string[]) => Promise<boolean>
}

/** 用 Claude Code 生成模型：填需求 → 拼出提示词 → 复制到 Claude Code 里运行 → 做完一键导入 */
export function GenerateSheet(props: GenerateSheetProps): React.JSX.Element | null {
  // 每次打开都是新的一份需求（资产库目录、引擎等常用项会记住）
  return props.open ? <Generate {...props} /> : null
}

const STORE_KEY = 'gamepanl.generateModel'

interface Remembered {
  root: string
  engine: Engine
  faces: string
  concept: ConceptMode
}

function loadRemembered(): Partial<Remembered> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Remembered> | null
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function saveRemembered(v: Remembered): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v))
  } catch {
    // 记不住只是下次要重新选
  }
}

const CONCEPTS: ReadonlyArray<{ value: ConceptMode; label: string }> = [
  { value: 'codex', label: '用 Codex CLI 生成' },
  { value: 'refs', label: '用参考图' },
  { value: 'none', label: '不要设定图' }
]

const NO_STYLE = ''

/** 名称是英文时顺手给出 id */
function idFromName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(s) ? s.slice(0, 48) : ''
}

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

function Generate({ onClose, category: initialCategory, onImport }: GenerateSheetProps): React.JSX.Element {
  const models = useLibModels()
  const images = useLibImages()
  const styles = useStyles()
  const ids = { name: useId(), id: useId(), cat: useId(), size: useId(), faces: useId(), style: useId(), concept: useId(), engine: useId() }

  const remembered = useMemo(loadRemembered, [])
  // 资产库目录：记住的，或从已导入模型的来源推断（…/<资产库>/<id>/export）
  const guessedRoot = useMemo(() => {
    const m = models.data.find((x) => /\/[^/]+\/export$/.test(x.importedFrom))
    return m ? m.importedFrom.replace(/\/[^/]+\/export$/, '') : ''
  }, [models.data])

  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [category, setCategory] = useState<ModelCategory>(initialCategory)
  const [desc, setDesc] = useState('')
  const [size, setSize] = useState('')
  const [faces, setFaces] = useState(remembered.faces ?? '10000')
  const [actions, setActions] = useState<string[]>(DEFAULT_ACTIONS[initialCategory])
  const [actionsTouched, setActionsTouched] = useState(false)
  const [refIds, setRefIds] = useState<ID[]>([])
  const [styleId, setStyleId] = useState(NO_STYLE)
  const [concept, setConcept] = useState<ConceptMode>(remembered.concept ?? 'codex')
  const [engine, setEngine] = useState<Engine>(remembered.engine ?? 'Godot 4')
  const [rootPicked, setRootPicked] = useState(remembered.root ?? '')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [root0, setRoot0] = useState('')
  useEffect(() => {
    void dataRoot().then(setRoot0)
  }, [])

  const root = rootPicked || guessedRoot
  const refImages = refIds.flatMap((rid) => images.data.find((x) => x.id === rid) ?? [])
  const refPaths = root0 ? refImages.map((img) => `${root0}/library/images/${img.file}`) : []
  const style = styles.data.find((s) => s.id === styleId) ?? null
  const effectiveConcept: ConceptMode = concept === 'refs' && refImages.length === 0 ? 'codex' : concept

  useEffect(() => {
    saveRemembered({ root: rootPicked, engine, faces, concept })
  }, [rootPicked, engine, faces, concept])

  const prompt = buildGeneratePrompt({
    id,
    name,
    category,
    desc,
    size,
    faces,
    actions,
    root,
    engine,
    concept: effectiveConcept,
    refs: refPaths,
    style
  })

  const idOk = ASSET_ID.test(id)
  const missing = [!name.trim() && '名称', !idOk && '资产 id', !desc.trim() && '描述', !root && '资产库目录'].filter(Boolean)
  const exists = idOk && models.data.some((m) => m.id === id)

  const changeName = (v: string): void => {
    setName(v)
    if (!idTouched) setId(idFromName(v))
  }
  const changeCategory = (c: ModelCategory): void => {
    setCategory(c)
    if (!actionsTouched) setActions(DEFAULT_ACTIONS[c])
  }
  const changeActions = (next: string[]): void => {
    setActions(next)
    setActionsTouched(true)
  }
  const pickRoot = async (): Promise<void> => {
    const p = await window.gp.app.pickFolder('选择资产库目录', root || undefined)
    if (p) setRootPicked(p)
  }
  const importResult = async (): Promise<void> => {
    if (!idOk || !root || busy) return
    setBusy(true)
    const ok = await onImport([`${root}/${id}`])
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="用 Claude Code 生成模型"
      subtitle="填好需求，复制提示词到 Claude Code 里运行；做完点「导入结果」进库"
      width={1000}
      height={660}
      bodyClassName="gen-body"
      footer={
        <>
          <Button disabled={!idOk || !root || busy} onClick={() => void importResult()}>
            导入结果
          </Button>
          <span className="lbl">{missing.length > 0 ? `还差：${missing.join('、')}` : exists ? `全局库里已经有「${id}」` : ''}</span>
          <span className="grow" />
          <Button onClick={onClose}>关闭</Button>
          <Button disabled={!root} onClick={() => void copyText(`cd ${shellQuote(root)} && claude`, '启动命令 · 粘贴到终端运行')}>
            复制启动命令
          </Button>
          <Button variant="primary" icon="copy" onClick={() => void copyText(prompt, '提示词 · 粘贴到 Claude Code 里')}>
            复制提示词
          </Button>
        </>
      }
    >
      <div className="gen-form">
        <GroupList>
          <GroupRow label="名称" htmlFor={ids.name} labelWidth={72}>
            <TextField id={ids.name} value={name} maxLength={100} placeholder="如：火焰石像鬼" onChange={(e) => changeName(e.target.value)} />
          </GroupRow>
          <GroupRow label="资产 id" htmlFor={ids.id} labelWidth={72}>
            <TextField
              id={ids.id}
              value={id}
              maxLength={48}
              placeholder="fire_gargoyle（文件夹名）"
              spellCheck={false}
              onChange={(e) => {
                setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
                setIdTouched(true)
              }}
            />
          </GroupRow>
          <GroupRow label="分类" htmlFor={ids.cat} labelWidth={72}>
            <Select id={ids.cat} value={category} options={MODEL_CATEGORIES} onChange={changeCategory} />
          </GroupRow>
          <GroupRow label="尺寸" htmlFor={ids.size} labelWidth={72}>
            <TextField id={ids.size} value={size} maxLength={100} placeholder="如：高约 2.2 m，翼展 4 m" onChange={(e) => setSize(e.target.value)} />
          </GroupRow>
          <GroupRow label="面数" htmlFor={ids.faces} labelWidth={72}>
            <Select id={ids.faces} value={faces} options={FACE_BUDGETS} onChange={setFaces} />
          </GroupRow>
        </GroupList>

        <section className="gsec">
          <div className="gh">描述</div>
          <TextArea
            minRows={4}
            maxRows={8}
            value={desc}
            maxLength={4000}
            placeholder="外形、材质、配色、特征，比如：岩石身躯、熔岩裂缝发光、背上一对残破石翼、四足伏地…"
            onChange={(e) => setDesc(e.target.value)}
          />
        </section>

        <section className="gsec">
          <div className="gh">动作</div>
          <TagEditor tags={actions} onChange={changeActions} placeholder={actions.length ? '添加动作' : '没有动作 = 静态模型，不绑骨'} />
          <div className="gen-presets">
            {ACTION_PRESETS.filter((a) => !actions.includes(a)).map((a) => (
              <Chip key={a} onClick={() => changeActions([...actions, a])}>
                + {a}
              </Chip>
            ))}
          </div>
        </section>

        <GroupList>
          <GroupRow label="参考图" labelWidth={72}>
            <div className="gen-refs">
              {refImages.map((img) => (
                <img key={img.id} src={imageUrl({ scope: 'library', id: img.id }, 96)} alt={img.name} title={img.name} />
              ))}
              <Button size="sm" onClick={() => setPicking(true)}>
                {refImages.length > 0 ? '更换…' : '从图片素材选…'}
              </Button>
              {refImages.length > 0 && (
                <Button size="sm" variant="plain" onClick={() => setRefIds([])}>
                  清除
                </Button>
              )}
            </div>
          </GroupRow>
          <GroupRow label="设定图" htmlFor={ids.concept} labelWidth={72}>
            <Select id={ids.concept} value={concept} options={CONCEPTS} onChange={setConcept} />
          </GroupRow>
          <GroupRow label="风格" htmlFor={ids.style} labelWidth={72}>
            <Select
              id={ids.style}
              value={styleId}
              options={[{ value: NO_STYLE, label: '不指定' }, ...styles.data.map((s) => ({ value: s.id, label: s.name || '未命名风格' }))]}
              onChange={setStyleId}
            />
          </GroupRow>
        </GroupList>

        <GroupList>
          <GroupRow label="资产库" labelWidth={72}>
            <div className="gen-root">
              <span className="path" title={root}>
                {root ? `…/${root.split('/').slice(-2).join('/')}` : '还没选'}
              </span>
              <Button size="sm" onClick={() => void pickRoot()}>
                选择…
              </Button>
            </div>
          </GroupRow>
          <GroupRow label="目标引擎" htmlFor={ids.engine} labelWidth={72}>
            <Select id={ids.engine} value={engine} options={ENGINES} onChange={setEngine} />
          </GroupRow>
        </GroupList>
      </div>

      <div className="gen-out">
        <div className="gh">提示词</div>
        <pre className="gen-pre">{prompt}</pre>
        <div className="lbl gen-tip">
          在终端运行 <code>cd 资产库 &amp;&amp; claude</code>（可用「复制启动命令」），把提示词粘贴进去回车。做完后点左下角「导入结果」，会导入
          <code>{root ? `${root}/${id || '<资产id>'}` : '<资产库>/<资产id>'}</code> 下的 export/。
        </div>
      </div>

      <LibraryPickerSheet
        open={picking}
        projectName=""
        title="选择参考图"
        subtitle="从图片素材里选，Claude Code 会直接读这些图"
        confirmLabel={(n) => (n > 0 ? `用这 ${n} 张` : '选择')}
        onClose={() => setPicking(false)}
        onAdd={async (picked) => {
          setRefIds(picked)
          if (picked.length > 0) setConcept('refs')
          setPicking(false)
          return true
        }}
      />
    </Sheet>
  )
}
