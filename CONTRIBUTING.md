# Contributing to VideoMemo

感谢你对 VideoMemo 的兴趣。提交 issue 或 pull request 前，请先阅读
`CODE_OF_CONDUCT.md` 和 `SECURITY.md`。

## 开发环境

- Python 3.10–3.13；
- ffmpeg（包含 ffprobe）在 PATH 中；
- Node.js 18+，用于构建 Obsidian 插件；
- 一个不含真实密钥、Cookie、媒体或 Vault 数据的测试环境。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
cd obsidian-plugin
npm.cmd ci
npm.cmd run check
npm.cmd run build
```

## 提交变更

- 保持 CLI 参数、`@@VIDEOMEMO@@` 进度协议、输出文件名和 Obsidian 设置键兼容；
- 不提交 `.env`、API key、浏览器 Cookie、媒体、模型权重、`output/` 或 Vault 内容；
- 修改 TypeScript 或 CSS 后必须重新构建并提交 `obsidian-plugin/main.js`；
- 新增下载器行为时使用本地 fake HTTP 服务测试，不访问真实视频网站；
- 说明测试命令和任何平台限制；
- 不复制第三方源代码或许可证文本到不相应的目录。

## Pull request 清单

- [ ] 变更范围和兼容性影响已说明；
- [ ] Python 测试通过；
- [ ] 插件 `check` 和 `build` 通过（如涉及插件）；
- [ ] 文档和 CHANGELOG 已更新（如涉及用户行为）；
- [ ] 没有密钥、Cookie、真实媒体或生成物。
