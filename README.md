# VideoMemo

VideoMemo 将视频链接、本地视频或录音转换成可检索的学习笔记，并可直接导出到 Obsidian。
它由一个本地 Python 引擎和一个桌面 Obsidian 插件组成。

## 能做什么

```text
视频链接 / 本地媒体
    ↓
字幕优先；没有字幕时使用本地 faster-whisper 转写
    ↓
视频可抽取关键帧（可用 --no-vision 跳过）
    ↓
OpenAI-compatible 多模态模型生成结构化学习笔记
    ↓
Markdown 报告 + 可选 Obsidian 笔记和关键帧附件
```

- 远程 URL：使用 `yt-dlp` 解析站点、格式、字幕和 Cookie；普通 HTTP 直链会尝试经过严格校验的 Range 多连接下载，失败自动回退到 `yt-dlp`。
- 本地媒体：直接读取原文件，不复制、不删除原文件；视频默认仍可抽帧，音频自动跳过画面分析。
- 字幕：优先使用平台手工字幕，其次自动字幕，最后回退到本地 Whisper。
- 隐私：转写在本地完成；摘要请求会把转写和选定关键帧发送到你配置的模型服务。

## 支持环境

| 组件 | 要求 |
| --- | --- |
| Python | 3.10–3.13；Python 3.10 自动使用 `tomli` 兼容 TOML |
| ffmpeg | 必须安装并加入 PATH；项目不捆绑二进制 |
| ffprobe | 推荐安装；缺失时仍可运行，但无法读取部分媒体时长 |
| Windows GUI | Windows 10/11，推荐项目 `.venv` |
| Obsidian 插件 | 桌面版 Obsidian，插件 `video-memo`；移动端不支持 |
| Node.js | 仅从源码构建插件时需要 Node.js 18+ |
| 模型 | 启用画面分析时需要支持图片输入的 OpenAI-compatible 模型；`--no-vision` 只需文本模型 |

## 安装 Python 引擎

从仓库根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

也可以安装为命令行工具（仍需在可访问配置和媒体的工作目录运行）：

```powershell
.\.venv\Scripts\python.exe -m pip install -e .
videomemo --version
```

首次使用 Whisper 时会下载模型到 `models/faster-whisper/`；该目录已被 Git 忽略。可用 `WHISPER_MODEL_DIR` 指定其他位置。通过已安装的 `videomemo` 命令运行时，默认数据根目录是当前工作目录；也可以用 `VIDEOMEMO_PROJECT_ROOT` 指定 `.env`、模型和输出所在目录。

## API 配置

优先级从高到低：

1. 桌面 GUI、Obsidian 插件或命令行显式传入；
2. `.env` / 环境变量：`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`；
3. 本机 `~/.grok/config.toml`；
4. `XAI_API_KEY` 默认连接 xAI，`OPENAI_API_KEY` 默认连接 OpenAI。

兼容的 Base URL 变量包括 `OPENAI_BASE_URL`、`OPENAI_API_BASE`、`XAI_BASE_URL` 和
`GROK_MODELS_BASE_URL`；兼容的 xAI key 包括 `GROK_API_KEY` 和
`GROK_CODE_XAI_API_KEY`。程序实现允许 `http` 和 `https`，生产环境建议使用可信的 HTTPS；
本地服务可使用 `http://localhost`。API key 不应写入日志、插件数据或 Git。

`LLM_API_FORMAT` 默认使用 Chat Completions，也接受 `responses`、`openai_responses` 或
`response`；`LLM_NOTES_MODEL` 可为长转写章节指定单独模型。

## GUI

```powershell
.\start_gui.cmd
# 或
.\.venv\Scripts\python.exe src/app_gui.py
```

GUI 支持链接/本地文件、Whisper 精度、语言、Cookie、关键帧数量、API 配置、进度、取消、
复制总结和打开输出目录。

## CLI

```powershell
# 远程视频
.\summarize.cmd "https://www.youtube.com/watch?v=xxxx"
python src/pipeline.py "https://www.bilibili.com/video/BVxxxx"

# 本地视频或录音
.\summarize.cmd "D:\录像\课程.mp4"
.\summarize.cmd "D:\录音\会议.m4a"

# 需要登录：优先匿名，匿名失败后读取浏览器 Cookie
python src/pipeline.py "URL" --cookies-from-browser edge
python src/pipeline.py "URL" --cookies "D:\secure\cookies.txt"

# 重新生成：复用已有转写和关键帧，不重新下载
python src/pipeline.py --regenerate "output\20260716_120000_课程"

# 导出 Obsidian
python src/pipeline.py "URL" --obsidian-vault "D:\Notes\My Vault"

# 检查版本
python src/pipeline.py --version
```

参数：

| 参数 | 说明 |
| --- | --- |
| `-o, --output DIR` | 输出根目录 |
| `-m, --whisper-model` | `tiny` / `base` / `small` / `medium` / `large-v3` |
| `-l, --language` | 语言代码，如 `zh`、`en`；默认自动检测 |
| `--max-frames N` | 最多发送给视觉模型的关键帧数量 |
| `--no-vision` | 跳过画面分析，不要求多模态模型 |
| `--cleanup-media` | 成功后删除本次下载媒体和 `audio.wav` |
| `--llm-model MODEL` | 模型名 |
| `--api-base-url URL` | 临时覆盖 API Base URL |
| `--cookies-from-browser BROWSER` | 从浏览器读取 Cookie |
| `--cookies FILE` | 使用导出的 `cookies.txt` |
| `--obsidian-vault DIR` | 导出报告和关键帧到 Vault |
| `--obsidian-folder DIR` | Vault 目标文件夹，默认 `Video Memos` |
| `--regenerate DIR` | 从已有运行目录重新生成报告 |
| `--version` | 显示引擎版本 |
| `--json-progress` | 插件内部使用的结构化进度输出 |

