# VideoMemo 重做与修复方案（详细实施版）

> 交付给执行模型的完整实施规范。
> **最高原则：保持现有功能与所有对外契约不变，只改实现、UI 和修 bug。**

---

## 0. 不可破坏的契约

改动前逐条核对，违反即视为破坏功能：

1. **引擎 CLI 参数不变**：`--obsidian-vault`、`--obsidian-folder`、`--json-progress`、`--llm-model`、`--api-base-url`、`--cleanup-media`、`--regenerate`。
2. **进度事件协议不变**：`@@VIDEOMEMO@@` + JSON（`progress`/`artifact`）。
3. **cc-switch 只读**（`readOnly:true`）。
4. **密钥不落盘**：API Key 只在运行时注入子进程 env。
5. **命令/入口不变**：ribbon 图标、5 个命令 ID、状态栏项。
6. **桌面专用**：`isDesktopOnly:true`；`node:sqlite`、`electron.webUtils` 保留。
7. **Python 引擎行为与输出目录结构不变**。

---

## 1. ASCII 线框图

### 1.1 新建任务 Modal（`TextPromptModal`）

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─ kicker ───────────────────────────────────────────────┐ │
│  │ 新建任务                                                 │ │
│  │ ┌─ h2 ────────────────────────────────────────────────┐ │ │
│  │ │ 总结视频或录音                                        │ │ │
│  │ └─────────────────────────────────────────────────────┘ │ │
│  │ 视频链接 · 本地媒体                                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│─────────────────────────────────────────────────────────────│
│  ┌─ provider-badge (只读) ────────────────────────────┐  ┌───┐ │
│  │  ● Grok · grok-3-mini                              │  │ ⚙ │ │
│  └────────────────────────────────────────────────────┘  └───┘ │
│                                                             │
│  ┌─── mode-switch ────────────────────────────────────────┐ │
│  │ [ 🔗 视频链接 ]  [  📁 本地文件  ]                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
│  视频链接                                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ https://...                                            │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│─────────────────────────────────────────────────────────────│
│                                    [ 取消 ]  [  ● 开始  ]   │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 运行进度面板（`RunProgressModal`，新增）

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─ kicker ──────────────────────────────────────────────┐  │
│  │ 正在处理                                               │  │
│  │ ┌─ h2 ──────────────────────────────────────────────┐ │  │
│  │ │ https://youtube.com/watch?v=...                    │ │  │
│  │ └──────────────────────────────────────────────────┘ │  │
│  │ Grok · grok-3-mini                                   │  │
│  └───────────────────────────────────────────────────────┘  │
│─────────────────────────────────────────────────────────────│
│                                                             │
│  ■■■■■■■■■■■■■■■■░░░░░░░░░░░░░░░░░░░░  45%                │
│                                                             │
│  [2/4] 语音转写 · small · zh                                │
│                                                             │
│  ┌─ log-area (可滚动，可选展开/折叠) ──────────────────────┐│
│  │ [1/4] 下载视频…                                        ││
│  │   标题: 某课程名称                                      ││
│  │   时长: 3600s                                          ││
│  │ [2/4] 语音转写 · small · zh                            ││
│  └────────────────────────────────────────────────────────┘│
│                                                             │
│─────────────────────────────────────────────────────────────│
│  [ 后台运行 ]                                  [  取消  ]   │
└─────────────────────────────────────────────────────────────┘
```

**完成态：**
```
┌─────────────────────────────────────────────────────────────┐
│  (同上标题区)                                                │
│─────────────────────────────────────────────────────────────│
│                                                             │
│  ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■  100%  ✓ 完成       │
│                                                             │
│  视频总结已生成                                              │
│                                                             │
│─────────────────────────────────────────────────────────────│
│                                       [  ● 打开笔记  ]      │
└─────────────────────────────────────────────────────────────┘
```

**失败态：**
```
│  ■■■■■■■■■■■■■■■■░░░░░░░░░░  45%  ✗ 失败                  │
│                                                             │
│  ┌─ error-box (红色边框) ──────────────────────────────────┐│
│  │ Traceback (most recent call last):                      ││
│  │   ...last 2000 chars of stderr...                       ││
│  │                                      [ 复制错误 ]       ││
│  └────────────────────────────────────────────────────────┘│
│─────────────────────────────────────────────────────────────│
│                                            [  关闭  ]       │
```

### 1.3 设置页首页（三卡布局）

```
┌──────────────────────────────────────────────────────────────┐
│  [📹] 工作区设置                                              │
│       VideoMemo                                        │
│       运行环境 · 输出 · 供应商                                 │
│──────────────────────────────────────────────────────────────│
│                                                              │
│  ┌─ 供应商卡 (accent 背景，可点击) ──────────────────── › ─┐ │
│  │  供应商                                                  │ │
│  │  cc-switch · Grok · 跟随全局当前                         │ │
│  │  模型: grok-3-mini                                       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  ── 运行环境 ───────────────────────────────────────────────  │
│                                                              │
│  项目目录              [ D:\AIApp\video-memo      ] ✓  │
│  包含 src/pipeline.py 的目录                                  │
│                                                              │
│  Python 路径           [                                 ]    │
│  留空使用 .venv 或 PATH                         .venv ✓      │
│                                                              │
│  ── 输出 ───────────────────────────────────────────────────  │
│                                                              │
│  Vault 目标文件夹      [ Video Memos                ]    │
│                                                              │
│  完成后清理媒体        [  OFF  ]                              │
│  删除下载媒体和音轨…                                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 1.4 供应商详情页（折叠改进后）

