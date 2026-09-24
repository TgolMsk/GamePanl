# 界面基础：组件、钩子、store 用法

给开发四个界面（全局库、项目配置、构思、资料）的人看。外壳（侧栏、欢迎页、新建项目、HUD、拖入遮罩）已经做好，
各界面只需要实现 `screens/<界面>/index.tsx` 里的默认导出组件。

```
src/renderer/src/
  App.tsx              外壳：侧栏 + 主区（按路由渲染界面）+ 新建项目 sheet + HUD
  main.tsx             入口：引入样式、接管窗口拖放、挂 window.__gpDev
  styles/tokens.css    设计变量（颜色、圆角、字体、尺寸）——颜色只用这里的变量
  styles/components.css 通用组件样式（类名与原型一致：.btn .seg .group .rowi .hit .eye …）
  styles/app.css       外壳样式
  app/                 状态与工具：nav / data / hud / clipboard / drop / format / appInfo
  ui/                  组件（本目录），index.ts 统一导出
  shell/               外壳用的组件（侧栏、欢迎页、新建项目、拖入遮罩），界面不用管
  screens/             四个界面
```

## 导入方式

```ts
import { Toolbar, Button, ImageCard, QuickLook } from '@renderer/ui'
import { useLibImages } from '@renderer/app/data'
import { go } from '@renderer/app/nav'
import { hud } from '@renderer/app/hud'
import { copyImage, copyText, useCopiedFlag } from '@renderer/app/clipboard'
import { useFileDrop, usePasteImage } from '@renderer/app/drop'
import { formatBytes, formatDate, formatSize } from '@renderer/app/format'
import { imageUrl } from '@shared/api'
import type { LibImage } from '@shared/types'
```

> **注意：`app/` 没有汇总导出，不要写 `import … from '@renderer/app'`。**
> macOS 文件系统不区分大小写，`@renderer/app` 会被解析成 `App.tsx`。一律写到具体模块：`@renderer/app/data`。

## 推荐的页面骨架

```tsx
// screens/ProjectAssets/index.tsx
import './assets.css' // 本界面自己的样式放同目录，类名加前缀（如 .as-…），颜色只用 tokens 变量
import { Toolbar, Segmented, IconButton, EmptyState } from '@renderer/ui'
import { useAssets, useProject } from '@renderer/app/data'

export default function ProjectAssetsScreen({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useProject(projectId)
  const assets = useAssets(projectId)
  return (
    <div className="screen">
      <Toolbar title={project.data?.name ?? ''} subtitle={`资料 · ${assets.data.length} 张`}>
        <Segmented ariaLabel="按分类显示" value={cat} onChange={setCat} options={[{ value: 'all', label: '全部' }]} />
        <IconButton icon="plus" label="添加图片" onClick={pick} />
      </Toolbar>
      <div className="screen-body">
        <main className="screen-main" style={{ padding: '14px 20px 32px' }}>
          {assets.data.length === 0 && !assets.loading ? <EmptyState icon="photo" title="这里还没有资料" /> : …}
        </main>
        <aside className="inspector">…</aside>
      </div>
    </div>
  )
}
```

- `.screen`：纵向铺满主区；`.screen-body`：工具栏下面的横向区域；`.screen-main`：主内容（`flex:1`、自己滚动，加 `tint` 类变成 `--bg2` 灰底，
  配置页就是灰底）；`.inspector`：右侧检查器（宽 300、灰底、左边细线、内部纵向排列间距 16）。
- 项目界面由外壳用 `key={projectId}` 渲染：换项目时整个界面重建，不用自己处理 projectId 变化。
  全局库界面**不按 tab 重建**，三个 tab 共用一个组件实例（tab 从 props 传入）。
- 工具栏整条可以拖动窗口；放在里面的按钮、输入框、`.seg`、`.search`、`.popw` 会自动排除在拖动区外。
  自己写的可交互元素如果不是这几类，加 `tabIndex` 或写成 button。
