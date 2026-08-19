# VideoMemo architecture

## Runtime boundary

VideoMemo has two cooperating products:

1. **Python engine** (`src/`): downloads or imports media, extracts audio, reads
   subtitles, runs local Whisper transcription, extracts frames, calls an
   OpenAI-compatible model, and writes reports.
2. **Obsidian plugin** (`obsidian-plugin/`): provides the desktop UI, resolves the
   current Vault and provider settings, launches the Python engine with
   `shell: false`, streams progress, and opens the generated note.

The Python engine is Apache-2.0. The plugin directory is a separate
AGPL-3.0-or-later component because its provider settings workflow includes
adaptations from CLI-Manager. See the root `NOTICE`, plugin `NOTICE`, and
`THIRD-PARTY-NOTICES.md`.

## Processing flow

```text
URL or local media
  ├─ URL: yt-dlp probes site metadata, formats, subtitles, and cookies
  │        ├─ ordinary HTTP direct media → validated Range transport (optional)
  │        ├─ HLS/DASH/other formats → yt-dlp transport
  │        └─ fast transport failure → yt-dlp fallback
  └─ local media: use source in place; never copy or delete the original

selected media
  ├─ ffmpeg → mono 16 kHz audio.wav
  ├─ platform VTT → transcript.txt
  ├─ otherwise faster-whisper → transcript.txt
  ├─ video + ffmpeg → evenly sampled frames/frame_*.jpg (unless --no-vision)
  └─ OpenAI-compatible API → summary.md → optional Obsidian note
```

## Stable contracts

The following are intentionally stable across refactors:

- CLI flags: `--obsidian-vault`, `--obsidian-folder`, `--json-progress`,
  `--llm-model`, `--api-base-url`, `--cleanup-media`, and `--regenerate`;
- plugin progress prefix: `@@VIDEOMEMO@@` followed by JSON events;
- event types: `progress`, `artifact`, and `result`;
- run artifacts: `summary.md`, `transcript.txt`, `audio.wav`, `frames/`,
  `source.*`, and `info.json`;
- cache claim/status fields and the `--regenerate` workflow;
- Obsidian settings keys and the `video-memo` plugin ID.

## Download backends

`yt-dlp` remains the site extractor and the compatibility fallback. The
independent `fast_download.py` transport is deliberately limited to ordinary
HTTP(S) media URLs returned by yt-dlp. It validates ranges, sizes and hashes,
uses at most four workers, and atomically commits a completed file. It does not
parse HLS/DASH manifests or handle browser Cookie sessions.

## Secrets and local data

cc-switch provider keys are read only from the cc-switch database. Custom
provider keys are persisted in the Vault plugin data file
(`.obsidian/plugins/video-memo/data.json`) by explicit user choice. Either way,
keys are injected into the Python child process environment and are never placed
in command-line arguments, logs, or output files. `.env`, browser cookies,
downloaded media, Whisper weights, generated output, and Vault content are local
data and must not enter Git history or CI artifacts.
