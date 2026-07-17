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

The task dialog separates video links from local media and provides a native file picker. The provider settings read the local `~/.cc-switch/cc-switch.db` in read-only mode and use a provider-list-to-detail workflow with CLI filters, masked environment data, and a model dropdown. A task can follow the current global cc-switch provider or pin one provider. Secrets are read only when the Python child process starts and are never written to plugin data.

The plugin launches Python with `shell: false`, streams structured progress to the status bar, exports the note into the current Vault, and opens the generated note when processing completes.

The cc-switch provider workflow and layout are adapted from [CLI-Manager](https://github.com/dark-hxx/CLI-Manager), Copyright (c) 2026 Chenyme, under AGPL-3.0-or-later. See `NOTICE` and `LICENSE`.