- 主区背景是 `--win`（不透明），侧栏透出窗口毛玻璃，界面不用管。

## 组件（`@renderer/ui`）

### Icon
`<Icon name="photo" size={16} strokeWidth={1.7} />`，描边图标，颜色跟随 `currentColor`。
可用名称：`photo text palette controller slider bulb stack plus minus search eye copy check grid list folder xmark
chevron.down chevron.up.down chevron.left chevron.right square checkmark.square checklist compose trash pencil tag
star star.fill undo ellipsis doc tray.down info`。给 `title` 时作为读屏文字，否则对读屏隐藏。

### Button / IconButton
```tsx
<Button>取消</Button>
<Button variant="primary" icon="copy" onClick={copy}>复制</Button>
<Button variant="plain" size="sm">全部</Button>
<Button variant="danger">移到废纸篓</Button>        // 红色实心，一般只在 ConfirmSheet 里用
<IconButton icon="plus" label="添加图片" onClick={…} />   // 工具栏里的无边框图标按钮，label 必填
<IconButton icon="grid" label="网格" active={view === 'grid'} />
```
其余属性原样传给 `<button>`（`disabled`、`autoFocus`、`ref` 等），默认 `type="button"`。

### Segmented
```tsx
<Segmented ariaLabel="分类" value={tab} onChange={setTab}
  options={[{ value: 'all', label: '全部' }, { value: '角色', label: '角色' }]} />
<Segmented ariaLabel="显示方式" value={view} onChange={setView}
  options={[{ value: 'grid', icon: 'grid', title: '网格' }, { value: 'list', icon: 'list', title: '列表' }]} />
```
`value` 的类型会从 options 推断（字符串字面量联合）。只有图标时 `title` 必填。

### SearchField
`<SearchField value={q} onChange={setQ} placeholder="搜索图片素材" width={220} />`
受控；有内容时显示清除按钮；Esc 清空（已经是空的就失去焦点，放在 sheet 里时再按一次 Esc 关闭 sheet）。支持 `ref`、`autoFocus`。

### Toolbar
`<Toolbar title="全局库" subtitle="所有项目共用 · 14 张图片">{右侧控件}</Toolbar>`，高 52，下边细线。

### Sheet
```tsx
<Sheet open={open} onClose={() => setOpen(false)} title="添加图片" subtitle="原图存进工作台"
  width={660} height={560}
  accessory={<SearchField … />}      // 可选：标题栏右侧（关闭按钮前）
  closeButton={false}                // 可选：去掉右上角 ×
  bodyStyle={{ padding: 0 }}         // 可选：内容区默认 padding 20、超出滚动
  footer={<><span className="grow" /><Button onClick={close}>取消</Button><Button variant="primary">添加</Button></>}>
  …内容…
</Sheet>
```
- 居中模态，点遮罩 / Esc / × 调用 `onClose`；多层 sheet 时 Esc 只关最上面一层。
- 打开时焦点进 sheet（内容里有 `autoFocus` 的元素优先），关闭后还给原来的元素；Tab 在 sheet 内循环。
- 底部按钮栏里用 `<span className="grow" />` 把按钮推到右边（左边可以放「在访达中显示」或计数文字 `.lbl`）。
- 内容里的输入框自己处理 Esc 时调用 `e.stopPropagation()` 就不会关掉 sheet（SearchField、NumberField 已经这样做了）。

### ConfirmSheet
```tsx
<ConfirmSheet open={!!pending} title={`把「${pending?.name}」移到废纸篓？`} message="可以在访达的废纸篓里找回。"
  confirmLabel="移到废纸篓" destructive
  onCancel={() => setPending(null)}
  onConfirm={async () => { await window.gp.library.deleteImage(pending!.id); setPending(null) }} />
```
确认按钮默认获得焦点，回车确认；`onConfirm` 可以是 async，进行中重复点击无效；关闭由调用方把 `open` 设为 false。

