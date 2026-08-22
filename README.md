# VideoMemo

[English](README.md) | [简体中文](README.zh-CN.md)

VideoMemo turns a video link, local video, or audio recording into searchable learning notes. It combines a local Python engine with a desktop Obsidian plugin, and can write the final Markdown note and sampled frames directly into an Obsidian vault.

## What It Does

```text
Video URL or local media
        |
        v
Platform subtitles first; local faster-whisper transcription as a fallback
        |
        v
Optional evenly sampled video frames
        |
        v
Structured notes from an OpenAI-compatible language/vision model
        |
        v
Markdown report, with optional Obsidian note and frame attachments
```

- Remote URLs are parsed with `yt-dlp`, including site formats, subtitles, and cookies. Eligible ordinary HTTP media may use a validated multi-connection Range download and transparently falls back to `yt-dlp` when needed.
- Local media is read in place. The original file is never copied or deleted. Video can be sampled for visual analysis; audio skips frame extraction.
- Subtitles are preferred in this order: platform-provided manual subtitles, automatic subtitles, then local Whisper transcription.
- Transcription stays local. Summary requests send the transcript and selected key frames to the model service you configure.
- Private, loopback, and link-local addresses are rejected by the fast downloader by default; a hostname is rejected when any resolved address is private, and connections are pinned to validated addresses to close DNS-rebinding gaps. Set `VIDEOMEMO_ALLOW_PRIVATE_URLS=1` only for a trusted local media server.

## Requirements

| Component | Requirement |
| --- | --- |
| Python | 3.10-3.13; Python 3.10 uses the `tomli` TOML compatibility package |
| ffmpeg | Required and available on `PATH`; binaries are not bundled |
| ffprobe | Recommended; some media durations cannot be read without it |
| Windows GUI | Windows 10/11; a project `.venv` is recommended |
| Obsidian plugin | Desktop Obsidian; mobile Obsidian is not supported. The cc-switch provider source additionally needs Obsidian 1.9.10+ (an installer with `node:sqlite`); custom providers work on older runtimes |
| Node.js | 18+ only when building the plugin from source |
| Model | An image-capable OpenAI-compatible model when vision is enabled; `--no-vision` only requires a text model |

## Install the Python Engine

From the repository root on Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

The engine can also be installed as a command-line tool:

```powershell
.\.venv\Scripts\python.exe -m pip install -e .
videomemo --version
```

The first Whisper run downloads weights into `models/faster-whisper/`, which is ignored by Git. Set `WHISPER_MODEL_DIR` to use another location. For an installed `videomemo` command, the current working directory is the default data root; set `VIDEOMEMO_PROJECT_ROOT` to place `.env`, models, and output under another project root.

## API Configuration

Configuration is resolved in this order, from highest to lowest priority:

1. Values explicitly supplied by the GUI, the Obsidian plugin, or CLI options.
2. `.env` or environment variables such as `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`.
3. The local `~/.grok/config.toml` profile.
4. `XAI_API_KEY` (xAI default endpoint) or `OPENAI_API_KEY` (OpenAI default endpoint).

Accepted base URL variables include `OPENAI_BASE_URL`, `OPENAI_API_BASE`, `XAI_BASE_URL`, and `GROK_MODELS_BASE_URL`. Accepted xAI key aliases include `GROK_API_KEY` and `GROK_CODE_XAI_API_KEY`. Base URLs may use `http` or `https`; use trusted HTTPS services in production and reserve `http://localhost` for a local service.

`LLM_API_FORMAT` supports `chat_completions` (default), `responses` (also accepted as `openai_responses` or `response`), and `anthropic_messages` (also accepted as `anthropic` or `messages`). Anthropic requests use `x-api-key` and `anthropic-version: 2023-06-01` at `<base_url>/messages`; Chat Completions and Responses use Bearer authentication. `LLM_NOTES_MODEL` can select a separate model for long-transcript chapter notes. Never put an API key in logs, output files, or Git.

See [.env.example](.env.example) for the non-secret variable template.

## Desktop GUI

```powershell
.\start_gui.cmd
# or
.\.venv\Scripts\python.exe src/app_gui.py
```

The GUI accepts a URL or local media path and exposes Whisper model/quality, language, browser cookies, frame count, model, API settings, optional Obsidian export, progress, cancellation, result-folder opening, and summary copying. A failed or cancelled run clears the previous-result state so stale output is not presented as the current result.

## Command Line

```powershell
# Remote video
.\summarize.cmd "https://www.youtube.com/watch?v=xxxx"
python src/pipeline.py "https://www.bilibili.com/video/BVxxxx"

# Local video or recording
.\summarize.cmd "D:\Media\course.mp4"
.\summarize.cmd "D:\Media\meeting.m4a"

# Login-required sites: try anonymous access first, then browser cookies
python src/pipeline.py "URL" --cookies-from-browser edge
python src/pipeline.py "URL" --cookies "D:\secure\cookies.txt"

# Reuse a run's transcription and frames to regenerate its report
python src/pipeline.py --regenerate "output\20260716_120000_course"

# Export the report and frames to an Obsidian vault
python src/pipeline.py "URL" --obsidian-vault "D:\Notes\My Vault"

# Print the engine version
python src/pipeline.py --version
```