```
┌──────────────────────────────────────────────────────────────┐
│  ← 返回供应商                                                 │
│  Grok Provider                                                │
│  codex 供应商配置                                              │
│──────────────────────────────────────────────────────────────│
│                                                              │
│  ┌─ hero ────────────────────────────────────────────────┐  │
│  │  [📦] Grok Provider  [全局当前]                        │  │
│  │  https://api.x.ai/v1                                  │  │
│  │                  [ 固定使用此供应商 ] [ 跟随全局当前 ]  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ model-selector ──────────────────────────────────────┐  │
│  │  🔲 总结模型                                           │  │
│  │  已实时获取 42 个模型                                  │  │
│  │  [ grok-3-mini           ▾ ] [↻]                       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ metadata (2x2) ─────────────────────────────────────┐   │
│  │ CLI 类型: codex │ Base URL: https://api.x.ai/v1      │   │
│  │ 模型: grok-3   │ API 格式: chat_completions          │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ▸ 查看原始配置（已脱敏）                  ← 默认折叠        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

展开后显示原来的 env 卡 + config 代码块 + parsed/raw tab，内容逻辑不变。

---

## 2. 前端函数级伪 Diff

### 2.1 文件拆分总览

```
obsidian-plugin/src/
├── main.ts              (瘦身：生命周期 + startEngine + 事件分发)
├── source-modal.ts      (从 main.ts 提取 TextPromptModal)
├── run-progress.ts      (新增 RunProgressModal)
├── settings-tab.ts      (从 main.ts 提取 VideoMemoSettingTab)
├── ccswitch-settings.ts (保留，精简详情页)
└── ccswitch.ts          (不动)
```

### 2.2 main.ts（约 930 行瘦身至 378 行）

- 移出：`TextPromptModal` → source-modal.ts；`VideoMemoSettingTab` → settings-tab.ts；`DEFAULT_SETTINGS`/`normalizeSettings` → settings.ts。
- 状态模型：`generatedNotePath: string | null` → `taskState: TaskState | null` + `progressModal: RunProgressModal | null`（43-44）。
- `onload`：5 个命令 ID 与 ribbon 不变（61-102）；状态栏项新增可点击——`is-clickable` 类 + click → `openProgressModal`（52-56）；`open-settings`/`open-provider-settings` 经 `settingTab.showHome()/showProviders()` 深链到对应页（81-102）。
- `onunload`：取消在跑任务并关闭进度面板（105-108）。
- `openSourceModal`/`openRegenerateModal`：改为构造 `TextPromptModal`，传 `providerBadge: describeProviderSelection(settings)`；regenerate 走 `--regenerate <dir>`（110-131）。
- `startEngine(sourceArgs)`：
  - 单任务守卫：已有 `activeProcess` → Notice + 重开进度面板（180-184）；
  - cc-switch 分支：`LLM_API_KEY`/`LLM_BASE_URL` 只注入子进程 env，新增 `LLM_API_FORMAT = runtime.apiFormat || "chat_completions"`，防止宿主进程残留环境变量把普通供应商误切到 Responses API（211-217）；
  - args 组装不变：`--obsidian-vault`/`--obsidian-folder`/`--json-progress`/`--llm-model`/`--api-base-url`/`--cleanup-media`（regenerate 跳过 cleanup）（226-240）；
  - 先构造完整 `TaskState` 再 `spawn(..., { shell: false, windowsHide: true })`，spawn 后立即 `openProgressModal()`（244-263）；
  - stdout 逐行 → `handleOutputLine`；stderr 保留尾部 4000 字符作 `stderrTail`；`error`/`close` → `finishTask`（265-282）。
- `handleOutputLine`：`progress` 事件更新 progress/stage，日志逐行追加并按 `MAX_LOG_LINES=500` 截断（301-303），同步状态栏文本并 `progressModal.refresh()`；`artifact`（kind=obsidian_note）→ 存 vault 相对路径 `notePath`（307-310）。
- `finishTask(success, errorMessage?)`：写 status/errorDetail/stage、刷新面板、Notice；成功态额外 `openGeneratedNote()`（317-340）。
- `openGeneratedNote`：引擎直接写盘，Obsidian 可能尚未索引，按 12 次 × 250ms 重试打开（346-357）。
- `openProgressModal`：仅当 `taskState` 存在且面板未开；`onClosed` 清引用——「后台运行」只是 close，子进程继续跑，状态栏可再打开（165-177）。
- `cancelActiveTask(showNotice=true)`：杀进程逻辑不变（win32 `taskkill /pid <pid> /T /F`，其余 SIGTERM），新增写 `status: "cancelled"` 并刷新面板（359-377）。

### 2.3 source-modal.ts（从 main.ts 提取，247 行）

- `TextPromptModal` 整体搬迁，构造函数改为 options 对象。
- 新增只读 `providerBadge`（server 图标 + 文本），对应线框 1.1 的 provider-badge（90-103）。
- 新增 `showMediaPicker`：kicker/subtitle 随场景切换「新建任务 · 视频链接 · 本地媒体」与「已有运行目录 · 已有转写 · 重新生成」（66-75）；link/file 双模式按钮切换两个 Setting 的显隐并自动聚焦（129-221）；本地文件用隐藏原生 `<input type=file>` + `electron.webUtils.getPathForFile` 取真实路径回填输入框（180-200）。
- 页脚「取消 / 开始(cta)」，输入框 Enter 提交（236-241）。

### 2.4 run-progress.ts（新增，222 行）

- `TaskStatus`/`TaskState` 类型（3-15）；`STATUS_KICKER`/`STATUS_BADGE` 文案表（24-36）。
- `onOpen` 按线框 1.2 一次性搭骨架：标题区（kicker/source/providerLabel）、进度条 + 百分比 + 状态徽标、stage 行、可滚动日志区、错误容器、页脚（61-105）。
- `refresh()` 增量刷新：进度条/百分比/徽标/stage 直接改写；`appendNewLogLines` 只追加新行，若日志缓冲被插件截断（`renderedLogCount > state.log.length`）则整块重建（140-156）；仅当滚动条接近底部时自动跟随（149-155）。
- 错误盒仅在状态迁移时重建：红边框 + 「复制错误」按钮（`navigator.clipboard`），对应线框失败态（158-177）。
- `renderFooter` 状态机：running → 后台运行 / 取消任务(warning)；success 且有 notePath → 关闭 / 打开笔记(cta)；其余 → 关闭（179-216）。
- `onClose` 清空 content 并回调 `onClosed`（218-221）。

### 2.5 settings.ts（新增，83 行）

- `VideoMemoSettings extends CcSwitchUiSettings`，追加 `projectPath/pythonPath/model/targetFolder/cleanupMedia`（4-10）；`DEFAULT_SETTINGS`（12-23）。
- `normalizeSettings` 从 main.ts 移入，逐字段兜底（25-51）。
- `describeProviderSelection`：新增的共享一行式供应商描述（环境配置 / cc-switch 名称 / 跟随全局当前或已固定 / 模型），供首页卡片、新建任务徽标、重新生成徽标三处复用；读库失败降级为「cc-switch · 无法读取数据库」（57-83）。取代旧设置页的 `providerDescription()`。

### 2.6 settings-tab.ts（从 main.ts 提取，134 行）

- 持有 `page: "settings" | "providers"`，`display()` 分流首页或 `providerView.render`（30-37）。
- 首页按线框 1.3 新增头部（图标 + 工作区设置 kicker + 标题 + 副标题）（39-48）。
- 供应商卡 = `Setting` + `role=button` + tabIndex，Enter/Space 与整卡点击（按钮区除外）均进供应商页（55-72）。
- 运行环境/输出四行（项目目录、Python 路径、Vault 目标文件夹、完成后清理媒体）逻辑不变（77-118）。
- `showHome()/showProviders()` 供命令深链；`hide()` 回首页（121-133）。

### 2.7 ccswitch-settings.ts（保留，详情页精简）

- 新增 `rawDetailExpanded` 默认 false，切列表/切详情时重置：线框 1.4 的「查看原始配置（已脱敏）」默认折叠，`ccswitch-raw-toggle` 带 `aria-expanded`（93、104、372、447-460）。
- 供应商行 `is-active` 改为预计算后传入（355-370）。
- 模型选择器结构不变：实时 `/models` 获取、失败回退本地模型、刷新按钮转圈（511-564）；env 卡 / config 代码块 / parsed-raw tab 逻辑不变。

### 2.8 未动项与现状说明

- `ccswitch.ts` 一行未动：`node:sqlite` 只读、`resolveCcSwitchProviderRuntime`/`loadCcSwitchProviders`/`fetchCcSwitchProviderModels` 接口不变。
- 协作式取消（`cancel_event`）目前只贯通桌面 GUI；CLI 与插件仍靠杀进程树取消（`taskkill /T /F` / SIGTERM），引擎 `pipeline.main()` 不接收取消信号。这是现状说明，不属于第 0 节契约。