### QuickLook
```tsx
const [viewId, setViewId] = useState<string | null>(null)
const viewing = images.data.find((x) => x.id === viewId) ?? null   // 从实时列表里取，改了标签能立刻看到
<QuickLook
  image={viewing && { ...viewing, ref: { scope: 'library', id: viewing.id } }}
  onClose={() => setViewId(null)}
  onTagsChange={(tags) => viewing && window.gp.library.updateImage(viewing.id, { tags })}   // 不给就只读
  extraRows={[{ label: '用于项目', value: '雾港' }]} />
```
940×600 大图预览：图片（按原图比例缩放，小像素图放大时保持锐利）+ 分类 / 尺寸 / 格式 / 大小 / 添加时间 / 额外行 + 标签，
底部 [在访达中显示] [关闭] [复制]。`LibImage`、`ProjectAsset` 展开后加上 `ref` 就是 `QuickLookImage`。

### ImageCard
```tsx
<ImageCard
  image={{ scope: 'project', projectId, id: a.id }}
  name={a.name}
  meta={`${formatSize(a.width, a.height)} · ${a.format}`}
  aspect={a.width / a.height}      // 图片区宽高比，默认 1；或 frameHeight={160} 固定高度；或 fill 撑满格子
  selected={selId === a.id}        // 3px 强调色选中环
  onClick={() => setSelId(a.id)}   // 单击时先做的事，之后照常复制
  onView={() => setViewId(a.id)}   // 给了才显示右上角「查看」
  dataId={a.id}
/>
```
- 单击 = 复制原图（默认 `copyImage(image, name)`，弹 HUD），成功后左上角「✓ 已复制」2 秒。要换复制行为传 `copy={() => Promise<boolean>}`。
- 悬停显示「点击复制」胶囊和查看按钮；图片用 `imageUrl(ref, thumb)` 缩略图（默认 480），`object-fit: cover`，加载失败显示占位图标。
- `caption={false}` 只要图；`fill` 用在固定行高的网格里（卡片需要在有高度的格子里）。
- 列表行、提示词卡片等不是图片卡片的地方，照原型用 `.card` / `.hit` / `.eye.soft` / `.done` 等类自己搭，配合 `useCopiedFlag`。

### Tag / TagEditor
```tsx
<Tag>像素</Tag>
<Tag size="xs">玩法</Tag>
<Tag onRemove={() => …}>夜景</Tag>
<TagEditor tags={a.tags} onChange={(tags) => window.gp.projects.updateAsset(projectId, a.id, { tags })} />
```
TagEditor：回车添加（去重、去首尾空格）、× 删除、空输入框里按删除键删最后一个；输入法组词时回车不响应。一组只读标签用 `<div className="tags">`。

### Chip
`<Chip selected={on} onClick={toggle}>2D 横版动作</Chip>`，多选胶囊，选中是强调色实心并带对勾（`check={false}` 去掉对勾）。

### GroupList / GroupRow（系统设置式分组）
```tsx
<GroupList title="基本">
  <GroupRow label="类型" top fill>{chips}</GroupRow>                  // top：顶部对齐；fill：控件从左往右铺开
  <GroupRow label="目标玩家" htmlFor="players" top><TextArea id="players" … /></GroupRow>
  <GroupRow label="单局时长" htmlFor="dur"><Select id="dur" variant="fill" … /></GroupRow>   // 默认控件靠右
  <GroupRow label="尺寸" value="1536×1024" />                           // 只读值：右对齐灰字
</GroupList>
<GroupList>                                                            // 不要小标题
  <GroupRow compact label="格式" value="PNG" />                          // compact：高 34，检查器里用
</GroupList>
```
标签默认宽 120（compact 行按文字宽度），`labelWidth` 可改。需要特殊布局时直接用 `.group` + `.rowi`（见 components.css）。

