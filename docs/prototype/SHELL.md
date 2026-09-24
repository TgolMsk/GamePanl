# GamePanl 工作台原型 · 共用规范（每个画板必须遵守）

## 产品一句话
按游戏项目聚合的策划工作台（macOS 桌面应用）：
- **全局库**：用户自己积累的**图片素材**、**提示词**、**风格**，所有项目共用。
- **项目**：一款游戏的策划本（不是引擎工程）：**配置**（类型、平台、美术风格、分辨率和尺寸、目标玩家）、**构思**（笔记）、**资料**（本项目的图片）。

核心交互：图片存进工作台；卡片可预览；**单击卡片 = 直接复制**（图片复制成图片，提示词/风格复制成文字）；另有一个小"查看"按钮打开预览/详情。
不要做：画板、AI 生图流程、整理收件箱、支柱/防跑偏、版本链、引擎对接、任何用户没提的机制。

## 视觉：按苹果 macOS 原生应用的风格（Finder / 照片 / 备忘录 / 系统设置那种感觉）
- **窗口结构**：左侧边栏（宽 232，满高，红黄绿三个窗口按钮在侧栏顶部），右侧内容区顶部是统一工具栏（高 52：标题 + 副标题，右边是分段控件、搜索框、图标按钮）。
- **浅色为默认**，同时支持深色（tweak `dark`）。所有颜色只用下面的 CSS 变量。
- 字体：系统字体栈（-apple-system / PingFang SC），13px 正文，11–12px 次要文字，标题 15–22px；字重只用 400 / 500 / 600。
- 细分隔线 0.5px；圆角：控件 6–7px，卡片/分组 10px，图片 8px；不要阴影、渐变、emoji、粗边框。
- 侧栏选中：浅灰圆角底 + 文字加粗；侧栏图标用强调色。选中的卡片：3px 强调色描边（像"照片"）。
- 表单用"系统设置"式的**分组列表**：白色圆角容器，行之间细线，左标签右控件。
- 分段控件、搜索框、弹出菜单都做成 macOS 样式（灰底胶囊 + 白色选中块）。
- 提示用底部居中的深色 HUD 胶囊，2 秒消失。
- 图标：画成类似 SF Symbols 的描边 SVG（下面有现成的）。
- 文字对比度 ≥ 4.5:1：次要文字用 `--tx2`，`--tx3` 只用于图标、占位符、禁用态，不用于正文。

## 画板
- 每个画板 1440×900，根元素固定尺寸，`$preview` 同尺寸。
- 画板间用链接跳转（Play 里生效）：`Library.dc.html`（全局库）、`Config.dc.html`（项目配置）、`Notes.dc.html`（项目构思）、`Assets.dc.html`（项目资料）。