支持的视频扩展名：`.mp4`、`.mkv`、`.webm`、`.mov`、`.avi`、`.flv`、`.m4v`、`.ts`、
`.mpg`、`.mpeg`、`.wmv`、`.3gp`、`.3g2`、`.f4v`、`.ogv`。

支持的音频扩展名：`.mp3`、`.wav`、`.m4a`、`.flac`、`.aac`、`.ogg`、`.opus`、`.wma`、
`.amr`、`.aiff`、`.mka`、`.oga`、`.weba`、`.mpga`。

## 输出和缓存

每个任务位于 `output/<时间戳>_<标题>/`，通常包含：

- `summary.md`：扫描优先的结构化学习笔记；
- `transcript.txt`：带时间戳的转写；
- `audio.wav`：用于 ASR 的中间音轨；
- `frames/`：启用视觉且输入含视频时的关键帧；
- `source.*`：远程下载的媒体；本地输入不会复制该文件；
- `info.json`：元数据、缓存和完成状态。

相同来源会复用兼容的最近任务。`--cleanup-media` 只删除本次运行目录中的下载媒体和音轨，
保留报告、转写、字幕和关键帧；本地原始文件永远不会删除。

## Obsidian 插件

`obsidian-plugin/` 是桌面端 `video-memo` 插件。它提供输入弹窗、供应商/模型设置、任务进度、
取消、后台运行和完成后自动打开笔记。插件通过 `shell: false` 启动项目 Python 引擎，
所以仍需准备 Python 项目依赖、ffmpeg 和 yt-dlp。

手动构建/安装：

```powershell
cd obsidian-plugin
npm.cmd ci
npm.cmd run check
npm.cmd run build
.\install.ps1 -VaultPath "D:\Notes\My Vault"
```

安装目录为：

```text
<your-vault>/.obsidian/plugins/video-memo/
```

启用插件后，在设置中填写包含 `src/pipeline.py` 的项目目录；Python 路径会自动检测项目
`.venv`，未找到时回退到 PATH 中的 `python`。安装脚本会复制 `main.js`、`manifest.json`、
`styles.css`、`LICENSE`、`NOTICE` 和 `COPYRIGHT.md`；对应 TypeScript 源码与构建配置保留在本仓库。

供应商支持三种来源：只读 cc-switch 数据库、项目环境配置，以及手动添加的 OpenAI-compatible
自定义供应商。自定义供应商可填写 API 根地址、API key 和协议格式，插件通过 `/models` 自动
发现模型，并提供不调用聊天模型的“测试连接”。Base URL 应填写 `https://example.com/v1` 这类
API 根地址，不要填写 `/chat/completions` 或 `/responses`。测试/刷新模型会把 Bearer key 发送到
该供应商的 `/models` 端点；生产环境应使用可信 HTTPS，localhost 可使用 HTTP。

按当前设置，自定义 API key 会明文保存在当前 Vault 的
`.obsidian/plugins/video-memo/data.json`，不会加入命令行、任务日志或输出文件。不要提交或分享
该文件，也不要把它同步到不受信任的设备。旧 Obsidian/Electron 不支持 `node:sqlite` 时仍可使用
环境配置或自定义供应商。

插件与 Python 引擎分层许可：Python 根项目 Apache-2.0；插件 AGPL-3.0-or-later。详见
`LICENSE`、`NOTICE`、`obsidian-plugin/LICENSE`、`obsidian-plugin/COPYRIGHT.md` 和
`THIRD-PARTY-NOTICES.md`。

## 开发与发布

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests -v
cd obsidian-plugin
npm.cmd ci
npm.cmd run check
npm.cmd run build
```

GitHub Actions 会验证 Python 3.10–3.13、插件类型检查和构建产物同步。插件 tag 发布流程会
生成 `main.js`、`manifest.json`、`styles.css`、许可证文件和 SHA-256 校验文件；不会包含
`.env`、模型、媒体、Vault 或依赖缓存。

## 安全与贡献

不要提交 API key、Cookie、自定义供应商 `data.json`、真实媒体、转写、Whisper 权重、输出目录
或 Vault 内容。漏洞请按 `SECURITY.md` 私下报告；贡献流程见 `CONTRIBUTING.md`，行为准则见
`CODE_OF_CONDUCT.md`。

## 许可证

- 根目录 Python 引擎、测试、脚本和文档：Apache-2.0；
- `obsidian-plugin/`：AGPL-3.0-or-later；
- 依赖和外部运行时：见 `THIRD-PARTY-NOTICES.md`。

## 相关文档

- [架构说明](docs/architecture.md)
- [变更记录](CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)
- [安全政策](SECURITY.md)
- [第三方声明](THIRD-PARTY-NOTICES.md)
- [历史设计计划](docs/archive/REDESIGN_PLAN.md)
