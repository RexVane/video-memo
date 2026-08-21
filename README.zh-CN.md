# VideoMemo

[English](README.md) | [简体中文](README.zh-CN.md)

VideoMemo 将视频链接、本地视频或录音转换成可检索的学习笔记。项目由本地 Python 引擎和桌面端 Obsidian 插件组成，也可以把最终 Markdown 笔记和画面采样帧直接写入 Obsidian Vault。

## 核心功能

```text
视频链接或本地媒体
        |
        v
优先使用平台字幕；没有字幕时使用本地 faster-whisper 转写
        |
        v
可选：按时间均匀抽取视频画面
        |
        v
使用 OpenAI-compatible 文本/视觉模型生成结构化笔记
        |
        v
Markdown 报告，可选导出 Obsidian 笔记和画面附件
```

- 远程 URL 使用 `yt-dlp` 解析站点、格式、字幕和 Cookie。符合条件的普通 HTTP 媒体会尝试经过校验的 Range 多连接下载，失败时自动回退到 `yt-dlp`。
- 本地媒体直接读取原文件，不复制、不删除。视频可以抽帧进行画面分析，音频会自动跳过抽帧。
- 字幕优先级为：平台手工字幕、平台自动字幕、本地 Whisper 转写。
- 转写在本地完成；摘要请求会将转写和选定关键帧发送给你配置的模型服务。
- 快速下载默认拒绝私网、环回和链路本地地址。只有在确认媒体服务器可信时，才设置 `VIDEOMEMO_ALLOW_PRIVATE_URLS=1`。

## 支持环境

| 组件 | 要求 |
| --- | --- |
| Python | 3.10-3.13；Python 3.10 使用 `tomli` 兼容 TOML |
| ffmpeg | 必须安装并加入 `PATH`；项目不捆绑二进制 |
| ffprobe | 推荐安装；缺失时无法读取部分媒体时长 |
| Windows GUI | Windows 10/11；推荐使用项目 `.venv` |
| Obsidian 插件 | 桌面版 Obsidian；不支持移动端 |
| Node.js | 仅从源码构建插件时需要 18+ |
| 模型 | 启用画面分析时需要支持图片输入的 OpenAI-compatible 模型；`--no-vision` 只需要文本模型 |

## 安装 Python 引擎

在仓库根目录执行（Windows）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

也可以将引擎安装为命令行工具：

```powershell
.\.venv\Scripts\python.exe -m pip install -e .
videomemo --version
```

首次使用 Whisper 时会把权重下载到 `models/faster-whisper/`，该目录已被 Git 忽略。可用 `WHISPER_MODEL_DIR` 指定其他位置。通过已安装的 `videomemo` 命令运行时，默认数据根目录是当前工作目录；可用 `VIDEOMEMO_PROJECT_ROOT` 将 `.env`、模型和输出放到指定项目根目录。

## API 配置

配置优先级从高到低如下：

1. GUI、Obsidian 插件或 CLI 参数显式传入的值；
2. `.env` 或环境变量，例如 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`；
3. 本机 `~/.grok/config.toml` 配置；
4. `XAI_API_KEY`（xAI 默认端点）或 `OPENAI_API_KEY`（OpenAI 默认端点）。

支持的 Base URL 变量包括 `OPENAI_BASE_URL`、`OPENAI_API_BASE`、`XAI_BASE_URL` 和 `GROK_MODELS_BASE_URL`。支持的 xAI key 别名包括 `GROK_API_KEY` 和 `GROK_CODE_XAI_API_KEY`。Base URL 支持 `http` 和 `https`；生产环境应使用可信 HTTPS 服务，本地服务可以使用 `http://localhost`。