## helmet（原样复制；可在 style 末尾追加本画板少量类，不要改已有的）
```html
<helmet>
<style>
body{margin:0;background:#d9d9de}
.app{--win:#ffffff;--side:#ececf0;--bg2:#f5f5f7;--card:#ffffff;--fill:rgba(118,118,128,.14);--fill2:rgba(118,118,128,.09);--sep:rgba(60,60,67,.16);--tx:#1d1d1f;--tx2:#5f5f64;--tx3:#aeaeb2;--sel:rgba(0,0,0,.075);--ok:#248a3d;--chk1:#ffffff;--chk2:#ececef;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Helvetica Neue",sans-serif;font-size:13px;line-height:1.45;color:var(--tx);-webkit-font-smoothing:antialiased}
.app.dark{--win:#1e1e20;--side:#28282b;--bg2:#161618;--card:#2a2a2d;--fill:rgba(118,118,128,.26);--fill2:rgba(118,118,128,.16);--sep:rgba(255,255,255,.1);--tx:#f5f5f7;--tx2:#a8a8ad;--tx3:#636366;--sel:rgba(255,255,255,.1);--ok:#30d158;--chk1:#2a2a2d;--chk2:#333336}
.app *{box-sizing:border-box}
.mono{font-family:"SF Mono",ui-monospace,Menlo,monospace}
.btn{height:28px;padding:0 12px;border-radius:6px;border:.5px solid var(--sep);background:var(--card);color:var(--tx);font:inherit;font-size:13px;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;white-space:nowrap;text-decoration:none}
.btn:hover{background:var(--bg2)}
.btn.pri{background:var(--acc);border-color:transparent;color:#fff;font-weight:500}
.btn.pri:hover{filter:brightness(1.07)}
.btn.plain{background:transparent;border-color:transparent;color:var(--acc)}
.tbtn{width:30px;height:28px;border-radius:6px;border:0;background:transparent;color:var(--tx2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.tbtn:hover{background:var(--fill2);color:var(--tx)}
.seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--fill2);gap:2px}
.seg button{height:24px;padding:0 12px;border-radius:6px;border:.5px solid transparent;background:transparent;color:var(--tx);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.seg button.on{background:var(--card);border-color:var(--sep);font-weight:500}
.search{height:28px;width:220px;border-radius:7px;background:var(--fill2);color:var(--tx2);display:inline-flex;align-items:center;gap:6px;padding:0 8px;font-size:13px;border:0}
.nv{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 8px;border-radius:6px;border:0;background:transparent;color:var(--tx);font:inherit;font-size:13px;text-decoration:none;cursor:pointer;text-align:left}
.nv:hover{background:var(--fill2)}
.nv.on{background:var(--sel);font-weight:600}
.nv .ic{color:var(--acc);display:inline-flex;width:18px;justify-content:center}
.nv .n{margin-left:auto;font-size:12px;color:var(--tx2);font-weight:400}
.nv.sub{padding-left:30px}
.sec{font-size:11px;font-weight:600;color:var(--tx2);padding:14px 10px 4px}
.group{background:var(--card);border:.5px solid var(--sep);border-radius:10px;overflow:hidden}
.rowi{display:flex;align-items:center;gap:12px;min-height:40px;padding:8px 14px;border-top:.5px solid var(--sep)}
.rowi:first-child{border-top:0}
.rowi .k{width:120px;flex:none;color:var(--tx)}
.gh{font-size:13px;font-weight:600;color:var(--tx);padding:0 4px 6px}
.lbl{font-size:12px;color:var(--tx2)}
.tag{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:11px;background:var(--fill2);color:var(--tx2);font-size:12px;white-space:nowrap}
.chip{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 11px;border-radius:13px;border:.5px solid var(--sep);background:var(--card);color:var(--tx);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.chip.on{background:var(--acc);border-color:transparent;color:#fff}
.fld{width:100%;height:28px;border-radius:6px;border:.5px solid var(--sep);background:var(--card);color:var(--tx);padding:0 8px;font:inherit;font-size:13px;outline:none}
.fld:focus{border-color:var(--acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 28%,transparent)}
textarea.fld{height:auto;padding:6px 8px;resize:none;line-height:1.5}
.ph{display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.55);width:100%;height:100%}
.checker{background-color:var(--chk1);background-image:conic-gradient(var(--chk2) 25%,transparent 0 50%,var(--chk2) 0 75%,transparent 0);background-size:14px 14px}
.card{position:relative}
.hit{display:block;width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:copy}
.hit .frame{position:relative;border-radius:8px;overflow:hidden;background:var(--fill2)}
.hit .pill{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);height:22px;padding:0 9px;border-radius:11px;background:rgba(0,0,0,.62);color:#fff;font-size:11px;display:flex;align-items:center;gap:4px;opacity:0;white-space:nowrap}
.hit:hover .pill{opacity:1}
.card.sel .frame{box-shadow:0 0 0 3px var(--acc)}
.eye{position:absolute;right:8px;top:8px;width:26px;height:26px;border-radius:13px;border:0;background:rgba(0,0,0,.5);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;opacity:0}
.card:hover .eye{opacity:1}
.done{position:absolute;left:8px;top:8px;height:22px;padding:0 8px;border-radius:11px;background:var(--acc);color:#fff;font-size:11px;display:flex;align-items:center;gap:4px}
.cap{font-size:13px;color:var(--tx);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{font-size:11px;color:var(--tx2)}
.hud{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);height:36px;padding:0 16px;border-radius:18px;background:rgba(28,28,30,.9);color:#fff;font-size:13px;display:flex;align-items:center;gap:8px;z-index:80;white-space:nowrap}
.scrim{position:absolute;inset:0;background:rgba(0,0,0,.28);z-index:60}
.sheet{position:absolute;z-index:61;background:var(--win);border:.5px solid var(--sep);border-radius:12px}
</style>
</helmet>
```
注意：`.card.sel .frame` 与 `.fld:focus` 用了 box-shadow 画选中环/聚焦环，这是功能性的，允许；其他地方不要阴影。