### TextField / TextArea / NumberField
```tsx
<TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="项目名称" />   // 原生 input 属性全部可用
<TextArea value={v} onChange={…} minRows={2} maxRows={8} />          // 随内容自动增高
<NumberField value={w} min={1} max={4096} onChange={setW} ariaLabel="宽" />   // 回车 / 失焦提交，↑↓ 加减，乱填恢复
```
名称这类「边打字边存」的字段：本地 state 保存草稿，失焦或停顿后再调接口，用返回值 `mutate` 进缓存（见数据钩子）。

### Select
```tsx
<Select value={p.sessionLength} options={SESSION_OPTIONS} onChange={…} placeholder="未设置" variant="fill" />
<Select value={cat} options={[{ value: '概念图' }, { value: '角色', label: '角色' }]} onChange={setCat} />
```
原生 select（点开是系统菜单）。`variant="fill"` 是灰底无边（配置页），默认白底描边。当前值不在选项里时显示 `placeholder`。

### Stepper
`<Stepper value={w} min={1} max={512} step={1} onChange={setW} label="角色尺寸" />`，− / + 两个按钮，到边界自动禁用。

### Swatch
`<Swatch hex="#1b1f3a" />`（圆点 + 色值胶囊）或 `<Swatch hex={h} variant="block" />`（大色块 + 色值），单击复制色值并弹 HUD「已复制色值 #1b1f3a」。

### EmptyState
`<EmptyState icon="photo" title="这里还没有图片素材" hint="把图片拖到这里，或 ⌘V 粘贴"><Button>添加图片…</Button></EmptyState>`
在父容器里居中（父容器要有高度，`.screen-main` 就可以）。

### Hud
外壳已经渲染，界面不要再放。用 `hud.show()` 触发（见下）。

## 状态与工具（`@renderer/app/*`）

### 导航 `app/nav`
```ts
type Route =
  | { view: 'library'; tab: 'images' | 'prompts' | 'styles' }
  | { view: 'project'; projectId: string; tab: 'config' | 'notes' | 'assets' }
  | { view: 'welcome' }
go({ view: 'project', projectId, tab: 'notes' })        // 组件外也能调用
const route = useRoute()                                // 组件里读当前路由
```
上次的位置记在 localStorage，下次启动回到那里；当前项目被删掉时外壳自动回到全局库。
测试 / 截图用：`window.__gpDev.go({ view: 'project', tab: 'assets' })`（projectId 省略 = 第一个项目，tab 省略 = 第一个 tab）。

### 数据钩子 `app/data`
```ts
const images = useLibImages()        // Resource<LibImage[]>
const prompts = usePrompts()         // Resource<Prompt[]>
const styles = useStyles()           // Resource<Style[]>
const projects = useProjects()       // Resource<ProjectSummary[]>
const project = useProject(id)       // Resource<Project | undefined>
const notes = useNotes(projectId)    // Resource<Note[]>
const assets = useAssets(projectId)  // Resource<ProjectAsset[]>

interface Resource<T> {
  data: T                     // 列表在第一次读到之前是 []，useProject 是 undefined
  loading: boolean            // 只有第一次读取时为 true
  error: string | null        // 最近一次读取失败的原因
  refresh(): Promise<void>    // 立即重新读
  mutate(next | prev => next) // 直接改本地缓存（乐观更新）
}
```
- 同一份数据多处使用只读一次（zustand 缓存）。主进程广播 `onDataChanged` 后按 kind 自动重新读，
  所以**写操作之后一般什么都不用做**：`await window.gp.library.updateImage(id, patch)` 之后列表会自己刷新。
- 想让界面立刻反映（比如打字改名），用接口返回的新对象：
  `const p = await window.gp.projects.update(id, { name }); project.mutate(p)`，
  或先乐观改：`notes.mutate((list) => list.map((n) => (n.id === note.id ? note : n)))` 再调接口。
- 笔记、资料、项目配置的变化也会刷新项目列表（侧栏计数跟着变）。

