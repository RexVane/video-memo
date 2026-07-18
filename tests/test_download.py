from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import download  # noqa: E402


class DownloadTests(unittest.TestCase):
    @patch("download.subprocess.run")
    def test_cookie_database_copy_error_has_actionable_message(self, run_mock) -> None:
        run_mock.return_value = SimpleNamespace(
            returncode=1,
            stdout="",
            stderr="ERROR: Could not copy Chrome cookie database.",
        )

        with self.assertRaisesRegex(download.BrowserCookieError, "完全退出浏览器"):
            download.probe(
                "https://example.test/watch/1",
                cookies_from_browser="chrome",
            )

    def test_cookie_sources_are_mutually_exclusive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "只能选择一种"):
                download._cookie_args("edge", cookie_file)

    def test_missing_cookie_file_has_clear_error(self) -> None:
        with self.assertRaises(FileNotFoundError):
            download._cookie_args(cookies_file=Path("missing-cookies.txt"))

    @patch("download.subprocess.run")
    def test_probe_normalizes_metadata(self, run_mock) -> None:
        run_mock.return_value = SimpleNamespace(
            returncode=0,
            stdout=json.dumps(
                {
                    "title": "Example",
                    "duration": 12,
                    "webpage_url": "https://example.test/watch/1",
                    "description": "Description",
                    "channel": "Channel",
                    "subtitles": {"en": [{"url": "manual"}]},
                    "automatic_captions": {"zh-Hans": [{"url": "auto"}]},
                }
            ),
            stderr="",
        )

        result = download.probe("https://example.test/watch/1")

        self.assertEqual(result.title, "Example")
        self.assertEqual(result.duration, 12.0)
        self.assertEqual(result.uploader, "Channel")
        self.assertEqual(result.subtitle_language, "en")
        self.assertFalse(result.subtitle_automatic)
        self.assertIn("--no-playlist", run_mock.call_args.args[0])

    def test_subtitle_selection_prefers_requested_manual_track(self) -> None:
        info = {
            "language": "ja",
            "subtitles": {
                "en": [{"url": "en"}],
                "zh-Hans": [{"url": "zh"}],
            },
            "automatic_captions": {"zh": [{"url": "auto"}]},
        }

        self.assertEqual(
            download._select_subtitle_track(info, "zh"),
            ("zh-Hans", False),
        )

    def test_subtitle_selection_falls_back_to_automatic_track(self) -> None:
        info = {
            "language": "en",
            "subtitles": {},
            "automatic_captions": {"en-orig": [{"url": "auto"}]},
        }

        self.assertEqual(
            download._select_subtitle_track(info),
            ("en-orig", True),
        )

    def test_requested_automatic_track_beats_unrelated_manual_track(self) -> None:
        info = {
            "language": "en",
            "subtitles": {"en": [{"url": "manual"}]},
            "automatic_captions": {"zh-Hans": [{"url": "auto"}]},
        }

        self.assertEqual(
            download._select_subtitle_track(info, "zh"),
            ("zh-Hans", True),
        )

    def test_cleanup_removes_only_media_inside_run_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            work = root / "run"
            work.mkdir()
            local_source = root / "original.mp4"
            local_source.write_bytes(b"original")
            audio = work / "audio.wav"
            audio.write_bytes(b"audio")
            downloaded = work / "source.m4a"
            downloaded.write_bytes(b"downloaded")
            subtitle = work / "source.zh.vtt"
            subtitle.write_text("WEBVTT", encoding="utf-8")
            result = download.DownloadResult(
                video_path=local_source,
                audio_path=audio,
                title="Title",
                duration=1,
                webpage_url=local_source.as_uri(),
                description="",
                uploader="本地文件",
                subtitle_path=subtitle,
                subtitle_language="zh",
            )

            count, removed_bytes = download.cleanup_media_files(work, result)

            self.assertEqual(count, 2)
            self.assertGreater(removed_bytes, 0)
            self.assertTrue(local_source.exists())
            self.assertTrue(subtitle.exists())
            self.assertFalse(audio.exists())
            self.assertFalse(downloaded.exists())

    def test_load_completed_cleaned_run_uses_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "transcript.txt").write_text("[00:00] text", encoding="utf-8")
            (work / "info.json").write_text(
                json.dumps(
                    {
                        "title": "Title",
                        "webpage_url": "https://example.test/video",
                        "audio_path": str(work / "missing.wav"),
                        "video_path": None,
                    }
                ),
                encoding="utf-8",
            )

            result = download.load_download_result(work)

            self.assertIsNotNone(result)
            self.assertIsNone(result.audio_path)

    @patch("download.subprocess.run")
    def test_download_requests_selected_automatic_subtitle(self, run_mock) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            metadata = download.VideoMetadata(
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
                subtitle_language="en-orig",
                subtitle_automatic=True,
            )

            def fake_run(command, **kwargs):
                if command[0] == "yt-dlp":
                    (work / "source.mp4").write_bytes(b"video")
                    (work / "source.en-orig.vtt").write_text(
                        "WEBVTT", encoding="utf-8"
                    )
                else:
                    Path(command[-1]).write_bytes(b"RIFF" + (b"0" * 64))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            run_mock.side_effect = fake_run
            result = download.download(
                "https://example.test/course",
                work,
                metadata=metadata,
            )

        yt_dlp_command = run_mock.call_args_list[0].args[0]
        self.assertIn("--write-auto-subs", yt_dlp_command)
        self.assertIn("--sub-langs", yt_dlp_command)
        self.assertEqual(result.subtitle_language, "en-orig")
        self.assertEqual(result.subtitle_path.name, "source.en-orig.vtt")