## 根元素（原样）与 tweak
```html
<div class="{{appCls}}" style="width: 1440px; height: 900px; position: relative; overflow: hidden; background: var(--win); --acc: {{accent}}">
```
`data-props`：`{"accent":{"editor":"color","default":"#0071E3","options":["#0071E3","#8944AB","#C9540A"]},"dark":{"editor":"boolean","default":false},"$preview":{"width":1440,"height":900}}`
`renderVals()` 返回 `accent: this.props.accent ?? '#0071E3'`、`appCls: (this.props.dark ?? false) ? 'app dark' : 'app'`。

## 骨架（原样结构）
```html
<div style="width: 1440px; height: 900px; display: flex">
  侧栏（下面原样）
  <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--win)">
    工具栏（高 52，border-bottom: .5px solid var(--sep)，padding: 0 16px 0 20px，display:flex，align-items:center，gap:10px）：
      左：标题（15px 600）+ 副标题（12px var(--tx2)）上下两行
      右：本页的分段控件 / 搜索框 / 图标按钮
    <div style="flex: 1; min-height: 0; display: flex">主区 + 可选右侧检查器（宽 300，border-left: .5px solid var(--sep)，background: var(--bg2)）</div>
  </div>
</div>
覆盖层（.scrim + .sheet）和 .hud 放在根元素里、骨架之后。
```

## 侧栏（原样；把当前页对应项加 `on`）
```html
<nav aria-label="侧栏" style="width: 232px; flex: none; background: var(--side); border-right: .5px solid var(--sep); padding: 0 10px 12px; display: flex; flex-direction: column; gap: 1px">
  <div style="height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding-left: 8px">
    <span style="width: 12px; height: 12px; border-radius: 6px; background: #ff5f57"></span>
    <span style="width: 12px; height: 12px; border-radius: 6px; background: #febc2e"></span>
    <span style="width: 12px; height: 12px; border-radius: 6px; background: #28c840"></span>
  </div>
  <div class="sec">全局库</div>
  <a class="nv" href="Library.dc.html"><span class="ic">[photo 图标]</span>图片素材<span class="n">128</span></a>
  <a class="nv" href="Library.dc.html"><span class="ic">[text 图标]</span>提示词<span class="n">46</span></a>
  <a class="nv" href="Library.dc.html"><span class="ic">[palette 图标]</span>风格<span class="n">9</span></a>
  <div class="sec">项目</div>
  <a class="nv" href="Config.dc.html"><span class="ic">[controller 图标]</span>雾港</a>
  <a class="nv sub" href="Config.dc.html"><span class="ic">[slider 图标]</span>配置</a>
  <a class="nv sub" href="Notes.dc.html"><span class="ic">[bulb 图标]</span>构思<span class="n">9</span></a>
  <a class="nv sub" href="Assets.dc.html"><span class="ic">[stack 图标]</span>资料<span class="n">24</span></a>
  <a class="nv" href="Config.dc.html"><span class="ic">[controller 图标]</span>猫咪快递</a>
  <a class="nv" href="Config.dc.html"><span class="ic">[controller 图标]</span>灯塔（旧）</a>
  <div style="flex: 1"></div>
  <button class="nv" style="color: var(--tx2)"><span class="ic">[plus 图标]</span>新建项目</button>
</nav>
```
Library 画板里，"图片素材 / 提示词 / 风格"三项改成 `<button class="nv ...">`，onClick 切本页 tab；其余照抄。

