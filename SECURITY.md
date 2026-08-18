# Security policy

## Reporting a vulnerability

请不要在公开 issue 中发布可利用的安全问题。请通过 GitHub 仓库的私密安全报告
功能联系维护者；如果该功能不可用，可联系 GitHub 用户 `RexVane`，并只提供最少的
复现信息。请勿在报告中发送 API key、Cookie、媒体文件或 Vault 内容。

## Security boundaries

- VideoMemo 不应把 API key 或浏览器 Cookie 写入 Git、日志、`info.json` 或 GitHub Actions artifact；
- 用户在 Obsidian 中添加的每个自定义供应商 API key 均按明文保存在当前 Vault 的
  `.obsidian/plugins/video-memo/data.json`；该文件不得提交、分享或加入同步到不受信任设备的范围；
- 自定义 API Base URL 会接收 API key，生产环境应使用可信 HTTPS 服务；localhost 可使用 HTTP；
- “刷新模型”只向由 Base URL 推导出的 `/models` 端点发送凭据（Chat/Responses 使用
  `Authorization: Bearer`，Anthropic 使用 `x-api-key` + `anthropic-version`），不发起聊天/总结请求；
- “测试连接”会先获取模型列表，再向所选模型发送一次最小真实请求（`ping`，max_tokens 8）
  以验证模型可调用，该请求会消耗极少量 token 并携带对应协议的认证凭据；
  Chat/Responses 发送到 `/chat/completions` 或 `/responses`，Anthropic 发送到 `/v1/messages`；
- 下载器会过滤敏感请求头，但用户仍应把 Cookie 和媒体链接视为机密；
- 本地媒体、转写和 Whisper 模型默认保存在用户机器上；
- ffmpeg、yt-dlp、Python 和 Node 运行时应从可信来源安装并及时更新；
- 不要把真实的视频、字幕、模型权重或 Obsidian Vault 提交到测试夹具。

安全修复发布后会在 CHANGELOG 中记录影响范围和升级建议，不公开披露仍可利用的
细节。
