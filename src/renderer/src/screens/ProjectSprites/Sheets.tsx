// 两个弹出面板：在源帧上框选水印、导出。
import { useEffect, useRef, useState } from 'react'
import { hud } from '@renderer/app/hud'
import { showError } from '@renderer/screens/Library/shared'
import { sourceFrame, type ActionOutput, type CharacterOutput } from '@renderer/sprites/engine'
import { Button, Chip, GroupList, GroupRow, Segmented, Sheet, TextField } from '@renderer/ui'
import type { SpriteAssetNames } from '@shared/api'
import type { ID } from '@shared/types'
import { safeFileName, type SpriteCharacter, type SpriteOwner, type SpriteWatermark } from '@shared/sprites'
import { buildPayload, EXPORT_SCALES } from './bundle'
import { prepCanvas, toBitmap } from './draw'

type Rect = [number, number, number, number]

export function WatermarkSheet({
  out,
  value,
  onClose,
  onSave
}: {
  out: ActionOutput | null
  value: SpriteWatermark
  onClose: () => void
  onSave: (v: SpriteWatermark) => void
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [rect, setRect] = useState<Rect | null>(Array.isArray(value) ? value : null)
  const boxRef = useRef<HTMLDivElement>(null)
  const frame = out?.analysis.picks[0]?.frame ?? 0

  useEffect(() => {
    setRect(Array.isArray(value) ? value : null)
  }, [value, out])

  useEffect(() => {
    if (!out) return
    let dead = false
    void sourceFrame(out.key, frame, null, 1280).then(async (r) => {
      if (dead || !ref.current) return
      const s = Math.min(600 / r.width, 400 / r.height)
      const w = Math.round(r.width * s)
      const h = Math.round(r.height * s)
      const ctx = prepCanvas(ref.current, w, h)
      const bmp = await toBitmap(r.rgba, r.width, r.height)
      if (ctx) {
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(bmp, 0, 0, w, h)
      }
      bmp.close()
      setSize([w, h])
    })
    return () => {
      dead = true
    }
  }, [out, frame])

  const down = (e: React.PointerEvent): void => {
    const el = boxRef.current
    if (!el || !size) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    const at = (cx: number, cy: number): [number, number] => [
      Math.min(1, Math.max(0, (cx - r.left) / r.width)),
      Math.min(1, Math.max(0, (cy - r.top) / r.height))
    ]
    const [x0, y0] = at(e.clientX, e.clientY)
    const move = (m: PointerEvent): void => {
      const [x1, y1] = at(m.clientX, m.clientY)
      setRect([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)])
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const boxStyle = (b: Rect): React.CSSProperties =>
    size ? { left: b[0] * size[0], top: b[1] * size[1], width: (b[2] - b[0]) * size[0], height: (b[3] - b[1]) * size[1] } : {}
  const valid = rect !== null && rect[2] - rect[0] > 0.01 && rect[3] - rect[1] > 0.01
  const detected = out?.analysis.watermark.regions ?? []

  return (
    <Sheet
      open={out !== null}
      onClose={onClose}
      title="水印区域"
      subtitle="在源帧上拖出要屏蔽的区域（这块区域里的像素一律当背景）"
      width={660}
      footer={
        <>
          <Button size="sm" onClick={() => onSave('auto')}>
            自动检测
          </Button>
          <Button size="sm" onClick={() => onSave('none')}>
            不屏蔽
          </Button>
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!valid} onClick={() => rect && onSave(rect.map((v) => Math.round(v * 1000) / 1000) as Rect)}>
            使用框选区域
          </Button>
        </>
      }
    >
      <div ref={boxRef} className="sp-wm" style={size ? { width: size[0], height: size[1] } : { height: 400 }} onPointerDown={down}>
        <canvas ref={ref} />
        {detected.map((b, k) => (
          <div key={k} className="box det" style={boxStyle(b as unknown as Rect)} title="自动检出的水印" />
        ))}
        {rect && <div className="box" style={boxStyle(rect)} />}
      </div>
      <div className="sp-note" style={{ marginTop: 10, textAlign: 'center' }}>
        虚线框是自动检出的水印{detected.length ? '' : '（这个视频没检出）'}。框选区域和角色重叠时，角色那一块也会被抠掉。
      </div>
    </Sheet>
  )
}

export function ExportSheet({
  open,
  owner,
  ch,
  output,
  failed,
  onClose
}: {
  open: boolean
  /** 项目 id；null 为全局库（存进图片素材） */
  owner: SpriteOwner
  ch: SpriteCharacter
  output: CharacterOutput | null
  /** 处理失败、不会导出的动作名 */
  failed: string[]
  onClose: () => void
}): React.JSX.Element {
  const prefs = ch.exportPrefs
  const [dir, setDir] = useState<string | null>(prefs.dir)
  const [detected, setDetected] = useState<string | null>(null)
  const [manual, setManual] = useState(prefs.godotPrefix ?? '')
  const [godotMode, setGodotMode] = useState<'auto' | 'manual'>(prefs.godotPrefix ? 'manual' : 'auto')
  const [assets, setAssets] = useState(prefs.updateAssets)
  const modeOf = (): 'off' | 'character' | 'action' => (prefs.toAssets2D ? prefs.assets2dMode : 'off')
  const [mode, setMode] = useState(modeOf)
  const toAssets2D = mode !== 'off'
  const [skip, setSkip] = useState<Set<ID>>(() => new Set(prefs.skip))
  // 资产名称：只记用户改过的（没改的用库里现在的名称或默认名，导出时不动库里的名称）
  const [charName, setCharName] = useState<string | null>(null)
  const [actNames, setActNames] = useState<Record<ID, string>>({})
  const [libNames, setLibNames] = useState<Map<ID, string>>(new Map())
  const [scale, setScale] = useState(prefs.scale)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDir(prefs.dir)
    setManual(prefs.godotPrefix ?? '')
    setGodotMode(prefs.godotPrefix ? 'manual' : 'auto')
    setAssets(prefs.updateAssets)
    setMode(modeOf())
    setSkip(new Set(prefs.skip))
    setCharName(null)
    setActNames({})
    setScale(prefs.scale)
    let dead = false
    void window.gp.library.listAssets2D().then(
      (list) => !dead && setLibNames(new Map(list.map((x) => [x.id, x.name]))),
      () => undefined
    )
    return () => {
      dead = true
    }
    // 只在打开时取一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!dir) {
      setDetected(null)
      return
    }
    let dead = false
    void window.gp.sprites.detectGodot(dir).then((r) => !dead && setDetected(r))
    return () => {
      dead = true
    }
  }, [dir])

  const pick = async (): Promise<void> => {
    const d = await window.gp.app.pickFolder('选择导出位置', dir ?? undefined)
    if (d) setDir(d)
  }

  const name = safeFileName(ch.name)
  const assetPlace = owner === null ? '图片素材' : '资料'
  // 按列表顺序列出能导出的动作；勾掉的这次不导出
  const all = output ? ch.actions.filter((a) => output.actions.some((o) => o.actionId === a.id)) : []
  const chosen = all.filter((a) => !skip.has(a.id))
  const outs = output ? output.actions.filter((o) => !skip.has(o.actionId)) : []
  const sizes = outs.map((o) => `${o.frameWidth * scale}×${o.frameHeight * scale}`)
  const sizeText = [...new Set(sizes)].slice(0, 3).join('、') + (new Set(sizes).size > 3 ? ' 等' : '')
  const names = chosen.map((a) => a.name)
  const toggle = (id: ID): void =>
    setSkip((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const defaultCharName = (ch.asset2dId && libNames.get(ch.asset2dId)) || ch.name
  const defaultActName = (a: SpriteCharacter['actions'][number]): string => (a.asset2dId && libNames.get(a.asset2dId)) || `${ch.name} · ${a.name}`
  const nothing = chosen.length === 0
  const failedVideos = failed.filter((name) => ch.actions.some((action) => action.video && action.name === name))
  const manualOk = /^res:\/\/[^\s]*$/.test(manual.trim())

  const run = async (): Promise<void> => {
    if ((!dir && !toAssets2D) || !output || nothing) return
    setBusy(true)
    try {
      // 只记还在的动作，删掉的动作不留在 skip 里
      const keepSkip = [...skip].filter((id) => ch.actions.some((a) => a.id === id))
      await window.gp.sprites.update(owner, ch.id, {
        exportPrefs: {
          ...prefs,
          godotPrefix: godotMode === 'manual' && manualOk ? manual.trim() : null,
          updateAssets: assets,
          toAssets2D,
          assets2dMode: mode === 'action' ? 'action' : 'character',
          skip: keepSkip,
          scale
        }
      })
      const assetNames: SpriteAssetNames = {
        ...(charName !== null && charName.trim() && { character: charName.trim() }),
        actions: Object.fromEntries(Object.entries(actNames).filter(([id, v]) => v.trim() && chosen.some((a) => a.id === id)).map(([id, v]) => [id, v.trim()]))
      }
      const r = await window.gp.sprites.export(owner, ch.id, buildPayload(ch, output, scale, skip), dir, assetNames)
      onClose()
      const stored = r.assets2d.length > 1 ? `${r.assets2d.length} 个 2D 资产` : r.assets2d[0] ? `2D 资产库「${r.assets2d[0].name}」` : ''
      const done = dir ? `已导出「${ch.name}」· ${r.files} 个文件${stored ? `，已存进 ${stored}` : ''}` : `已存进 ${stored}`
      hud.show(`${done}${r.assets ? `，${r.assets} 张存进了${assetPlace}` : ''}`, {
        action: { label: '在访达中显示', run: () => void window.gp.sprites.reveal(r.folder) }
      })
    } catch (err) {
      showError('导出失败', err)
    } finally {
      setBusy(false)
    }
  }

  const tree = [
    `${name}/`,
    `  ${name}_atlas.png      全部动作的图集`,
    `  ${name}.json           通用 JSON`,
    `  ${name}.aseprite.json  Aseprite 格式（Phaser / Unity 插件）`,
    `  ${name}_spriteframes.tres  Godot 4 SpriteFrames`,
    `  ${name}.tscn           Godot 场景（AnimatedSprite2D）`,
    `  report.json  README.txt`,
    ...names.map((n) => `  ${safeFileName(n)}/  sheet.png  frames/  preview.gif  preview_x4.png`)
  ].join('\n')

  const godotPrefix = godotMode === 'manual' ? (manualOk ? manual.trim() : null) : detected

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`导出「${ch.name}」`}
      subtitle={output ? `${chosen.length} / ${all.length} 个动作 · ${output.palette.length} 色${scale > 1 ? ` · 放大 ${scale}×` : ''}` : '还在处理'}
      width={600}
      footer={
        <>
          <span className="grow" />
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={(!dir && !toAssets2D) || !output || busy || nothing} onClick={() => void run()}>
            {busy ? '正在导出…' : dir || !toAssets2D ? '导出' : '存进 2D 资产库'}
          </Button>
        </>
      }
    >
      <div className="gsec" style={{ gap: 16, display: 'flex', flexDirection: 'column' }}>
        <GroupList>
          {all.length > 1 && (
            <GroupRow label="导出动作" top>
              <div className="sp-export-acts" role="group" aria-label="导出哪些动作">
                {all.map((a) => (
                  <Chip key={a.id} selected={!skip.has(a.id)} onClick={() => toggle(a.id)}>
                    {a.name}
                  </Chip>
                ))}
              </div>
            </GroupRow>
          )}
          <GroupRow label="导出到" top>
            <span className="sp-path">{dir ? `${dir}/${name}/` : '不导出到文件夹'}</span>
            <Button size="sm" onClick={() => void pick()}>
              选择…
            </Button>
            {dir && <Button size="sm" onClick={() => setDir(null)}>不导出</Button>}
          </GroupRow>
          {dir && (
            <>
              <GroupRow label="Godot 路径" top>
                <Segmented
                  ariaLabel="Godot 路径"
                  value={godotMode}
                  onChange={setGodotMode}
                  options={[
                    { value: 'auto', label: '自动' },
                    { value: 'manual', label: '手动' }
                  ]}
                />
              </GroupRow>
              {godotMode === 'manual' ? (
                <GroupRow label="res:// 目录">
                  <TextField value={manual} onChange={(e) => setManual(e.target.value)} placeholder="res://art/characters" style={{ maxWidth: 280 }} />
                </GroupRow>
              ) : (
                <GroupRow label=" " value={detected ? `${detected.replace(/\/$/, '')}/${name}/` : '不在 Godot 项目里，资源里写相对路径'} />
              )}
            </>
          )}
          <GroupRow label="放大倍数" top>
            <Segmented
              ariaLabel="导出放大倍数"
              value={String(scale)}
              onChange={(v) => setScale(Number(v))}
              options={EXPORT_SCALES.map((k) => ({ value: String(k), label: `${k}×` }))}
            />
          </GroupRow>
          <GroupRow label=" " value={output ? `每帧 ${sizeText} 像素${scale > 1 ? `（原尺寸 × ${scale}，最近邻放大，像素不糊）` : '（原尺寸）'}` : ''} />
          <GroupRow label={owner === null ? '同时存进图片素材' : '同时存进资料'}>
            <Segmented
              ariaLabel={owner === null ? '同时存进图片素材' : '同时存进项目资料'}
              value={assets ? 'on' : 'off'}
              onChange={(v) => setAssets(v === 'on')}
              options={[
                { value: 'on', label: '图集和动图' },
                { value: 'off', label: '不存' }
              ]}
            />
          </GroupRow>
          <GroupRow label="存进 2D 资产库" top>
            <Segmented
              ariaLabel="存进 2D 资产库"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'character', label: '整个角色一个' },
                { value: 'action', label: '每个动作单独' },
                { value: 'off', label: '不存' }
              ]}
            />
          </GroupRow>
          {mode === 'character' && (
            <GroupRow label="资产名称">
              <TextField
                value={charName ?? defaultCharName}
                maxLength={80}
                aria-label="2D 资产名称"
                placeholder={ch.name}
                onChange={(e) => setCharName(e.target.value)}
                style={{ maxWidth: 320 }}
              />
            </GroupRow>
          )}
          {mode === 'action' &&
            chosen.map((a) => (
              <GroupRow key={a.id} label={a.name}>
                <TextField
                  value={actNames[a.id] ?? defaultActName(a)}
                  maxLength={80}
                  aria-label={`「${a.name}」的 2D 资产名称`}
                  placeholder={`${ch.name} · ${a.name}`}
                  onChange={(e) => setActNames((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  style={{ maxWidth: 320 }}
                />
              </GroupRow>
            ))}
        </GroupList>
        {nothing && <div className="sp-msg err" style={{ textAlign: 'left', maxWidth: 'none' }}>至少选一个动作</div>}
        {failedVideos.length > 0 && <div className="sp-msg err" style={{ textAlign: 'left', maxWidth: 'none' }}>处理失败、不会导出：{failedVideos.join('、')}</div>}
        <div className="group sp-files">{tree}</div>
        <div className="sp-note">
          {dir && godotPrefix ? `Godot 里直接用 ${godotPrefix.replace(/\/$/, '')}/${name}/${name}.tscn。` : ''}
          {dir ? '再次导出到同一位置会覆盖这些文件，文件夹里你自己放的其他文件不会动。' : ''}
          {mode === 'character' ? ' 2D 资产库里上次导出的角色会更新，分类和标签保留。' : ''}
          {mode === 'action' ? ` 每个动作在 2D 资产库里是一个单独的资产（${chosen.length} 个），再次导出时更新各自那一个，分类和标签保留。` : ''}
          {assets ? ` ${assetPlace}里上次导出的图会换成新的。` : ''}
        </div>
      </div>
    </Sheet>
  )
}
