# Third-party notices

This file records the principal third-party software and external resources
used by VideoMemo. Versions and license terms must be checked again when
creating a binary or plugin release.

## Python dependencies

The direct runtime dependencies are declared in `requirements.txt` and are
installed from their upstream Python distributions:

| Component | Use | License / source |
| --- | --- | --- |
| openai | OpenAI-compatible API client | Apache-2.0 · https://github.com/openai/openai-python |
| yt-dlp | Site extraction, subtitles, and media downloads | Unlicense for source/PyPI distributions · https://github.com/yt-dlp/yt-dlp |
| faster-whisper | Local speech recognition | MIT · https://github.com/SYSTRAN/faster-whisper |
| python-dotenv | `.env` loading | BSD-3-Clause · https://github.com/theskumar/python-dotenv |
| customtkinter | Desktop GUI | See the exact distribution license; metadata has historically included conflicting CC0/MIT fields · https://github.com/TomSchimansky/CustomTkinter |
| webvtt-py | WebVTT parsing | MIT · https://github.com/glut23/webvtt-py |
| tomli | Python 3.10 TOML compatibility only | MIT · https://github.com/hukkin/tomli |

`faster-whisper` also installs transitive dependencies such as CTranslate2,
Hugging Face Hub, tokenizers, ONNX Runtime, PyAV, and tqdm. A release that
vendors Python dependencies must generate a complete, versioned license report
for the resolved environment; this source repository does not vendor them.

## Obsidian plugin

The plugin is a separate AGPL-3.0-or-later component. Its provider settings
workflow contains adaptations from:

- CLI-Manager, Copyright (c) 2026 Chenyme, AGPL-3.0-or-later:
  https://github.com/dark-hxx/CLI-Manager
- `smol-toml`, Copyright Squirrel Chat et al., BSD-3-Clause:
  https://github.com/squirrelchat/smol-toml

The plugin's corresponding source is the `obsidian-plugin/` directory at:
https://github.com/RexVane/video-memo

## Independent design references

`src/fast_download.py` is an independent Python implementation of ordinary
HTTP Range transport. Its design was informed by xiuxiu-downloader, Copyright
(c) 2026 Melody-YK, MIT:
https://github.com/Melody-YK/xiuxiu-downloader

No xiuxiu-downloader source code is bundled here. If future changes copy or
substantially adapt its source, its MIT copyright and permission notice must be
included with the affected distribution.

## External runtime and data

- ffmpeg and ffprobe are required external programs and are not bundled.
  Their license depends on the build configuration; see https://ffmpeg.org/legal.html.
- Whisper model weights are downloaded at runtime and are not committed. Any
  distribution that vendors model weights must include the model card and
  applicable license from the model provider.
- A standalone/PyInstaller yt-dlp executable is not distributed. Such releases
  can contain additional GPL, ISC, or MIT components; consult yt-dlp's own
  `THIRD_PARTY_LICENSES.txt` before bundling one.
- Obsidian and Electron are host runtimes, external to the plugin bundle.
