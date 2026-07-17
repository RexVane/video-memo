from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import pipeline  # noqa: E402
from download import BrowserCookieError, DownloadResult, VideoMetadata  # noqa: E402
from llm_config import LLMConfig  # noqa: E402
from transcribe import Transcript  # noqa: E402


class FixedDatetime:
    @classmethod
    def now(cls) -> datetime:
        return datetime(2026, 7, 16, 12, 0, 0)


class PipelineTests(unittest.TestCase):
    def test_url_identity_removes_tracking_but_keeps_video_id(self) -> None:
        first = pipeline._url_identity(
            "https://www.youtube.com/watch?v=first&utm_source=test"
        )
        second = pipeline._url_identity("https://www.youtube.com/watch?v=second")

        self.assertEqual(first, "https://www.youtube.com/watch?v=first")
        self.assertNotEqual(first, second)

    def test_local_media_path_detects_files_and_urls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            media = Path(tmp) / "talk.mp4"
            media.write_bytes(b"x")

            self.assertEqual(pipeline.local_media_path(str(media)), media.resolve())
            self.assertEqual(
                pipeline.local_media_path(f'"{media}"'), media.resolve()
            )
            self.assertEqual(
                pipeline.local_media_path(media.resolve().as_uri()), media.resolve()
            )
            self.assertIsNone(pipeline.local_media_path("https://example.test/v"))
            self.assertIsNone(
                pipeline.local_media_path(str(Path(tmp) / "missing.mp4"))
            )
            self.assertIsNone(pipeline.local_media_path(""))

    def test_probe_video_skips_browser_cookie_when_anonymous_access_works(self) -> None:
        metadata = VideoMetadata("Title", 1.0, "url", "", "")
        with patch.object(pipeline, "probe", return_value=metadata) as probe_mock:
            result, browser = pipeline._probe_video(
                "https://example.test/video",
                cookies_from_browser="chrome",
                cookies_file=None,
                progress=lambda _message, _pct: None,
            )

        self.assertIs(result, metadata)
        self.assertIsNone(browser)
        probe_mock.assert_called_once_with("https://example.test/video")

    def test_probe_video_uses_browser_only_after_anonymous_failure(self) -> None:
        metadata = VideoMetadata("Title", 1.0, "url", "", "")
        with patch.object(
            pipeline,
            "probe",
            side_effect=[RuntimeError("login required"), metadata],
        ) as probe_mock:
            result, browser = pipeline._probe_video(
                "https://example.test/video",
                cookies_from_browser="chrome",
                cookies_file=None,
                progress=lambda _message, _pct: None,
            )

        self.assertIs(result, metadata)
        self.assertEqual(browser, "chrome")
        self.assertEqual(probe_mock.call_count, 2)
        self.assertEqual(
            probe_mock.call_args_list[1].kwargs,
            {"cookies_from_browser": "chrome"},
        )

    def test_probe_video_explains_cookie_lock_after_anonymous_failure(self) -> None:
        with patch.object(
            pipeline,
            "probe",
            side_effect=[
                RuntimeError("login required"),
                BrowserCookieError("cookie database locked"),
            ],
        ):
            with self.assertRaisesRegex(BrowserCookieError, "匿名访问也未成功"):
                pipeline._probe_video(
                    "https://example.test/video",
                    cookies_from_browser="chrome",
                    cookies_file=None,
                    progress=lambda _message, _pct: None,
                )

    def test_work_dir_uses_title_and_is_unique(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            pipeline, "datetime", FixedDatetime
        ):
            root = Path(tmp)
            first = pipeline._work_dir(root, "A/B: 测试")
            second = pipeline._work_dir(root, "A/B: 测试")

            self.assertEqual(first.name, "20260716_120000_A_B_测试")
            self.assertEqual(second.name, "20260716_120000_A_B_测试_2")

    def test_find_reusable_download_includes_completed_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            work = root / "completed"
            work.mkdir()
            audio = work / "audio.wav"
            audio.write_bytes(b"RIFF" + (b"0" * 64))
            (work / "info.json").write_text(
                json.dumps(
                    {
                        "title": "Course",
                        "duration": 10,
                        "webpage_url": "https://example.test/v?id=1",
                        "description": "",
                        "uploader": "",
                        "video_path": None,
                        "audio_path": str(audio),
                    }
                ),
                encoding="utf-8",
            )
            (work / "summary.md").write_text("old summary", encoding="utf-8")

            reusable = pipeline._find_reusable_download(
                root, "https://example.test/v?id=1&utm_source=old"
            )

            self.assertIsNotNone(reusable)
            self.assertEqual(reusable[0], work)

    def test_missing_api_key_fails_before_probe(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            pipeline.shutil, "which", return_value="tool"
        ), patch.object(
            pipeline, "resolve_llm_config", side_effect=RuntimeError("missing key")
        ), patch.object(pipeline, "probe") as probe_mock:
            with self.assertRaisesRegex(RuntimeError, "missing key"):
                pipeline.run("https://example.test/video", out_root=Path(tmp))
            probe_mock.assert_not_called()

    def test_main_regenerates_an_existing_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            pipeline, "regenerate_report", return_value=Path(tmp) / "summary.md"
        ) as regenerate_mock:
            exit_code = pipeline.main(
                ["--regenerate", tmp, "--llm-model", "test-model"]
            )

        self.assertEqual(exit_code, 0)
        regenerate_mock.assert_called_once_with(
            Path(tmp).resolve(),
            llm_model="test-model",
            api_base_url=None,
            obsidian_vault=None,
            obsidian_folder="Video Summaries",
            on_progress=None,
        )

    def test_main_emits_machine_readable_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            pipeline, "run", return_value=Path(tmp) / "summary.md"
        ) as run_mock, io.StringIO() as output, redirect_stdout(output):
            exit_code = pipeline.main(
                ["https://example.test/video", "--json-progress"]
            )
            emitted = output.getvalue()

        self.assertEqual(exit_code, 0)
        self.assertIn(pipeline.JSON_EVENT_PREFIX, emitted)
        self.assertIn('"type": "result"', emitted)
        self.assertIs(run_mock.call_args.kwargs["on_progress"], pipeline._json_progress)

    def test_run_uses_platform_subtitle_without_whisper(self) -> None:
        metadata = VideoMetadata(
            title="Captioned course",
            duration=30,
            webpage_url="https://example.test/captioned",
            description="",
            uploader="Teacher",
            subtitle_language="en",
        )

        def fake_download(_url: str, work_dir: Path, **_kwargs) -> DownloadResult:
            audio = work_dir / "audio.wav"
            audio.write_bytes(b"RIFF" + (b"0" * 64))
            subtitle = work_dir / "source.en.vtt"
            subtitle.write_text("WEBVTT", encoding="utf-8")
            return DownloadResult(
                video_path=None,
                audio_path=audio,
                title=metadata.title,
                duration=metadata.duration,
                webpage_url=metadata.webpage_url,
                description="",
                uploader=metadata.uploader,
                subtitle_path=subtitle,
                subtitle_language="en",
            )

        with tempfile.TemporaryDirectory() as tmp, patch.object(
            pipeline.shutil, "which", return_value="tool"
        ), patch.object(
            pipeline,
            "resolve_llm_config",
            return_value=LLMConfig(
                api_key="test-key",
                base_url="https://api.example.test/v1",
                source="test",
            ),
        ), patch.object(
            pipeline, "probe", return_value=metadata
        ), patch.object(
            pipeline, "download", side_effect=fake_download
        ), patch.object(
            pipeline,
            "transcript_from_vtt",
            return_value=Transcript(
                language="en", text="[00:00] Caption text", segments=[]
            ),
        ) as subtitle_mock, patch.object(
            pipeline, "transcribe"
        ) as transcribe_mock, patch.object(
            pipeline, "summarize", return_value="## Summary"
        ):
            summary_path = pipeline.run(
                "https://example.test/captioned",
                out_root=Path(tmp),
            )

            self.assertTrue(summary_path.is_file())

        subtitle_mock.assert_called_once()
        transcribe_mock.assert_not_called()

    def test_run_writes_summary_under_titled_directory(self) -> None:
        metadata = VideoMetadata(
            title="A useful video",
            duration=60.0,
            webpage_url="https://example.test/video",
            description="Description",
            uploader="Author",
        )

        def fake_download(url: str, work_dir: Path, **kwargs) -> DownloadResult:
            audio = work_dir / "audio.wav"
            video = work_dir / "source.mp4"
            audio.write_bytes(b"audio")
            video.write_bytes(b"video")
            self.assertIs(kwargs["metadata"], metadata)
            return DownloadResult(
                video_path=video,
                audio_path=audio,
                title=metadata.title,
                duration=metadata.duration,
                webpage_url=metadata.webpage_url,
                description=metadata.description,
                uploader=metadata.uploader,
            )

        with tempfile.TemporaryDirectory() as tmp, patch.object(
            pipeline.shutil, "which", return_value="tool"
        ), patch.object(
            pipeline,
            "resolve_llm_config",
            return_value=LLMConfig(
                api_key="test-key",
                base_url="https://api.example.test/v1",
                source="test",
            ),
        ), patch.object(
            pipeline, "probe", return_value=metadata
        ), patch.object(pipeline, "download", side_effect=fake_download), patch.object(
            pipeline,
            "transcribe",
            return_value=Transcript(language="en", text="[00:00] Hello", segments=[]),
        ), patch.object(pipeline, "extract_frames", return_value=[]), patch.object(
            pipeline, "summarize", return_value="## 一句话摘要\nSummary"
        ):
            summary_path = pipeline.run(
                "https://example.test/video",
                out_root=Path(tmp),
            )

            self.assertIn("A_useful_video", summary_path.parent.name)
            summary = summary_path.read_text(encoding="utf-8")
            self.assertIn("# A useful video", summary)
            self.assertIn("## 一句话摘要", summary)
            self.assertNotIn("# 完整语音转写记录", summary)
            self.assertEqual(summary_path.name, "summary.md")
            self.assertTrue((summary_path.parent / "transcript.txt").is_file())

    def test_run_with_local_file_skips_probe_and_download(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "本地讲座.mp4"
            source.write_bytes(b"fake video")
            out_root = Path(tmp) / "out"

            def fake_import(path: Path, work_dir: Path) -> DownloadResult:
                work_dir.mkdir(parents=True, exist_ok=True)
                audio = work_dir / "audio.wav"
                audio.write_bytes(b"RIFF")
                return DownloadResult(
                    video_path=path,
                    audio_path=audio,
                    title=path.stem,
                    duration=30.0,
                    webpage_url=path.as_uri(),
                    description="",
                    uploader="本地文件",
                )

            with patch.object(
                pipeline.shutil, "which", return_value="tool"
            ), patch.object(
                pipeline,
                "resolve_llm_config",
                return_value=LLMConfig(
                    api_key="test-key",
                    base_url="https://api.example.test/v1",
                    source="test",
                ),
            ), patch.object(pipeline, "probe") as probe_mock, patch.object(
                pipeline, "download"
            ) as download_mock, patch.object(
                pipeline, "import_local_media", side_effect=fake_import
            ) as import_mock, patch.object(
                pipeline,
                "transcribe",
                return_value=Transcript(language="zh", text="[00:00] 你好", segments=[]),
            ), patch.object(pipeline, "extract_frames", return_value=[]), patch.object(
                pipeline, "summarize", return_value="## 摘要\n本地文件总结"
            ):
                summary_path = pipeline.run(str(source), out_root=out_root)

            probe_mock.assert_not_called()
            download_mock.assert_not_called()
            import_mock.assert_called_once()
            self.assertIn("本地讲座", summary_path.parent.name)
            summary = summary_path.read_text(encoding="utf-8")
            self.assertIn("# 本地讲座", summary)
            self.assertIn("本地文件总结", summary)


if __name__ == "__main__":
    unittest.main()
