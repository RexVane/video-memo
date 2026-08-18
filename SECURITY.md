# Security policy

## Reporting a vulnerability

请不要在公开 issue 中发布可利用的安全问题。请通过 GitHub 仓库的私密安全报告
功能联系维护者；如果该功能不可用，可联系 GitHub 用户 `RexVane`，并只提供最少的
复现信息。请勿在报告中发送 API key、Cookie、媒体文件或 Vault 内容。

## Security boundaries

- VideoMemo 不应把 API key 或浏览器 Cookie 写入 Git、插件设置、日志、`info.json`
  或 GitHub Actions artifact；
- 自定义 API Base URL 会接收 API key，生产环境应使用可信 HTTPS 服务；
- 下载器会过滤敏感请求头，但用户仍应把 Cookie 和媒体链接视为机密；
- 本地媒体、转写和 Whisper 模型默认保存在用户机器上；
- ffmpeg、yt-dlp、Python 和 Node 运行时应从可信来源安装并及时更新；
- 不要把真实的视频、字幕、模型权重或 Obsidian Vault 提交到测试夹具。

安全修复发布后会在 CHANGELOG 中记录影响范围和升级建议，不公开披露仍可利用的
细节。
