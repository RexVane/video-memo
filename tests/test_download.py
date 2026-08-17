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
from cancellation import CancellationRequested  # noqa: E402


def _format(
    name: str,
    *,
    ext: str,
    vcodec: str,
    acodec: str,
    protocol: str = "https",
    headers: dict[str, str] | None = None,
) -> dict:
    return {
        "url": f"https://cdn.example.test/{name}",
        "protocol": protocol,
        "ext": ext,
        "vcodec": vcodec,
        "acodec": acodec,
        "http_headers": headers or {},
    }


def _metadata_with_plan(
    plan: download.MediaTransferPlan,
    *,
    subtitle_language: str | None = None,
    subtitle_automatic: bool = False,
) -> download.VideoMetadata:
    return download.VideoMetadata(
        title="Course",
        duration=10,
        webpage_url="https://example.test/course",
        description="Description",
        uploader="Teacher",
        subtitle_language=subtitle_language,
        subtitle_automatic=subtitle_automatic,
        transfer_plan=plan,
    )


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
        self.assertIsNone(result.transfer_plan)
        command = run_mock.call_args.args[0]
        self.assertIn("--no-playlist", command)
        self.assertIn("--dump-single-json", command)
        self.assertEqual(command[command.index("-f") + 1], download.FORMAT_SELECTOR)

    @patch("download.subprocess.run")
    def test_probe_builds_progressive_transfer_plan(self, run_mock) -> None:
        info = {
            "title": "Progressive",
            **_format(
                "combined.mp4",
                ext="mp4",
                vcodec="avc1",
                acodec="mp4a",
                headers={"Referer": "https://example.test/watch"},
            ),
        }
        run_mock.return_value = SimpleNamespace(
            returncode=0,
            stdout=json.dumps(info),
            stderr="",
        )

        result = download.probe("https://example.test/watch/1")

        self.assertIsNotNone(result.transfer_plan)
        part = result.transfer_plan.progressive
        self.assertEqual(part.url, "https://cdn.example.test/combined.mp4")
        self.assertEqual(part.ext, "mp4")
        self.assertEqual(
            part.http_headers["Referer"],
            "https://example.test/watch",
        )
        self.assertIsNone(result.transfer_plan.video)

    @patch("download.subprocess.run")
    def test_probe_builds_separate_transfer_plan(self, run_mock) -> None:
        video = _format(
            "video.webm",
            ext="webm",
            vcodec="vp9",
            acodec="none",
        )
        audio = _format(
            "audio.m4a",
            ext="m4a",
            vcodec="none",
            acodec="mp4a",
        )
        run_mock.return_value = SimpleNamespace(
            returncode=0,
            stdout=json.dumps(
                {
                    "title": "Separate",
                    "requested_formats": [audio, video],
                }
            ),
            stderr="",
        )

        result = download.probe("https://example.test/watch/2")

        self.assertIsNotNone(result.transfer_plan)
        self.assertEqual(result.transfer_plan.video.url, video["url"])
        self.assertEqual(result.transfer_plan.audio.url, audio["url"])
        self.assertIsNone(result.transfer_plan.progressive)

    @patch("download.subprocess.run")
    def test_probe_rejects_segmented_or_incomplete_transfer_formats(
        self, run_mock
    ) -> None:
        cases = {
            "m3u8": {
                "title": "HLS",
                **_format(
                    "playlist.m3u8",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                    protocol="m3u8_native",
                ),
            },
            "dash": {
                "title": "DASH",
                **_format(
                    "manifest",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                    protocol="http_dash_segments",
                ),
            },
            "incomplete-separate": {
                "title": "Incomplete",
                "requested_formats": [
                    _format(
                        "video.mp4",
                        ext="mp4",
                        vcodec="avc1",
                        acodec="none",
                    )
                ],
            },
            "ambiguous-separate": {
                "title": "Ambiguous",
                "requested_formats": [
                    _format(
                        "combined.mp4",
                        ext="mp4",
                        vcodec="avc1",
                        acodec="mp4a",
                    ),
                    _format(
                        "audio.m4a",
                        ext="m4a",
                        vcodec="none",
                        acodec="mp4a",
                    ),
                ],
            },
        }
        for name, info in cases.items():
            with self.subTest(name=name):
                run_mock.return_value = SimpleNamespace(
                    returncode=0,
                    stdout=json.dumps(info),
                    stderr="",
                )
                result = download.probe(f"https://example.test/{name}")
                self.assertIsNone(result.transfer_plan)

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

    def test_subtitle_selection_matches_requested_regional_language_to_base(self) -> None:
        info = {
            "subtitles": {"en": [{"url": "manual"}]},
            "automatic_captions": {"de": [{"url": "auto"}]},
        }

        self.assertEqual(
            download._select_subtitle_track(info, "en-US"),
            ("en", False),
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

    @patch("download.subprocess.run")
    def test_download_caps_video_height_with_fallback(self, run_mock) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            metadata = download.VideoMetadata(
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )

            def fake_run(command, **kwargs):
                if command[0] == "yt-dlp":
                    (work / "source.mp4").write_bytes(b"video")
                else:
                    Path(command[-1]).write_bytes(b"RIFF" + (b"0" * 64))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            run_mock.side_effect = fake_run
            download.download("https://example.test/course", work, metadata=metadata)

        yt_dlp_command = run_mock.call_args_list[0].args[0]
        selected_format = yt_dlp_command[yt_dlp_command.index("-f") + 1]
        self.assertIn("height<=1080", selected_format)
        self.assertTrue(selected_format.endswith("/b"))

    @patch("download.subprocess.run")
    def test_download_recognizes_declared_video_extensions(self, run_mock) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            metadata = download.VideoMetadata(
                title="Legacy video",
                duration=10,
                webpage_url="https://example.test/legacy",
                description="",
                uploader="Teacher",
            )

            def fake_run(command, **kwargs):
                if command[0] == "yt-dlp":
                    (work / "source.avi").write_bytes(b"video")
                else:
                    Path(command[-1]).write_bytes(b"RIFF" + (b"0" * 64))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            run_mock.side_effect = fake_run
            result = download.download(
                "https://example.test/legacy",
                work,
                metadata=metadata,
            )

        self.assertEqual(result.video_path.name, "source.avi")
        self.assertEqual(result.audio_path.name, "audio.wav")

    @patch("download.fast_download.download_http")
    @patch("download.subprocess.run")
    def test_fast_progressive_success_extracts_wav_without_yt_dlp(
        self, run_mock, fast_mock
    ) -> None:
        plan = download.MediaTransferPlan(
            progressive=download._media_part(
                _format(
                    "combined.mp4",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                    headers={"User-Agent": "test-agent"},
                )
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)

            def fake_fast(url, destination, **kwargs):
                Path(destination).write_bytes(b"progressive media")
                return SimpleNamespace(destination=Path(destination))

            def fake_run(command, **kwargs):
                self.assertEqual(command[0], "ffmpeg")
                Path(command[-1]).write_bytes(b"RIFF" + (b"0" * 64))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            fast_mock.side_effect = fake_fast
            run_mock.side_effect = fake_run
            result = download.download(
                "https://example.test/course",
                work,
                metadata=_metadata_with_plan(plan),
            )
            info = json.loads((work / "info.json").read_text(encoding="utf-8"))

            self.assertEqual(result.video_path, work / "source.mp4")
            self.assertTrue(result.audio_path.is_file())
            self.assertEqual(info["download_backend"], "range")
            self.assertNotIn("transfer_plan", info)
            self.assertNotIn("https://cdn.example.test", json.dumps(info))
            self.assertEqual(fast_mock.call_count, 1)
            self.assertEqual(
                fast_mock.call_args.kwargs["headers"]["User-Agent"],
                "test-agent",
            )
            self.assertFalse(
                any(call.args[0][0] == "yt-dlp" for call in run_mock.call_args_list)
            )
            self.assertFalse(
                any(path.name.startswith(".fast-download-") for path in work.iterdir())
            )

    @patch("download.fast_download.download_http")
    @patch("download.subprocess.run")
    def test_fast_separate_downloads_and_ffmpeg_merges(
        self, run_mock, fast_mock
    ) -> None:
        plan = download.MediaTransferPlan(
            video=download._media_part(
                _format(
                    "video.webm",
                    ext="webm",
                    vcodec="vp9",
                    acodec="none",
                )
            ),
            audio=download._media_part(
                _format(
                    "audio.m4a",
                    ext="m4a",
                    vcodec="none",
                    acodec="mp4a",
                )
            ),
        )
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)

            def fake_fast(url, destination, **kwargs):
                Path(destination).write_bytes(url.encode("utf-8"))
                return SimpleNamespace(destination=Path(destination))

            def fake_run(command, **kwargs):
                if command[0] == "ffmpeg" and "copy" in command:
                    Path(command[-1]).write_bytes(b"merged")
                elif command[0] == "ffmpeg":
                    Path(command[-1]).write_bytes(b"RIFF" + (b"0" * 64))
                else:
                    self.fail(f"unexpected command: {command}")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            fast_mock.side_effect = fake_fast
            run_mock.side_effect = fake_run
            result = download.download(
                "https://example.test/course",
                work,
                metadata=_metadata_with_plan(plan),
            )

            self.assertEqual(fast_mock.call_count, 2)
            self.assertEqual(result.video_path, work / "source.mp4")
            merge_command = run_mock.call_args_list[0].args[0]
            self.assertEqual(merge_command[0], "ffmpeg")
            self.assertIn("-c", merge_command)
            self.assertEqual(merge_command[merge_command.index("-c") + 1], "copy")
            self.assertTrue(str(merge_command[-1]).startswith(str(work)))
            self.assertTrue(Path(merge_command[-1]).name.startswith(".fast-download-"))
            self.assertFalse(
                any(path.name.startswith(".fast-download-") for path in work.iterdir())
            )

    @patch("download.fast_download.download_http")
    @patch("download.subprocess.run")
    def test_fast_success_runs_subtitle_only_command(
        self, run_mock, fast_mock
    ) -> None:
        plan = download.MediaTransferPlan(
            progressive=download._media_part(
                _format(
                    "combined.mp4",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                )
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)

            def fake_fast(url, destination, **kwargs):
                Path(destination).write_bytes(b"media")
                return SimpleNamespace(destination=Path(destination))

            def fake_run(command, **kwargs):
                if command[0] == "yt-dlp":
                    (work / "source.en.vtt").write_text("WEBVTT", encoding="utf-8")
                else:
                    Path(command[-1]).write_bytes(b"RIFF" + (b"0" * 64))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            fast_mock.side_effect = fake_fast
            run_mock.side_effect = fake_run
            result = download.download(
                "https://example.test/course",
                work,
                metadata=_metadata_with_plan(plan, subtitle_language="en"),
            )

            yt_commands = [
                call.args[0]
                for call in run_mock.call_args_list
                if call.args[0][0] == "yt-dlp"
            ]
            self.assertEqual(len(yt_commands), 1)
            self.assertIn("--skip-download", yt_commands[0])
            self.assertIn("--write-subs", yt_commands[0])
            self.assertIn("--sub-langs", yt_commands[0])
            self.assertNotIn("--write-info-json", yt_commands[0])
            self.assertEqual(result.subtitle_path, work / "source.en.vtt")

    @patch("download.fast_download.download_http")
    @patch("download.subprocess.run")
    def test_fast_failure_cleans_only_fast_artifacts_and_falls_back(
        self, run_mock, fast_mock
    ) -> None:
        plan = download.MediaTransferPlan(
            progressive=download._media_part(
                _format(
                    "combined.mp4",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                )
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            old_file = work / "keep.txt"
            old_file.write_text("keep", encoding="utf-8")

            def fake_fast(url, destination, **kwargs):
                Path(destination).write_bytes(b"partial")
                raise RuntimeError("range failed")

            def fake_run(command, **kwargs):
                if command[0] == "yt-dlp":
                    (work / "source.webm").write_bytes(b"fallback")
                    return SimpleNamespace(
                        returncode=0,
                        stdout=str(work / "source.webm") + "\n",
                        stderr="",
                    )
                Path(command[-1]).write_bytes(b"RIFF" + (b"0" * 64))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            fast_mock.side_effect = fake_fast
            run_mock.side_effect = fake_run
            result = download.download(
                "https://example.test/course",
                work,
                metadata=_metadata_with_plan(plan),
            )
            info = json.loads((work / "info.json").read_text(encoding="utf-8"))

            self.assertEqual(result.video_path, work / "source.webm")
            self.assertEqual(info["download_backend"], "yt-dlp")
            self.assertEqual(old_file.read_text(encoding="utf-8"), "keep")
            self.assertFalse(
                any(path.name.startswith(".fast-download-") for path in work.iterdir())
            )
            yt_command = run_mock.call_args_list[0].args[0]
            self.assertIn("--write-info-json", yt_command)
            self.assertIn("--concurrent-fragments", yt_command)

    @patch("download.fast_download.download_http")
    @patch("download.subprocess.run")
    def test_fast_subtitle_failure_cleans_media_and_falls_back(
        self, run_mock, fast_mock
    ) -> None:
        plan = download.MediaTransferPlan(
            progressive=download._media_part(
                _format(
                    "combined.mp4",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                )
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)

            def fake_fast(url, destination, **kwargs):
                Path(destination).write_bytes(b"fast media")
                return SimpleNamespace(destination=Path(destination))

            yt_calls = 0

            def fake_run(command, **kwargs):
                nonlocal yt_calls
                if command[0] == "yt-dlp":
                    yt_calls += 1
                    if "--skip-download" in command:
                        (work / "source.en.vtt").write_text(
                            "partial subtitle", encoding="utf-8"
                        )
                        return SimpleNamespace(returncode=1, stdout="", stderr="sub failed")
                    self.assertFalse((work / "source.en.vtt").exists())
                    (work / "source.mp4").write_bytes(b"fallback media")
                    (work / "source.en.vtt").write_text("WEBVTT", encoding="utf-8")
                    return SimpleNamespace(returncode=0, stdout="", stderr="")
                Path(command[-1]).write_bytes(b"RIFF" + (b"0" * 64))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            fast_mock.side_effect = fake_fast
            run_mock.side_effect = fake_run
            result = download.download(
                "https://example.test/course",
                work,
                metadata=_metadata_with_plan(plan, subtitle_language="en"),
            )

            self.assertEqual(yt_calls, 2)
            self.assertEqual(result.video_path.read_bytes(), b"fallback media")
            self.assertFalse(
                any(path.name.startswith(".fast-download-") for path in work.iterdir())
            )

    @patch("download.fast_download.download_http")
    @patch("download.subprocess.run")
    def test_fast_cancellation_is_not_fallback(self, run_mock, fast_mock) -> None:
        plan = download.MediaTransferPlan(
            progressive=download._media_part(
                _format(
                    "combined.mp4",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                )
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)

            def cancelled(url, destination, **kwargs):
                Path(destination).write_bytes(b"partial")
                raise CancellationRequested("任务已取消")

            fast_mock.side_effect = cancelled
            with self.assertRaises(CancellationRequested):
                download.download(
                    "https://example.test/course",
                    work,
                    metadata=_metadata_with_plan(plan),
                )

            run_mock.assert_not_called()
            self.assertFalse(any(work.iterdir()))

    @patch("download.fast_download.download_http")
    @patch("download.subprocess.run")
    def test_cookie_download_never_uses_fast_layer(self, run_mock, fast_mock) -> None:
        plan = download.MediaTransferPlan(
            progressive=download._media_part(
                _format(
                    "combined.mp4",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                )
            )
        )
        for cookie_kind in ("browser", "file"):
            with self.subTest(cookie_kind=cookie_kind):
                with tempfile.TemporaryDirectory() as tmp:
                    work = Path(tmp)
                    cookie_file = work / "cookies.txt"
                    cookie_file.write_text("", encoding="utf-8")
                    run_mock.reset_mock()
                    fast_mock.reset_mock()

                    def fake_run(command, **kwargs):
                        if command[0] == "yt-dlp":
                            (work / "source.mp4").write_bytes(b"cookie media")
                        else:
                            Path(command[-1]).write_bytes(
                                b"RIFF" + (b"0" * 64)
                            )
                        return SimpleNamespace(
                            returncode=0,
                            stdout="",
                            stderr="",
                        )

                    run_mock.side_effect = fake_run
                    cookie_kwargs = (
                        {"cookies_from_browser": "chrome"}
                        if cookie_kind == "browser"
                        else {"cookies_file": cookie_file}
                    )
                    download.download(
                        "https://example.test/course",
                        work,
                        metadata=_metadata_with_plan(plan),
                        **cookie_kwargs,
                    )

                    fast_mock.assert_not_called()
                    yt_command = run_mock.call_args_list[0].args[0]
                    expected_arg = (
                        "--cookies-from-browser"
                        if cookie_kind == "browser"
                        else "--cookies"
                    )
                    self.assertIn(expected_arg, yt_command)
                    self.assertNotIn("--skip-download", yt_command)

    @patch("download.fast_download.download_http")
    @patch("download.subprocess.run")
    def test_wav_extraction_failure_does_not_redownload(
        self, run_mock, fast_mock
    ) -> None:
        plan = download.MediaTransferPlan(
            progressive=download._media_part(
                _format(
                    "combined.mp4",
                    ext="mp4",
                    vcodec="avc1",
                    acodec="mp4a",
                )
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)

            def fake_fast(url, destination, **kwargs):
                Path(destination).write_bytes(b"media")
                return SimpleNamespace(destination=Path(destination))

            fast_mock.side_effect = fake_fast
            run_mock.return_value = SimpleNamespace(
                returncode=1,
                stdout="",
                stderr="extract failed",
            )
            with self.assertRaisesRegex(RuntimeError, "提取音频失败"):
                download.download(
                    "https://example.test/course",
                    work,
                    metadata=_metadata_with_plan(plan),
                )

            self.assertEqual(fast_mock.call_count, 1)
            self.assertEqual(run_mock.call_count, 1)
            self.assertEqual(run_mock.call_args.args[0][0], "ffmpeg")


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
