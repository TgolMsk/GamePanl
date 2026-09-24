# GamePanl 开发说明

## 产品
按游戏项目聚合的**策划工作台**（macOS 桌面应用，Electron）。
- **全局库**（所有项目共用，用户自己积累）：图片素材、提示词、风格。
- **项目**（一款游戏的策划本，不是引擎工程）：配置（类型、平台、美术风格、分辨率和尺寸、目标玩家、单局时长）、构思（笔记）、资料（本项目图片）。
- 核心交互：图片直接存进工作台；卡片可以预览；**单击卡片 = 直接复制**（图片复制成图片，提示词/风格复制成文字）；悬停出现的小"眼睛"按钮打开预览/详情。
- 不做：画板、AI 生图流程、收件箱整理、支柱/防跑偏、版本链、引擎对接、云同步、团队协作。

## 视觉
参考苹果 macOS 原生应用：访达式侧栏（窗口毛玻璃透出）、统一工具栏（高 52）、系统设置式分组表单、分段控件、照片式图片网格、备忘录式笔记。浅色默认、跟随系统深色；强调色用系统强调色（`--acc`）。0.5px 分隔线、克制，不要阴影（选中环/聚焦环除外）、渐变、emoji。
颜色和尺寸只用 `src/renderer/src/styles/tokens.css` 里的变量。

**界面还原基准**（高保真原型，按它们的布局、文案和交互来做）：
- 规范：[`docs/prototype/SHELL.md`](prototype/SHELL.md)
- 原型：[`docs/prototype/`](prototype/) 下的 `Library.dc.html`（全局库）、`Config.dc.html`（项目配置）、`Notes.dc.html`（构思）、`Assets.dc.html`（资料）。原型是一种自定义模板格式（`{{}}`、`sc-if`、`sc-for`、`class Component extends DCLogic`），里面的图片地址只在原型平台里有效；只参考它的**结构、样式、文案和交互**，代码按本项目的 React + TypeScript 写。
- 实际运行截图：[`docs/screenshots/`](screenshots/)。

## 技术栈与目录
- Electron 44 + electron-vite 5 + Vite 7 + React 19 + TypeScript（strict）+ zustand。包管理用 npm。
- `src/shared/types.ts`、`src/shared/api.ts`：**数据类型与接口契约**。界面只通过 `window.gp`（`GpApi`）访问数据；图片地址用 `imageUrl(ref, thumb?)`（gp:// 协议）。改接口时三处一起改：契约、`src/preload/index.ts` 的通道映射、`src/main/ipc.ts` 的实现。
- `src/preload/index.ts`：把每个方法映射到 IPC 通道 `<模块>:<方法>`（如 `library:listImages`）。
- `src/main/`：主进程。`index.ts` 窗口（hiddenInset 标题栏、vibrancy 侧栏）；`storage.ts` 目录与原子写；`library.ts`、`projects.ts`、`images.ts`、`notesmd.ts`（笔记 Markdown 往返）、`thumbs.ts`、`protocol.ts`（gp://）、`ipc.ts`、`sample.ts`（示例内容）、`devshot.ts`（开发截图钩子）。
- `src/renderer/src/`：`ui/` 基础组件（用法见 `ui/README.md`）、`app/` 导航 / 数据钩子 / HUD / 复制助手、`shell/` 侧栏与外壳、`screens/` 四个界面、`styles/` 设计变量与全局样式。

## 数据目录
默认 `~/GamePanl/`，环境变量 `GAMEPANL_DATA_ROOT` 可以覆盖（开发和测试时请指向一个临时目录，不要往自己真实的 `~/GamePanl` 写测试数据）。目录名一律英文：
```
<root>/
  library/
    images/<id>.<ext>       原图
    images.json             LibImage[]
    prompts.json            Prompt[]
    styles.json             Style[]
  projects/<projectId>/
    project.json            Project
    notes/<noteId>.md       笔记：文件头字段 + Markdown 正文（段落、- [ ] 清单、图片用 ![](gp-ref:library/<id>) 或 ![](gp-ref:project/<id>)）
    assets/<id>.<ext>       原图
    assets.json             ProjectAsset[]
  .cache/thumbs/            缩略图缓存（可删，会重建）
```
写文件一律先写临时文件再 rename（原子写）。删除一律 `shell.trashItem` 移到系统废纸篓。

## 开发时有用的环境变量
- `GAMEPANL_DATA_ROOT=<dir>`：数据目录。
- `GAMEPANL_SHOT_DIR=<dir> GAMEPANL_SHOT_SAMPLE=1`：启动后自动导入示例、依次截六个界面的图到该目录，然后退出（用于快速核对界面）。
- `GAMEPANL_LOG_CONSOLE=1`：把界面 console 和渲染进程的错误打印到终端。

## 质量要求
- `npm run typecheck` 和 `npm run build` 必须通过。
- 不留 TODO 占位、不留死代码、不加用户没要的功能。
- 界面文字全部中文，简洁自然。