`LLM_API_FORMAT` 支持 `chat_completions`（默认）、`responses`（也接受 `openai_responses` 或 `response`）以及 `anthropic_messages`（也接受 `anthropic` 或 `messages`）。Anthropic 请求使用 `x-api-key` 和 `anthropic-version: 2023-06-01`，发送到 `<base_url>/messages`；Chat Completions 和 Responses 使用 Bearer 认证。`LLM_NOTES_MODEL` 可以为长转写章节笔记指定单独模型。不要把 API key 写入日志、输出文件或 Git。

非敏感变量模板见 [.env.example](.env.example)。

## 桌面 GUI

```powershell
.\start_gui.cmd
# 或
.\.venv\Scripts\python.exe src/app_gui.py
```

GUI 支持输入 URL 或本地媒体路径，并提供 Whisper 模型/精度、语言、浏览器 Cookie、关键帧数量、模型、API 配置、可选 Obsidian 导出、进度、取消、打开结果目录和复制总结等功能。任务失败或取消后会清除上一次结果状态，不会把旧输出误显示为当前结果。

## 命令行

```powershell
# 远程视频
.\summarize.cmd "https://www.youtube.com/watch?v=xxxx"
python src/pipeline.py "https://www.bilibili.com/video/BVxxxx"

# 本地视频或录音
.\summarize.cmd "D:\Media\course.mp4"
.\summarize.cmd "D:\Media\meeting.m4a"

# 需要登录的网站：先匿名访问，失败后读取浏览器 Cookie
python src/pipeline.py "URL" --cookies-from-browser edge
python src/pipeline.py "URL" --cookies "D:\secure\cookies.txt"

# 复用已有转写和关键帧，重新生成报告
python src/pipeline.py --regenerate "output\20260716_120000_course"

# 导出报告和画面到 Obsidian Vault
python src/pipeline.py "URL" --obsidian-vault "D:\Notes\My Vault"

# 查看引擎版本
python src/pipeline.py --version
```

| 参数 | 说明 |
| --- | --- |
| `-o, --output DIR` | 输出根目录 |
| `-m, --whisper-model` | `tiny`、`base`、`small`、`medium` 或 `large-v3` |
| `-l, --language` | 语言代码，如 `zh`、`en`；默认自动检测 |
| `--max-frames N` | 最多发送给视觉模型的关键帧数量 |
| `--no-vision` | 跳过画面分析，只需要文本模型 |
| `--cleanup-media` | 成功后删除下载媒体和 `audio.wav` |
| `--llm-model MODEL` | 模型名 |
| `--api-base-url URL` | 临时覆盖 API Base URL |
| `--cookies-from-browser BROWSER` | 从受支持的浏览器读取 Cookie |
| `--cookies FILE` | 使用导出的 `cookies.txt` |
| `--obsidian-vault DIR` | 导出报告和关键帧到 Vault |
| `--obsidian-folder DIR` | Vault 内目标文件夹；留空则按 AI 生成的主题创建子目录 |
| `--regenerate DIR` | 从已有运行目录重新生成报告 |
| `--version` | 显示引擎版本 |
| `--json-progress` | 为插件输出结构化进度事件 |

支持的视频扩展名包括 `.mp4`、`.mkv`、`.webm`、`.mov`、`.avi`、`.flv`、`.m4v`、`.ts`、`.mpg`、`.mpeg`、`.wmv`、`.3gp`、`.3g2`、`.f4v` 和 `.ogv`。支持的音频扩展名包括 `.mp3`、`.wav`、`.m4a`、`.flac`、`.aac`、`.ogg`、`.opus`、`.wma`、`.amr`、`.aiff`、`.mka`、`.oga`、`.weba` 和 `.mpga`。

## 输出与缓存

每个任务位于 `output/<时间戳>_<标题>/`，通常包含：

- `summary.md`：便于扫描的结构化学习笔记；
- `transcript.txt`：带时间戳的转写；
- `audio.wav`：ASR 使用的中间音轨；
- `frames/`：启用视觉且输入含视频时按时间均匀抽取的画面；
- `source.*`：远程下载的媒体（本地输入不会复制）；
- `info.json`：元数据、缓存信息和完成状态。

