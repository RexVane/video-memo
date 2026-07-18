# Video Summarizer for Obsidian

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

Enable the plugin, then set the Video Summarizer project directory in Obsidian settings. The installer copies `main.js`, `manifest.json`, `styles.css`, `LICENSE`, and `NOTICE`; build dependencies remain in the project directory.

Commands:

- `Video Summarizer: 总结视频链接或本地音视频`
- `Video Summarizer: 从已有运行目录重新生成报告`
- `Video Summarizer: 取消当前总结任务`
- `Video Summarizer: 打开插件设置`
- `Video Summarizer: 打开供应商设置`

The task dialog separates video links from local media and provides a native file picker. The settings home keeps provider, project, Python, Vault, and cleanup options in one list. Opening the provider row enters a read-only cc-switch database page, then a provider detail page. The model dropdown requests the provider's OpenAI-compatible `/models` endpoint with its cc-switch URL and key, with local model fallback. A task can follow the current global cc-switch provider or pin one provider. Secrets are read only for model discovery or when the Python child process starts and are never written to plugin data.

The plugin launches Python with `shell: false`, streams structured progress to the status bar, exports the note into the current Vault, and opens the generated note when processing completes.

The cc-switch database view requires an Obsidian/Electron runtime with `node:sqlite`. On older desktop runtimes, the plugin still loads and can use the environment configuration source.

The cc-switch provider workflow and layout are adapted from [CLI-Manager](https://github.com/dark-hxx/CLI-Manager), Copyright (c) 2026 Chenyme, under AGPL-3.0-or-later. See `NOTICE` and `LICENSE`.