## 图标（16px 描边，类似 SF Symbols；原样用）
外层：`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" style="stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round">…</svg>`
- photo：`<rect x="3" y="4.5" width="18" height="15" rx="3"></rect><circle cx="9" cy="10" r="1.8"></circle><path d="M4 18l5-5 4 4 3-3 4 4"></path>`
- text：`<path d="M5 6.5h14M5 11.5h14M5 16.5h9"></path>`
- palette：`<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7s-.6-1.3-.6-2.1c0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.7-4-8.6-9-8.6z"></path><circle cx="7.5" cy="11" r="1"></circle><circle cx="10" cy="7" r="1"></circle><circle cx="14.5" cy="7" r="1"></circle>`
- controller：`<rect x="2.5" y="7.5" width="19" height="10" rx="5"></rect><path d="M8 10.5v4M6 12.5h4"></path><circle cx="15.5" cy="11.5" r=".9"></circle><circle cx="17.5" cy="13.5" r=".9"></circle>`
- slider：`<path d="M4 7h9M17 7h3M4 17h3M11 17h9"></path><circle cx="15" cy="7" r="2"></circle><circle cx="9" cy="17" r="2"></circle>`
- bulb：`<path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"></path>`
- stack：`<rect x="4" y="8" width="16" height="12" rx="2.5"></rect><path d="M7 5.2h10M9.5 2.6h5"></path>`
- plus：`<path d="M12 5v14M5 12h14"></path>`
- search：`<circle cx="11" cy="11" r="6.5"></circle><path d="M20 20l-4-4"></path>`
- eye：`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="2.8"></circle>`
- copy：`<rect x="9" y="9" width="11" height="11" rx="2.5"></rect><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"></path>`
- check：`<path d="M5 12.5l4.5 4.5L19 7.5"></path>`
- grid：`<rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="4" width="7" height="7" rx="1.5"></rect><rect x="4" y="13" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect>`
- list：`<path d="M9 6.5h11M9 12h11M9 17.5h11"></path><circle cx="5" cy="6.5" r=".9"></circle><circle cx="5" cy="12" r=".9"></circle><circle cx="5" cy="17.5" r=".9"></circle>`
- folder：`<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"></path>`
- xmark：`<path d="M6 6l12 12M18 6L6 18"></path>`
- chevron.down：`<path d="M6 9.5l6 6 6-6"></path>`
- square（未勾选）：`<rect x="4.5" y="4.5" width="15" height="15" rx="4"></rect>`；checkmark.square（已勾选）：`<rect x="4.5" y="4.5" width="15" height="15" rx="4"></rect><path d="M8.5 12.2l2.5 2.5 4.5-5"></path>`

## 图片：统一的图片登记表（原样放进 Component 类，所有画板共用同一份键名）
原型里的图片之后会由用户用 ChatGPT 生成，再替换进来。现在 `url` 都是空串，渲染时：有 url → `<img src="{{x.url}}" alt="{{x.label}}" style="width:100%;height:100%;object-fit:cover;display:block">`；没有 url → 用 `tint` 纯色块 + 居中的 photo 图标（`.ph`，白色半透明）当带标注的占位图。**必须用 `<sc-if>` 两分支实现，这样以后只改 url 就能换成真图。**
```js
imgs() {
  return {
    scene_harbor:     { url: '', label: '雾港夜景',       tint: '#3d4a63', w: 1536, h: 1024 },
    scene_forest:     { url: '', label: '雾中森林',       tint: '#4c6356', w: 1536, h: 1024 },
    scene_lighthouse: { url: '', label: '灯塔内部',       tint: '#6b5a48', w: 1536, h: 1024 },
    shot_gameplay:    { url: '', label: '游戏画面示意',   tint: '#2f3a4d', w: 1536, h: 1024 },
    char_watchman:    { url: '', label: '守夜人',         tint: '#8a7a63', w: 1024, h: 1024 },
    mon_fog:          { url: '', label: '雾妖',           tint: '#7b8595', w: 1024, h: 1024 },
    mon_slime:        { url: '', label: '史莱姆',         tint: '#6f9f7e', w: 1024, h: 1024 },
    ui_kit:           { url: '', label: 'UI 套装',        tint: '#8c8272', w: 1024, h: 1024 },
    icons_items:      { url: '', label: '道具图标',       tint: '#94794a', w: 1024, h: 1024 },
    tiles_stone:      { url: '', label: '石砖瓦片',       tint: '#6f7178', w: 1024, h: 1024 },
    style_watercolor: { url: '', label: '水彩绘本样张',   tint: '#b3a189', w: 1024, h: 1024 },
    style_cel:        { url: '', label: '赛璐璐日系样张', tint: '#7f99bf', w: 1024, h: 1024 },
    style_lowpoly:    { url: '', label: '低多边形样张',   tint: '#6f8f8b', w: 1024, h: 1024 },
    ref_lantern:      { url: '', label: '参考 · 提灯',    tint: '#7a6242', w: 1024, h: 1024 }
  };
}
```
复制图片（有 url 时）：`fetch(url) → blob →（非 png 则画到 canvas 转 png）→ navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`；没有 url 时直接走失败分支。全部 try/catch。

