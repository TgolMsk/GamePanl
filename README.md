# GamePanl

**游戏策划工作台（macOS）。** 把一款游戏从立项到开发过程中的构思笔记、图片素材、生图提示词、美术风格和基础配置放在同一个地方，按项目归档；任何一张卡片单击即复制，直接粘贴到 ChatGPT、Gemini、Photoshop 或引擎里。

> A macOS desktop workbench for indie game planning — per-project notes, art references, AI image prompts, style guides and specs, with click-to-copy everywhere. Built with Electron, React and TypeScript.

![GamePanl 的六个界面](docs/screenshots/overview.jpg)

## 它解决什么问题

一个人做游戏，思路会在美术、玩法结构、参考图、截图之间来回跳：参考图散在下载文件夹，提示词躺在聊天记录里，设定写在各处的备忘录。GamePanl 只做一件事：**把这些东西放进去、理清楚、用的时候一键拿出来。** 它不是引擎，不接 API，也不替你生图。

## 功能

**全局库**（所有项目共用，是你自己积累的资产）

- **图片素材**：拖入、粘贴或选择文件导入，按内容去重；分类、标签、搜索；网格 / 列表两种视图；单击卡片复制原图到系统剪贴板，悬停的眼睛按钮打开预览。
- **提示词**：按风格 / 用途 / 约束 / 构图 / 负面词分类，单击复制并记录使用次数，可直接编辑。
- **风格**：名称、描述、五色色板、样张和对应的生图提示词；单击复制提示词，点色块复制色值。

**项目**（一款游戏一个，是策划本，不是引擎工程）

- **配置**：类型、平台、目标玩家、单局时长、美术风格（从全局库选）、基准分辨率与缩放方式、瓦片 / 角色 / Boss / 图标尺寸、常用提示词；右侧实时生成可复制的「项目一页纸」。
- **构思**：备忘录式笔记，按玩法 / 故事 / 关卡 / 角色 / 美术 / 音频分类，可打勾完成，正文支持清单和图片块。
- **资料**：本项目的图片，照片式网格按时间分组，可从全局库添加；右侧检查器改名称、分类、标签，并显示被哪些笔记引用。

**界面**参考 macOS 原生应用：访达式侧栏（毛玻璃）、统一工具栏、系统设置式分组表单、分段控件；跟随系统的深浅色和强调色。

## 安装与运行

需要 macOS 和 Node.js 20+。

```bash
git clone https://github.com/TgolMsk/GamePanl.git
cd GamePanl
npm install
npm run dev
```

首次启动会出现欢迎页，点「导入示例内容」可以看到示例项目「雾港」：14 张示例图片、12 条提示词、9 种风格、9 条策划笔记和 24 张项目资料。

打包成 .app / .dmg：

```bash
npm run dist
```

产物在 `release/`。

## 数据存放

所有数据都是本地普通文件，默认在 `~/GamePanl/`（可用环境变量 `GAMEPANL_DATA_ROOT` 改）：

```
~/GamePanl/
  library/
    images/<id>.<ext>        原图
    images.json  prompts.json  styles.json
  projects/<projectId>/
    project.json             配置
    notes/<noteId>.md        笔记（文件头字段 + Markdown 正文）
    assets/<id>.<ext>        项目资料原图
    assets.json
  .cache/thumbs/             缩略图缓存，删了会重建
```

在访达里就能看懂，也方便用 git 或网盘自己备份。删除操作一律移到系统废纸篓。

## 技术栈

Electron 44 · electron-vite 5 · Vite 7 · React 19 · TypeScript · zustand。主进程负责存储、图片导入去重、缩略图（`gp://` 协议）、系统剪贴板；界面只通过 `window.gp` 访问数据（接口契约见 [`src/shared/api.ts`](src/shared/api.ts)）。

## 目录

```
src/main/        主进程：存储、IPC、gp:// 图片协议、示例内容
src/preload/     contextBridge，暴露 window.gp
src/renderer/    界面：ui/ 基础组件、app/ 状态与钩子、screens/ 四个界面
src/shared/      类型与接口契约
resources/sample 示例内容（图片由 GPT 生成，提示词见 design-assets/chatgpt-prompts.md）
build/           应用图标
docs/            开发说明、界面原型、截图
```

开发说明见 [docs/DEV-BRIEF.md](docs/DEV-BRIEF.md)。

## 路线

- [x] 全局库：图片素材 / 提示词 / 风格
- [x] 项目：配置 / 构思 / 资料
- [x] 单击复制、预览、深浅色、系统强调色
- [ ] 图文思维导图（故事线、关卡结构）
- [ ] 全局搜索（⌘K）
- [ ] Windows 支持

## 说明

示例图片和应用图标由 GPT 图像模型生成，仅作示例。项目处于早期版本，欢迎提 issue。