相同来源会复用兼容的最近任务。`--cleanup-media` 只删除当前运行目录中的下载媒体和生成音轨，保留报告、转写、字幕和关键帧；本地原始文件永远不会删除。失败、取消或中断后的运行会恢复状态并保持缓存代际一致；章节请求缺失时会在报告中保留缺失标记，不会静默跳过。

## Obsidian 插件

`obsidian-plugin/` 是仅支持桌面端的 `video-memo` 插件，提供输入弹窗、供应商/模型设置、实时进度、取消、后台运行和完成后自动打开笔记。插件通过 `shell: false` 启动 Python 引擎，因此仍需准备 Python 依赖、`ffmpeg` 和 `yt-dlp`。

手动构建和安装：

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

启用插件后，在设置中填写包含 `src/pipeline.py` 的项目目录。Python 会优先检测该项目的 `.venv`，未找到时回退到 `PATH` 中的 `python`。安装脚本会复制构建后的运行文件（`main.js`、`manifest.json` 和 `styles.css`）以及 `LICENSE`、`NOTICE` 和 `COPYRIGHT.md`；TypeScript 源码与构建配置保留在本仓库。

供应商设置支持只读的 cc-switch 数据库，也支持添加多个可编辑的 OpenAI-compatible 自定义供应商。每个自定义供应商可填写名称、API 根地址、API key、协议格式和模型，并选择一个当前供应商。插件可通过 `/models` 发现模型；“测试连接”会获取模型列表，再向所选模型发送一次最小真实请求。Base URL 应填写 `https://example.com/v1` 这类根地址，不要填写 `/chat/completions`、`/responses` 或 `/messages`。

自定义供应商 API key 会以明文保存在当前 Vault 的 `.obsidian/plugins/video-memo/data.json` 中，不会进入命令行参数、日志或输出文件。不要提交、分享或将该文件同步到不受信任的设备。缺少 `node:sqlite` 的旧版 Obsidian/Electron 仍可使用自定义供应商。

## 旧笔记迁移

旧版本把笔记写入 `<vault>/Video Memos/`，文件名带 `_<来源ID>` 后缀。要迁移到当前的 `<vault>/<主题>/<AI 标题>.md` 布局，请使用 `tools/migrate_obsidian_notes.py`：

```powershell
# 先预演计划；可用 --no-llm 或 --topic "Git" 跳过主题识别
python tools/migrate_obsidian_notes.py --vault "D:\Notes\My Vault"

# 检查计划后执行
python tools/migrate_obsidian_notes.py --vault "D:\Notes\My Vault" --apply
```

迁移工具会移动笔记和附件、改写 `![[...]]` 嵌入、补写来源标记并避免覆盖已有文件；备份和无法归类的笔记会保留在旧目录中。

## 开发

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests -v
python -m ruff check src tests
cd obsidian-plugin
npm.cmd ci
npm.cmd run check
npm.cmd run build
```

GitHub Actions 会测试 Python 3.10-3.13，运行 Python 测试、检查插件类型并验证构建产物。推送版本 tag 时会构建插件压缩包和 SHA-256 校验文件，不会包含 `.env`、模型、媒体、Vault 数据或依赖缓存。

## 安全与贡献

不要提交 API key、Cookie、自定义供应商 `data.json`、真实媒体、转写、Whisper 权重、输出目录或 Vault 内容。漏洞请通过 [SECURITY.md](SECURITY.md) 私下报告；贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，社区规范见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 许可证

VideoMemo 的全部源码（包括 Python 引擎和 `obsidian-plugin/`）均使用 [MIT License](LICENSE) 发布。第三方依赖与外部资源继续遵循各自许可证，详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 相关文档

- [架构说明](docs/architecture.md)
- [变更记录](CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)
- [安全政策](SECURITY.md)
- [第三方声明](THIRD-PARTY-NOTICES.md)
- [历史设计计划](docs/archive/REDESIGN_PLAN.md)