## 单击复制（统一行为）
- 卡片结构：`<div class="{{c.cardCls}}">`（`card` 或 `card sel`）里放 `<button class="hit" onClick="{{c.copy}}">`（内含 `.frame` 图片区 + 悬停出现的 `.pill`「⧉ 点击复制」+ 标题 `.cap` + `.meta`），和兄弟元素 `<button class="eye" aria-label="查看" onClick="{{c.view}}">`（eye 图标）。按钮不能嵌套。
- 复制后：HUD 显示"已复制图片"/"已复制提示词"等（成功），或"已复制（原型环境限制了剪贴板，实际应用会直接复制）"（失败）；该卡片左上角出现 `.done` 角标"✓ 已复制"，2 秒后消失（state 记最近复制的 id + setTimeout）。
- 查看：打开 Quick Look 式预览（`.scrim` + `.sheet` 居中，大图 + 名称/尺寸/格式/标签/用于哪些项目 + [复制] [在访达中显示] [关闭]），点 scrim 或关闭按钮收起。

## 示例数据（统一用这些）
- 项目「雾港」：一句话"守夜人提灯穿过会吞噬记忆的雾"；类型 2D 横版动作 + 轻解谜；平台 PC（Steam）、Switch；美术风格「16-bit 暗调像素」；基准分辨率 320×180（整数缩放到 1080p）；瓦片 16×16、角色 32×32、Boss 64×64、图标 16×16；目标玩家"喜欢氛围和探索、一次玩 20–40 分钟的独立游戏玩家"。
- 其他项目：「猫咪快递」、「灯塔（旧）」。
- 全局库风格 9 个：16-bit 暗调像素（样张用 scene_harbor）、水彩绘本（style_watercolor）、赛璐璐日系（style_cel）、低多边形 3D（style_lowpoly）、扁平矢量、剪纸拼贴、厚涂写实、1-bit 单色、PS1 复古 3D（后五个没有样张，卡片用该风格的 5 色色板条当视觉）。每个风格有：名称、一句描述、5 色色板、风格提示词（中英混合，像真的能贴进 ChatGPT 的样子）。
- 提示词分类：风格、用途、约束、构图、负面词；每条有标题、正文（真实可用的提示词）、分类、用过的次数。

## .dc.html 格式硬规则（违反会静默失败）
- `<head>` 保留 `<script src="./support.js"></script>` 原样；`<html lang="zh-CN">`；`<title>` 写本画板名。
- 所有非 void 元素闭合，所有属性加引号。
- `{{hole}}` 只能是点号取值，不能是表达式；计算都在 `renderVals()` 里做。
- 事件 `onClick="{{fn}}"`（JSX 驼峰）；循环项自带处理函数：`items.map(x => ({ ...x, pick: () => ... }))`。
- `<sc-if value="{{cond}}" hint-placeholder-val="{{ false }}">…</sc-if>`；`<sc-for list="{{items}}" as="item" hint-placeholder-count="3">…</sc-for>`；hint 属性必须写。
- 选中态用 class：`class="{{x.cls}}"`。style 里的 hole 只用于实时值（颜色、宽度）。
- 受控输入：`value="{{v}}" onChange="{{setV}}"`；`<label for>` 配 `<input id>`。
- 脚本：`<script type="text/x-dc" data-dc-script data-props='…'>` 内 `class Component extends DCLogic { … renderVals() { … } }`，经典 JS，无 import。状态用 `this.setState`，读状态用 `Object.assign(this.base(), this.state || {})` 补默认值。定时器在 `componentWillUnmount` 里清。
- 不许：全局 keydown 监听、innerHTML/appendChild 造 UI、iframe、emoji、外部网络请求、外部字体。元素级 `onKeyDown` 可以（中文输入法组词时 `e.nativeEvent.isComposing` 要跳过）。
- 语法参考（只学语法，功能方向已作废）：`/private/tmp/claude-501/-Users-ws-Project-GamePanl/051cc0ab-6d42-4190-b84d-097d8c9025ee/scratchpad/proto/project/Main.dc.html`。
