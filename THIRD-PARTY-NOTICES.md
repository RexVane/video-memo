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
| httpx | Anthropic Messages HTTP client | BSD-3-Clause · https://github.com/encode/httpx |
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

The VideoMemo plugin source is MIT-licensed. Its bundled runtime dependency is:

- `smol-toml`, Copyright (c) Squirrel Chat et al., BSD-3-Clause:
  https://github.com/squirrelchat/smol-toml

### smol-toml BSD 3-Clause License

Copyright (c) Squirrel Chat et al., All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

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
