# VideoMemo for Obsidian

Desktop-only Obsidian shell for the Python engine in the parent project.

## Build

```powershell
cd obsidian-plugin
npm.cmd ci
npm.cmd run check
npm.cmd run build
```

Install the built plugin files into a Vault:

```powershell
.\install.ps1 -VaultPath "D:\Notes\My Vault"
```

Enable the plugin, then set the VideoMemo project directory in Obsidian settings. Python is detected automatically from the project `.venv`, with PATH `python` as fallback. The installer copies `main.js`, `manifest.json`, `styles.css`, `LICENSE`, `NOTICE`, and `COPYRIGHT.md`; build dependencies remain in the project directory.

Commands:

- `VideoMemo: 总结视频链接或本地音视频`
- `VideoMemo: 从已有运行目录重新生成报告`
- `VideoMemo: 取消当前总结任务`
- `VideoMemo: 打开插件设置`
- `VideoMemo: 打开供应商设置`

The task dialog separates video links from local media, provides a native file picker, and shows a read-only badge with the provider and model the run will use. The settings home keeps provider, project, Python, Vault, and cleanup options in one list. Opening the provider row enters provider settings: cc-switch offers a read-only database list and redacted detail page, and custom mode provides an editable OpenAI-compatible provider list with add/edit/delete and active selection. cc-switch secrets remain in its database and are read only for model discovery or Python startup; custom keys follow the plaintext local persistence described below.

The plugin launches Python with `shell: false` and streams structured progress into a live progress panel (progress bar, scrolling log, cancel, run-in-background) plus the status bar; clicking the status bar reopens the panel. The Python engine keeps `yt-dlp` as its site parser and subtitle/HLS/DASH downloader; for eligible ordinary HTTP media it may use a validated multi-connection Range transport and transparently falls back to `yt-dlp` when needed. Failures show the stderr tail with one-click copy. The note is exported into the current Vault and opened automatically when processing completes.

Provider settings support a read-only cc-switch database and custom OpenAI-compatible providers. Multiple custom providers can be added; each accepts a name, API root URL, API key, protocol format, and model, with one active at a time. Three wire formats are supported: Anthropic Messages (`/v1/messages`, authenticated with `x-api-key` + `anthropic-version: 2023-06-01`), Chat Completions, and Responses (both Bearer-authenticated). Refreshing models sends an authenticated GET to the derived `/models` endpoint. Testing the connection fetches the model list and then sends a minimal real request (`ping`, max_tokens 8) to the selected model to verify it is callable; this consumes a small amount of tokens. Enter an API root such as `https://example.com/v1`, not `/chat/completions`, `/responses` or `/messages`.

Each custom provider's API key is stored in plaintext in the current Vault's `.obsidian/plugins/video-memo/data.json`. They are not placed in command-line arguments, logs, or output files. Do not commit, share, or sync that file to untrusted devices. Use trusted HTTPS services in production; localhost HTTP is supported.

The cc-switch database view requires an Obsidian/Electron runtime with `node:sqlite`. On older desktop runtimes, the plugin still loads and can use the custom provider source.

The cc-switch provider workflow and layout are adapted from [CLI-Manager](https://github.com/dark-hxx/CLI-Manager), Copyright (c) 2026 Chenyme, under AGPL-3.0-or-later. See `NOTICE`, `COPYRIGHT.md`, and `LICENSE`. The corresponding source for a released bundle is published in the `obsidian-plugin/` directory of [RexVane/video-memo](https://github.com/RexVane/video-memo).