class ImportLocalMediaTests(unittest.TestCase):
    def test_rejects_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                download.import_local_media(
                    Path(tmp) / "missing.mp4", Path(tmp) / "work"
                )

    def test_rejects_unknown_extension(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "notes.txt"
            source.write_text("hello", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "不支持的媒体格式"):
                download.import_local_media(source, Path(tmp) / "work")

    @patch("download.probe_media_duration", return_value=42.5)
    @patch("download.subprocess.run")
    def test_video_file_keeps_source_and_extracts_audio(
        self, run_mock, _duration_mock
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "本地 讲座.mp4"
            source.write_bytes(b"fake video")
            work = Path(tmp) / "work"

            def fake_ffmpeg(cmd, **kwargs):
                Path(cmd[-1]).write_bytes(b"RIFF")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            run_mock.side_effect = fake_ffmpeg
            result = download.import_local_media(source, work)

            self.assertEqual(result.title, "本地 讲座")
            self.assertEqual(result.duration, 42.5)
            self.assertEqual(result.video_path, source.resolve())
            self.assertEqual(result.audio_path, work / "audio.wav")
            self.assertEqual(result.uploader, "本地文件")
            self.assertTrue(result.webpage_url.startswith("file:"))

            info = json.loads((work / "info.json").read_text(encoding="utf-8"))
            self.assertEqual(info["title"], "本地 讲座")
            self.assertEqual(info["audio_path"], str(work / "audio.wav"))

    @patch("download.probe_media_duration", return_value=None)
    @patch("download.subprocess.run")
    def test_audio_file_has_no_video_path(self, run_mock, _duration_mock) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "会议录音.m4a"
            source.write_bytes(b"fake audio")
            work = Path(tmp) / "work"

            def fake_ffmpeg(cmd, **kwargs):
                Path(cmd[-1]).write_bytes(b"RIFF")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            run_mock.side_effect = fake_ffmpeg
            result = download.import_local_media(source, work)

            self.assertIsNone(result.video_path)
            self.assertIsNone(result.duration)
            self.assertEqual(result.title, "会议录音")

    @patch("download.probe_media_duration", return_value=10.0)
    @patch("download.subprocess.run")
    def test_ffmpeg_failure_raises(self, run_mock, _duration_mock) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "clip.mp3"
            source.write_bytes(b"fake")
            run_mock.return_value = SimpleNamespace(
                returncode=1, stdout="", stderr="boom"
            )
            with self.assertRaisesRegex(RuntimeError, "提取音频失败"):
                download.import_local_media(source, Path(tmp) / "work")


if __name__ == "__main__":
    unittest.main()
