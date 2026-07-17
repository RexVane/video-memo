# Video Summarizer — 视频 / 录音总结

给它一个视频链接，或一个本地视频 / 录音文件，程序会：

1. **下载** 视频（`yt-dlp`，支持 YouTube、B 站等）；本地文件直接使用，跳过下载
2. **听** 优先读取平台字幕；没有可用字幕时提取音轨并用 **Whisper** 本地转写
3. **看** 均匀抽取关键帧（可选；纯音频输入自动跳过）
4. **总结** 调用支持图片输入的 **OpenAI 兼容 API** 生成中文结构化摘要

## 环境要求

- Python 3.10+
- [ffmpeg](https://ffmpeg.org/) 已在 PATH 中
- OpenAI 兼容 API 的 Key、Base URL 和多模态模型

推荐使用独立虚拟环境，避免与系统 Python 中的其它项目发生依赖冲突：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

API 配置有三种方式，优先级从高到低：

1. 在桌面界面填写 Base URL、API Key 和模型。
2. 使用 `.env` 或系统环境变量：`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`。
3. 自动复用 `~/.grok/config.toml` 中对应模型的 Key 和 Base URL；没有本机 Grok 配置时，`XAI_API_KEY` 默认连接 `https://api.x.ai/v1`。

自定义 Base URL 会收到所选 API Key，只应使用可信的 HTTPS 服务。系统环境变量不会被写入项目文件。

首次运行 Whisper 会自动下载模型权重（`base` 约 140MB）。

## 桌面程序（推荐）

双击或运行：

```powershell
.\start_gui.cmd
# 或
.\.venv\Scripts\python.exe src/app_gui.py
```

界面可：粘贴链接或点「选择文件…」挑选本地视频 / 录音、选 Whisper 精度、填写 OpenAI 兼容 API、输入任意模型名、选浏览器 Cookie（YouTube 反爬时用）、查看进度与总结、复制结果、打开输出文件夹。
启动脚本会优先使用 `.venv`，不存在时才使用 PATH 中的 Python。

## 命令行用法

```powershell
# Windows
.\summarize.cmd "https://www.youtube.com/watch?v=xxxx"

# 本地视频或录音文件（无需 yt-dlp，纯音频自动跳过画面分析）
.\summarize.cmd "D:\录像\课程.mp4"
.\summarize.cmd "D:\录音\会议.m4a"

# 或
python src/pipeline.py "https://www.bilibili.com/video/BVxxxx"

# YouTube 提示登录时，从本机浏览器读 Cookie
python src/pipeline.py "URL" --cookies-from-browser edge

# API 失败或需要更换模型时，复用已有转写和关键帧重新生成
python src/pipeline.py --regenerate "output\20260716_120000_课程"

# 同时导出为 Obsidian 笔记和附件
python src/pipeline.py "URL" --obsidian-vault "D:\Notes\My Vault"
```

支持的本地格式：视频 `mp4 / mkv / webm / mov / avi / flv / m4v / ts / mpg / mpeg / wmv`，音频 `mp3 / wav / m4a / flac / aac / ogg / opus / wma / amr / aiff`。本地模式不会复制原始媒体文件，只在输出目录生成音轨、转写与总结。

相同来源再次运行时会复用最近一次任务的下载结果和转写，并重新生成报告；修改 Whisper 模型后若要强制重新转写，请删除对应运行目录中的 `transcript.txt`。

### 常用参数

| 参数 | 说明 |
|------|------|
| `-m base` | Whisper 模型：`tiny` / `base` / `small` / `medium` / `large-v3` |
| `-l zh` | 指定语言（默认自动检测） |
| `--max-frames 8` | 给视觉模型的关键帧数量 |
| `--no-vision` | 只听不看（更快、更省 token） |
| `--cleanup-media` | 成功后删除下载媒体和音轨；保留总结、转写、字幕与关键帧 |
| `--llm-model grok-4.5` | OpenAI 兼容模型名（默认读取 `LLM_MODEL`） |
| `--api-base-url URL` | 临时覆盖 OpenAI 兼容 API 根地址 |
| `--regenerate DIR` | 从已有运行目录重新生成报告，不重复下载和转写 |
| `--obsidian-vault DIR` | 将报告与关键帧导出到 Obsidian Vault |
| `--obsidian-folder DIR` | Vault 内目标文件夹，默认 `Video Summaries` |
| `-o output` | 输出根目录 |

### 示例

```powershell
# 中文口播，更高精度转写
python src/pipeline.py "URL" -m small -l zh

# 只要文字总结，不传截图
python src/pipeline.py "URL" --no-vision

# 自定义 OpenAI 兼容服务；Key 从 LLM_API_KEY 读取
$env:LLM_API_KEY = "你的 API Key"
python src/pipeline.py "URL" --api-base-url "https://api.example.com/v1" --llm-model "vision-model"
```

## 输出

每次运行会在 `output/时间戳_标题/` 下生成：

- `summary.md` — 结构化总结
- `transcript.txt` — 带时间戳的转写
- `audio.wav` — 提取的音轨
- `frames/` — 关键帧（若启用视觉）
- `source.*` — 下载的原始媒体
- `info.json` — 元数据

使用 `--cleanup-media` 时，只清理本次输出目录中的下载媒体与 `audio.wav`；本地输入原文件永远不会被删除。清理后的运行目录仍可通过 `--regenerate` 重新生成报告。

指定 `--obsidian-vault` 后，程序会生成带 YAML frontmatter 的稳定命名笔记，并把关键帧复制到 Vault 内的附件目录。再次处理同一来源会更新同一篇笔记。

## Obsidian 桌面插件

`obsidian-plugin/` 提供桌面版薄壳插件。它将链接与本地文件分为两个输入模式，提供系统文件选择器，并通过子进程调用本项目的 Python 引擎。插件设置首页将供应商、项目目录和 Python 路径等选项放在同一栏目；点击供应商后进入 cc-switch 数据库与供应商列表，再点击具体供应商查看详情。模型下拉框会使用该供应商的 Base URL 和 Key 实时读取 OpenAI 兼容 `/models` 接口，失败时回退到本地配置模型。密钥只在请求或任务启动时读入内存，不写入插件配置。运行时会在状态栏显示进度，支持取消和重新生成，并在完成后自动打开导出的笔记。

插件的 cc-switch 供应商交互、解析逻辑与布局改编自 [CLI-Manager](https://github.com/dark-hxx/CLI-Manager)，Copyright (c) 2026 Chenyme，依据 AGPL-3.0-or-later 使用。详见 `obsidian-plugin/NOTICE` 与 `obsidian-plugin/LICENSE`。

```powershell
cd obsidian-plugin
npm.cmd install
npm.cmd run build
```

构建后运行 `obsidian-plugin/install.ps1 -VaultPath "D:\Notes\My Vault"` 安装必要文件，启用插件后在设置里填写本项目目录。插件仅支持桌面版 Obsidian；Python、ffmpeg、yt-dlp 和模型依赖仍由本项目环境提供。

## 能力与限制

| 能做 | 注意 |
|------|------|
| 听对白、旁白并转写 | 纯 BGM / 强噪音准确度下降 |
| 看截图里的场景、字幕、图表 | 不是逐帧「看完整部电影」 |
| 多平台链接（yt-dlp 支持的） | 需可访问；部分站点要 cookie |
| 本地 ASR，隐私较好 | 长视频耗时与磁盘占用增加 |

需要登录才能看的视频，可自行给 `yt-dlp` 配置 cookies（见 [yt-dlp 文档](https://github.com/yt-dlp/yt-dlp)）。
即使选择了浏览器 Cookie，程序也会先匿名访问；公开视频不会读取浏览器数据库。只有匿名访问失败时才读取 Cookie，从而避开 Chrome 数据库锁定问题。
长转写会拆成多个连续章节，并行生成详细学习笔记后再综合，因此会产生多次模型请求。关键帧最长边会压缩到 1280 像素，以控制上传体积。

## 开发验证

```powershell
.\.venv\Scripts\python.exe -m compileall -q src
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## 架构

```
URL / 本地媒体
 ├─ 平台字幕 → transcript
 └─ 无字幕时：ffmpeg → audio.wav → faster-whisper → transcript
                    ├─ ffmpeg → frames/*.jpg
                    └─ OpenAI-compatible LLM → summary.md
                                      └─ Obsidian 笔记 + 附件
```