### HUD `app/hud`
```ts
hud.show('已添加 3 张到「雾港」', { ok: true })                      // 前面带对勾，2 秒消失
hud.show('已移到废纸篓', { action: { label: '撤销', run: undo } })     // 带按钮，5 秒消失
hud.hide()
```
同一时间只显示一条，新的替换旧的。

### 复制 `app/clipboard`
```ts
await copyImage(ref, name)       // 原图写进剪贴板；HUD「已复制图片 · 可以直接粘贴到 ChatGPT / PS」/「复制失败」；返回 boolean
await copyText(text, '提示词')    // HUD「已复制提示词」；返回 boolean
const [copiedId, markCopied] = useCopiedFlag()   // 显示「✓ 已复制」角标 2 秒
onClick={async () => { if (await copyText(p.body, '提示词')) { markCopied(p.id); window.gp.library.markPromptUsed(p.id) } }}
{copiedId === p.id && <span className="done"><Icon name="check" size={11} strokeWidth={2.4} />已复制</span>}
```

### 拖入与粘贴 `app/drop`
```ts
// 页面级：从访达拖图片进窗口，外壳在主区显示「松手添加」遮罩
useFileDrop((paths) => window.gp.projects.importAssets(projectId, paths), { label: `松手添加到「${name}」` })

// ⌘V：焦点在输入框里时不拦截
usePasteImage(async (p) => {
  const added = p.kind === 'files'
    ? await window.gp.library.importImages(p.paths)
    : await window.gp.library.importImageFromClipboard()
})
```
- 只接受 PNG / JPG / WebP / GIF，其他文件会提示「只能添加图片（PNG、JPG、WebP、GIF）」。
- 只有最上层会收到：打开 sheet 后页面上的拖入 / 粘贴自动停用。在 sheet 里调用 `useFileDrop`，就由这个 sheet 接收，
  返回值（是否正在拖入）用来高亮拖入区：`<div className={dragging ? 'drop on' : 'drop'}>`（sheet 里没有全局遮罩）。
- 一个界面只注册一个页面级拖入和一个粘贴；`{ enabled: false }` 可以临时停用。
- 「选择文件…」按钮直接调 `importImages()` / `importAssets(projectId)` 不传路径，主进程会弹系统文件框。

### 格式化 `app/format`
```ts
formatBytes(134144)                         // "131 KB"；2.4 MB
formatDate(iso)                             // "今天 14:32" / "昨天" / "9月21日" / "2025年9月21日"
formatDate(iso, { time: true })             // "昨天 11:40" / "9月21日 14:25"
formatSize(1536, 1024)                      // "1536×1024"
```

### 应用信息 `app/appInfo`
`const info = useAppInfo()` → `AppInfo | null`（版本、数据目录等）。系统强调色已经由外壳写进 `--acc`，
在系统设置里换了强调色，窗口重新获得焦点时会跟着变。

## 样式约定

- 颜色、圆角、尺寸只用 `tokens.css` 的变量；深色模式靠 `prefers-color-scheme` 自动切换，不要写 `.dark`。
- 图片上的深色浮层用 `--img-pill` / `--img-btn`，上面的文字用 `--on-dark`；聚焦环用 `--ring` / `--ring-soft`（见 components.css 顶部）。
- 不要阴影、渐变、emoji；分隔线 0.5px `var(--sep)`；选中环和聚焦环是唯一允许的 box-shadow。
- 次要文字用 `--tx2`，`--tx3` 只用于图标、占位符、禁用态。
- 原型里的类名（`.btn .pri .plain .tbtn .seg .search .group .rowi .k .v .gh .lbl .tag .chip .fld .popw .stp .swt .swb
  .card .hit .frame .pill .eye .done .cap .meta .checker .ph .drop .shead .stt .sfoot .hud`）在 components.css 里都有，
  照原型搬结构时可以直接用。界面自己的类放 `screens/<界面>/*.css`，加前缀，别改 components.css 里已有的类。
