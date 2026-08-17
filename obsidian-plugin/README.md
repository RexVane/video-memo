# VideoMemo for Obsidian

Desktop-only Obsidian shell for the Python engine in the parent project.

## Build

```powershell
cd obsidian-plugin
npm.cmd install
npm.cmd run build
```

Install the built plugin files into a Vault:

```powershell
.\install.ps1 -VaultPath "D:\Notes\My Vault"
```

Enable the plugin, then set the VideoMemo project directory in Obsidian settings. The installer copies `main.js`, `manifest.json`, `styles.css`, `LICENSE`, and `NOTICE`; build dependencies remain in the project directory.

Commands:

- `VideoMemo: 总结视频链接或本地音视频`
- `VideoMemo: 从已有运行目录重新生成报告`
- `VideoMemo: 取消当前总结任务`
- `VideoMemo: 打开插件设置`
- `VideoMemo: 打开供应商设置`

The task dialog separates video links from local media, provides a native file picker, and shows a read-only badge with the provider and model the run will use. The settings home keeps provider, project, Python, Vault, and cleanup options in one list. Opening the provider row enters a read-only cc-switch database page, then a provider detail page whose raw config is collapsed by default. The model dropdown requests the provider's OpenAI-compatible `/models` endpoint with its cc-switch URL and key, with local model fallback. A task can follow the current global cc-switch provider or pin one provider. Secrets are read only for model discovery or when the Python child process starts and are never written to plugin data.

The plugin launches Python with `shell: false` and streams structured progress into a live progress panel (progress bar, scrolling log, cancel, run-in-background) plus the status bar; clicking the status bar reopens the panel. The Python engine keeps `yt-dlp` as its site parser and subtitle/HLS/DASH downloader; for eligible ordinary HTTP media it may use a validated multi-connection Range transport and transparently falls back to `yt-dlp` when needed. Failures show the stderr tail with one-click copy. The note is exported into the current Vault and opened automatically when processing completes.

The cc-switch database view requires an Obsidian/Electron runtime with `node:sqlite`. On older desktop runtimes, the plugin still loads and can use the environment configuration source.

The cc-switch provider workflow and layout are adapted from [CLI-Manager](https://github.com/dark-hxx/CLI-Manager), Copyright (c) 2026 Chenyme, under AGPL-3.0-or-later. See `NOTICE` and `LICENSE`.