| Option | Description |
| --- | --- |
| `-o, --output DIR` | Output root directory |
| `-m, --whisper-model` | `tiny`, `base`, `small`, `medium`, or `large-v3` |
| `-l, --language` | Speech language such as `zh` or `en`; automatic detection by default |
| `--max-frames N` | Maximum number of key frames sent to the vision model |
| `--no-vision` | Skip visual analysis and require only a text model |
| `--cleanup-media` | Delete downloaded media and `audio.wav` after a successful run |
| `--llm-model MODEL` | Model name |
| `--api-base-url URL` | Temporarily override the API base URL |
| `--cookies-from-browser BROWSER` | Read cookies from a supported browser |
| `--cookies FILE` | Use an exported `cookies.txt` file |
| `--obsidian-vault DIR` | Export the report and frames to a vault |
| `--obsidian-folder DIR` | Vault-relative destination; empty means an AI-generated topic folder |
| `--regenerate DIR` | Regenerate from an existing run directory |
| `--version` | Print the engine version |
| `--json-progress` | Emit structured progress events for the plugin |

Supported video extensions include `.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`, `.flv`, `.m4v`, `.ts`, `.mpg`, `.mpeg`, `.wmv`, `.3gp`, `.3g2`, `.f4v`, and `.ogv`. Supported audio extensions include `.mp3`, `.wav`, `.m4a`, `.flac`, `.aac`, `.ogg`, `.opus`, `.wma`, `.amr`, `.aiff`, `.mka`, `.oga`, `.weba`, and `.mpga`.

## Output and Cache

Each task is stored under `output/<timestamp>_<title>/` and normally contains:

- `summary.md`: a scan-friendly structured learning note;
- `transcript.txt`: timestamped transcription;
- `audio.wav`: intermediate audio used for ASR;
- `frames/`: evenly sampled video frames when vision is enabled;
- `source.*`: downloaded remote media (local input is never copied);
- `info.json`: metadata, cache information, and completion state.

Compatible recent runs for the same source are reused. `--cleanup-media` removes only downloaded media and the generated audio from the current run, leaving the report, transcript, subtitles, and frames. Original local media is never removed. Failed, cancelled, or interrupted operations recover their run status and keep cache generations consistent; missing chapter requests remain marked in the report instead of being silently dropped.

## Obsidian Plugin

`obsidian-plugin/` contains the desktop-only `video-memo` plugin. It provides an input dialog, provider/model settings, live progress, cancellation, background runs, and automatic opening of the completed note. The plugin starts the Python engine with `shell: false`, so Python dependencies, `ffmpeg`, and `yt-dlp` must still be installed.

Build and install it manually:

```powershell
cd obsidian-plugin
npm.cmd ci
npm.cmd run check
npm.cmd run build
.\install.ps1 -VaultPath "D:\Notes\My Vault"
```

The installer places the built files under:

```text
<your-vault>/.obsidian/plugins/video-memo/
```

Enable the plugin; the project directory containing `src/pipeline.py` is pre-filled by the installer, auto-detected on first load (a shallow scan for a `VideoMemo` folder with `src/pipeline.py`), or set manually in its settings. Python is detected from that project's `.venv`, then falls back to `python` on `PATH`. The installer copies the built runtime files (`main.js`, `manifest.json`, and `styles.css`) together with `LICENSE`, `NOTICE`, and `COPYRIGHT.md`; TypeScript source and build configuration remain in this repository.

Provider settings support a read-only cc-switch database and multiple editable OpenAI-compatible custom providers. Reading the cc-switch database requires a runtime with `node:sqlite` (Obsidian 1.9.10+ with the updated installer); on older runtimes the plugin detects this and falls back to the custom provider source. Each custom provider has a name, API root URL, API key, protocol format, and model, with one active provider at a time. The plugin can discover models through `/models`; "Test connection" fetches the model list and sends a minimal real request to the selected model. Enter a root such as `https://example.com/v1`, not `/chat/completions`, `/responses`, or `/messages`.

Custom provider API keys are stored in plaintext in the current vault at `.obsidian/plugins/video-memo/data.json`. They are not put in command-line arguments, logs, or output files. Never commit, share, or sync this file to an untrusted device. The custom-provider workflow remains available on older Obsidian/Electron runtimes that lack `node:sqlite`.

## Migrating Legacy Notes

Older releases wrote notes to `<vault>/Video Memos/` with a `_<source-id>` filename suffix. To move them to the current `<vault>/<topic>/<AI title>.md` layout, use `tools/migrate_obsidian_notes.py`:

```powershell
# Preview the plan; use --no-llm or --topic "Git" to avoid classification
python tools/migrate_obsidian_notes.py --vault "D:\Notes\My Vault"

# Apply after reviewing the plan
python tools/migrate_obsidian_notes.py --vault "D:\Notes\My Vault" --apply
```

The migration moves notes and attachments, rewrites `![[...]]` embeds, restores source markers, avoids overwriting existing files, and keeps backups or unclassified notes in the legacy folder.

## Development

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests -v
python -m ruff check src tests
cd obsidian-plugin
npm.cmd ci
npm.cmd run check
npm.cmd run build
```

GitHub Actions tests Python 3.10-3.13, runs the Python test suite, type-checks the plugin, and verifies the generated bundle. Tag releases build the plugin bundle and a SHA-256 checksum; they do not include `.env`, models, media, vault data, or dependency caches.

## Security and Contributions

Do not commit API keys, cookies, custom-provider `data.json`, real media, transcripts, Whisper weights, output directories, or vault contents. Report vulnerabilities privately through [SECURITY.md](SECURITY.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## License

All VideoMemo source code, including the Python engine and `obsidian-plugin/`, is released under the [MIT License](LICENSE). Third-party dependencies and external resources remain under their respective licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Third-party notices](THIRD-PARTY-NOTICES.md)
- [Archived design plan](docs/archive/REDESIGN_PLAN.md)
