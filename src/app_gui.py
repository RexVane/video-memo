"""Desktop GUI for video link -> listen + watch -> AI summary."""

from __future__ import annotations

import argparse
import os
import queue
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from tkinter import filedialog

import customtkinter as ctk

SRC_DIR = Path(__file__).resolve().parent
ROOT_DIR = SRC_DIR.parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from download import AUDIO_EXTS, MEDIA_EXTS, VIDEO_EXTS  # noqa: E402
from llm_config import (  # noqa: E402
    DEFAULT_BASE_URL,
    LLMConfig,
    default_model,
    resolve_llm_config,
)
from pipeline import regenerate_report, run  # noqa: E402

OUTPUT_DIR = ROOT_DIR / "output"
WHISPER_CHOICES = ["tiny", "base", "small", "medium", "large-v3"]
LANG_CHOICES = ["自动检测", "zh", "en", "ja", "ko", "fr", "de", "es"]
COOKIE_CHOICES = ["不使用", "chrome", "edge", "firefox", "brave"]
FRAME_CHOICES = ["0", "4", "6", "8", "12"]
# Common vision-capable models; the combo box also accepts custom names.
LLM_MODELS = [
    "grok-4.5",
    "grok-4.20-0309-reasoning",
    "grok-4.20-0309-non-reasoning",
    "grok-4.3",
    "grok-4-1-fast-reasoning",
    "grok-4-1-fast-non-reasoning",
    "grok-4-fast-reasoning",
    "grok-2-vision-1212",
]
LLM_DEFAULT = default_model()


class VideoMemoApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("VideoMemo — 视频学习笔记")
        self.geometry("920x850")
        self.minsize(800, 680)

        ctk.set_appearance_mode("System")
        ctk.set_default_color_theme("blue")

        self._msg_q: queue.Queue = queue.Queue()
        self._worker: threading.Thread | None = None
        self._cancel_event: threading.Event | None = None
        self._last_summary_path: Path | None = None
        self._busy = False
        self._closing = False
        self._close_deadline: float | None = None
        self._log_lines = 0
        try:
            self._initial_llm_config: LLMConfig | None = resolve_llm_config(LLM_DEFAULT)
        except (RuntimeError, ValueError):
            self._initial_llm_config = None
        self._initial_api_base_url = (
            self._initial_llm_config.base_url
            if self._initial_llm_config
            else DEFAULT_BASE_URL
        )

        self.url_var = ctk.StringVar()
        self.whisper_var = ctk.StringVar(value="base")
        self.lang_var = ctk.StringVar(value="自动检测")
        self.cookie_var = ctk.StringVar(value="不使用")
        self.frames_var = ctk.StringVar(value="8")
        self.no_vision_var = ctk.BooleanVar(value=False)
        self.cleanup_media_var = ctk.BooleanVar(value=False)
        self.llm_var = ctk.StringVar(value=LLM_DEFAULT)
        self.api_base_url_var = ctk.StringVar(value=self._initial_api_base_url)
        self.api_key_var = ctk.StringVar()
        self.obsidian_vault_var = ctk.StringVar()
        self.status_var = ctk.StringVar(value="就绪。粘贴链接或选择本地文件后点击「开始总结」。")

        self._build_ui()
        self.after(100, self._drain_queue)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _option_cell(self, parent, row: int, col: int, title: str, variable, values: list[str]) -> None:
        frame = ctk.CTkFrame(parent, fg_color="transparent")
        frame.grid(row=row, column=col, sticky="ew", padx=12, pady=10)
        ctk.CTkLabel(frame, text=title, anchor="w").pack(anchor="w")
        ctk.CTkOptionMenu(frame, variable=variable, values=values).pack(fill="x", pady=(4, 0))

    def _build_ui(self) -> None:
        pad = {"padx": 16, "pady": 8}

        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", **pad)
        ctk.CTkLabel(
            header,
            text="VideoMemo",
            font=ctk.CTkFont(size=22, weight="bold"),
        ).pack(anchor="w")
        ctk.CTkLabel(
            header,
            text="粘贴视频链接，或选择本地视频/录音 → 听写 → 看关键帧 → AI 中文总结",
            text_color=("gray40", "gray70"),
        ).pack(anchor="w")

        url_row = ctk.CTkFrame(self)
        url_row.pack(fill="x", **pad)
        ctk.CTkLabel(url_row, text="链接/文件", width=80, anchor="w").pack(
            side="left", padx=(12, 8), pady=12
        )
        self.url_entry = ctk.CTkEntry(
            url_row,
            textvariable=self.url_var,
            placeholder_text="视频链接（YouTube / B站 等），或本地视频、录音文件路径",
            height=36,
        )
        self.url_entry.pack(side="left", fill="x", expand=True, padx=(0, 8), pady=12)
        ctk.CTkButton(
            url_row,
            text="选择文件…",
            width=96,
            height=36,
            fg_color=("gray70", "gray35"),
            command=self._pick_local_file,
        ).pack(side="left", padx=(0, 12), pady=12)

        opts = ctk.CTkFrame(self)
        opts.pack(fill="x", **pad)
        opts.columnconfigure((0, 1, 2, 3), weight=1)

        self._option_cell(opts, 0, 0, "Whisper 精度", self.whisper_var, WHISPER_CHOICES)
        self._option_cell(opts, 0, 1, "语音语言", self.lang_var, LANG_CHOICES)
        self._option_cell(
            opts,
            0,
            2,
            "浏览器 Cookie（登录视频才需要）",
            self.cookie_var,
            COOKIE_CHOICES,
        )
        self._option_cell(opts, 0, 3, "关键帧数量", self.frames_var, FRAME_CHOICES)

        f4 = ctk.CTkFrame(opts, fg_color="transparent")
        f4.grid(row=1, column=0, columnspan=2, sticky="ew", padx=12, pady=(0, 10))
        ctk.CTkLabel(f4, text="AI 模型（可输入）", anchor="w").pack(anchor="w")
        ctk.CTkComboBox(f4, variable=self.llm_var, values=LLM_MODELS).pack(
            fill="x", pady=(4, 0)
        )

        f5 = ctk.CTkFrame(opts, fg_color="transparent")
        f5.grid(row=1, column=2, columnspan=2, sticky="ew", padx=12, pady=(0, 10))
        ctk.CTkCheckBox(
            f5,
            text="只听不看（不传截图，更快更省）",
            variable=self.no_vision_var,
        ).pack(anchor="w", pady=(8, 0))
        ctk.CTkCheckBox(
            f5,
            text="完成后删除下载媒体和音轨",
            variable=self.cleanup_media_var,
        ).pack(anchor="w", pady=(8, 0))

        api_url_frame = ctk.CTkFrame(opts, fg_color="transparent")
        api_url_frame.grid(
            row=2,
            column=0,
            columnspan=2,
            sticky="ew",
            padx=12,
            pady=(0, 10),
        )
        ctk.CTkLabel(api_url_frame, text="OpenAI 兼容 Base URL", anchor="w").pack(anchor="w")
        ctk.CTkEntry(
            api_url_frame,
            textvariable=self.api_base_url_var,
            placeholder_text="https://api.example.com/v1",
        ).pack(fill="x", pady=(4, 0))

        api_key_frame = ctk.CTkFrame(opts, fg_color="transparent")
        api_key_frame.grid(
            row=2,
            column=2,
            columnspan=2,
            sticky="ew",
            padx=12,
            pady=(0, 10),
        )
        ctk.CTkLabel(api_key_frame, text="API Key（留空则自动读取）", anchor="w").pack(
            anchor="w"
        )
        ctk.CTkEntry(
            api_key_frame,
            textvariable=self.api_key_var,
            show="*",
            placeholder_text="环境变量 / .env / 本机 Grok 配置",
        ).pack(fill="x", pady=(4, 0))

        vault_frame = ctk.CTkFrame(opts, fg_color="transparent")
        vault_frame.grid(
            row=3,
            column=0,
            columnspan=4,
            sticky="ew",
            padx=12,
            pady=(0, 10),
        )
        ctk.CTkLabel(vault_frame, text="Obsidian Vault（可选）", anchor="w").pack(
            anchor="w"
        )
        vault_input = ctk.CTkFrame(vault_frame, fg_color="transparent")
        vault_input.pack(fill="x", pady=(4, 0))
        ctk.CTkEntry(
            vault_input,
            textvariable=self.obsidian_vault_var,
            placeholder_text="选择 Vault 后，笔记会导出到 Video Memos",
        ).pack(side="left", fill="x", expand=True)
        ctk.CTkButton(
            vault_input,
            text="选择…",
            width=80,
            fg_color=("gray70", "gray35"),
            command=self._pick_obsidian_vault,
        ).pack(side="left", padx=(8, 0))

        config_ok = self._initial_llm_config is not None
        if self._initial_llm_config and self._initial_llm_config.source.startswith("Grok CLI"):
            config_text = "已读取本机 Grok CLI API 配置"
        elif self._initial_llm_config:
            config_text = f"API 配置已就绪: {self._initial_llm_config.source}"
        else:
            config_text = "未检测到 API Key，请填写或配置环境变量 / .env"
        config_color = ("#1a7f37", "#3fb950") if config_ok else ("#b42318", "#f85149")
        ctk.CTkLabel(self, text=config_text, text_color=config_color, anchor="w").pack(
            fill="x", padx=20
        )

        actions = ctk.CTkFrame(self, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=8)
        self.start_btn = ctk.CTkButton(
            actions, text="开始总结", height=40, width=140, command=self._on_start
        )
        self.start_btn.pack(side="left")
        self.regenerate_btn = ctk.CTkButton(
            actions,
            text="重新生成",
            height=40,
            width=110,
            fg_color=("gray70", "gray35"),
            command=self._on_regenerate,
        )
        self.regenerate_btn.pack(side="left", padx=(10, 0))
        self.cancel_btn = ctk.CTkButton(
            actions,
            text="取消任务",
            height=40,
            width=100,
            fg_color=("#b42318", "#da3633"),
            hover_color=("#8f1d14", "#b62324"),
            command=self._cancel_current_task,
            state="disabled",
        )
        self.cancel_btn.pack(side="left", padx=(10, 0))
        ctk.CTkButton(
            actions,
            text="打开结果文件夹",
            height=40,
            width=140,
            fg_color=("gray70", "gray35"),
            command=self._open_output,
        ).pack(side="left", padx=(10, 0))
        self.copy_btn = ctk.CTkButton(
            actions,
            text="复制总结",
            height=40,
            width=100,
            fg_color=("gray70", "gray35"),
            command=self._copy_summary,
            state="disabled",
        )
        self.copy_btn.pack(side="left", padx=(10, 0))
        ctk.CTkLabel(actions, textvariable=self.status_var, anchor="e").pack(
            side="right", fill="x", expand=True, padx=(12, 0)
        )

        self.progress = ctk.CTkProgressBar(self)
        self.progress.pack(fill="x", padx=16, pady=(0, 8))
        self.progress.set(0)

        tabs = ctk.CTkTabview(self)
        tabs.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        tab_sum = tabs.add("总结")
        tab_log = tabs.add("运行日志")

        self.summary_box = ctk.CTkTextbox(tab_sum, wrap="word", font=ctk.CTkFont(size=14))
        self.summary_box.pack(fill="both", expand=True, padx=4, pady=4)
        self.summary_box.insert("1.0", "总结结果会显示在这里。\n")
        self.summary_box.configure(state="disabled")

        self.log_box = ctk.CTkTextbox(tab_log, wrap="word", font=ctk.CTkFont(family="Consolas", size=12))
        self.log_box.pack(fill="both", expand=True, padx=4, pady=4)
        self._log("桌面程序已启动。")

    def _log(self, text: str) -> None:
        lines = (text if text.endswith("\n") else text + "\n").count("\n")
        self.log_box.insert("end", text if text.endswith("\n") else text + "\n")
        self._log_lines += lines
        # Tk text widgets slow down sharply with unbounded content. Keep the
        # newest 2,000 lines, which is ample for diagnosis even on long runs.
        if self._log_lines > 2_000:
            drop = self._log_lines - 2_000
            self.log_box.delete("1.0", f"{drop + 1}.0")
            self._log_lines = 2_000
        self.log_box.see("end")

    def _set_summary(self, text: str) -> None:
        self.summary_box.configure(state="normal")
        self.summary_box.delete("1.0", "end")
        self.summary_box.insert("1.0", text)
        self.summary_box.configure(state="disabled")

    def _pick_local_file(self) -> None:
        if self._busy:
            return
        video_pattern = " ".join(f"*{ext}" for ext in sorted(VIDEO_EXTS))
        audio_pattern = " ".join(f"*{ext}" for ext in sorted(AUDIO_EXTS))
        media_pattern = " ".join(f"*{ext}" for ext in sorted(MEDIA_EXTS))
        path = filedialog.askopenfilename(
            title="选择本地视频或录音文件",
            filetypes=[
                ("音视频文件", media_pattern),
                ("视频文件", video_pattern),
                ("音频/录音", audio_pattern),
                ("所有文件", "*.*"),
            ],
        )
        if path:
            self.url_var.set(path)
            self.status_var.set("已选择本地文件，点击「开始总结」。")

    def _pick_obsidian_vault(self) -> None:
        if self._busy:
            return
        selected = filedialog.askdirectory(title="选择 Obsidian Vault")
        if selected:
            self.obsidian_vault_var.set(selected)

    def _on_start(self) -> None:
        if self._busy:
            return
        url = self.url_var.get().strip()
        if not url:
            self.status_var.set("请先粘贴视频链接或选择本地文件。")
            return
        whisper_model = self.whisper_var.get()
        llm_model = self.llm_var.get().strip() or LLM_DEFAULT
        entered_api_key = self.api_key_var.get().strip() or None
        entered_base_url = self.api_base_url_var.get().strip()
        base_url_changed = entered_base_url != self._initial_api_base_url
        try:
            llm_config = resolve_llm_config(
                llm_model,
                api_key=entered_api_key,
                base_url=entered_base_url if entered_api_key or base_url_changed else None,
            )
        except (RuntimeError, ValueError) as exc:
            self.status_var.set(str(exc))
            return
        lang = self.lang_var.get()
        language = None if lang == "自动检测" else lang
        cookie = self.cookie_var.get()
        cookies_from_browser = None if cookie == "不使用" else cookie
        max_frames = int(self.frames_var.get() or "8")
        no_vision = bool(self.no_vision_var.get()) or max_frames == 0
        cleanup_media = bool(self.cleanup_media_var.get())
        obsidian_text = self.obsidian_vault_var.get().strip()
        obsidian_vault = Path(obsidian_text) if obsidian_text else None
        if max_frames == 0:
            max_frames = 8

        self._busy = True
        cancel_event = threading.Event()
        self._cancel_event = cancel_event
        self.start_btn.configure(state="disabled", text="处理中…")
        self.regenerate_btn.configure(state="disabled")
        self.cancel_btn.configure(state="normal", text="取消任务")
        self.copy_btn.configure(state="disabled")
        self.progress.set(0.02)
        self.status_var.set("处理中…")
        self._set_summary("正在处理，请稍候…\n首次使用 Whisper 会下载模型，可能稍慢。")
        self._log(
            f"\n—— 开始 ——\nURL: {url}\n"
            f"模型: {llm_model}\nAPI: {llm_config.base_url}"
        )

        def worker() -> None:
            try:

                def on_progress(msg: str, pct: float) -> None:
                    self._msg_q.put(("progress", msg, pct))

                path = run(
                    url,
                    out_root=OUTPUT_DIR,
                    whisper_model=whisper_model,
                    language=language,
                    max_frames=max_frames,
                    no_vision=no_vision,
                    llm_model=llm_model,
                    api_key=llm_config.api_key,
                    api_base_url=llm_config.base_url,
                    cookies_from_browser=cookies_from_browser,
                    cleanup_media=cleanup_media,
                    obsidian_vault=obsidian_vault,
                    on_progress=on_progress,
                    cancel_event=cancel_event,
                )
                text = path.read_text(encoding="utf-8")
                self._msg_q.put(("done", path, text))
            except Exception as e:
                self._msg_q.put(("error", str(e), traceback.format_exc()))

        self._worker = threading.Thread(target=worker, daemon=True)
        self._worker.start()

    def _on_regenerate(self) -> None:
        if self._busy:
            return
        if self._last_summary_path:
            work_dir = self._last_summary_path.parent
        else:
            selected = filedialog.askdirectory(
                title="选择包含 transcript.txt 和 info.json 的运行目录",
                initialdir=OUTPUT_DIR,
            )
            if not selected:
                return
            work_dir = Path(selected)

        llm_model = self.llm_var.get().strip() or LLM_DEFAULT
        obsidian_text = self.obsidian_vault_var.get().strip()
        obsidian_vault = Path(obsidian_text) if obsidian_text else None
        entered_api_key = self.api_key_var.get().strip() or None
        entered_base_url = self.api_base_url_var.get().strip()
        base_url_changed = entered_base_url != self._initial_api_base_url
        try:
            llm_config = resolve_llm_config(
                llm_model,
                api_key=entered_api_key,
                base_url=entered_base_url if entered_api_key or base_url_changed else None,
            )
        except (RuntimeError, ValueError) as exc:
            self.status_var.set(str(exc))
            return

        self._busy = True
        cancel_event = threading.Event()
        self._cancel_event = cancel_event
        self.start_btn.configure(state="disabled")
        self.regenerate_btn.configure(state="disabled", text="生成中…")
        self.cancel_btn.configure(state="normal", text="取消任务")
        self.copy_btn.configure(state="disabled")
        self.progress.set(0.02)
        self.status_var.set("正在重新生成报告…")
        self._log(f"\n—— 重新生成 ——\n运行目录: {work_dir}")

        def worker() -> None:
            try:
                path = regenerate_report(
                    work_dir,
                    llm_model=llm_model,
                    api_key=llm_config.api_key,
                    api_base_url=llm_config.base_url,
                    obsidian_vault=obsidian_vault,
                    on_progress=lambda msg, pct: self._msg_q.put(
                        ("progress", msg, pct)
                    ),
                    cancel_event=cancel_event,
                )
                text = path.read_text(encoding="utf-8")
                self._msg_q.put(("done", path, text))
            except Exception as exc:
                self._msg_q.put(("error", str(exc), traceback.format_exc()))

        self._worker = threading.Thread(target=worker, daemon=True)
        self._worker.start()

    def _drain_queue(self) -> None:
        try:
            while True:
                try:
                    item = self._msg_q.get_nowait()
                except queue.Empty:
                    break
                kind = item[0]
                if kind == "progress":
                    _, msg, pct = item
                    self._log(msg)
                    try:
                        self.progress.set(max(0.0, min(1.0, float(pct))))
                    except (TypeError, ValueError):
                        pass
                    line = msg.strip().splitlines()[-1] if msg.strip() else ""
                    if line:
                        self.status_var.set(line[:80])
                elif kind == "done":
                    _, path, text = item
                    self._last_summary_path = path
                    self._set_summary(text)
                    self.progress.set(1.0)
                    self.status_var.set(f"完成：{path}")
                    self._log(f"完成: {path}")
                    self._busy = False
                    self._cancel_event = None
                    self.start_btn.configure(state="normal", text="开始总结")
                    self.regenerate_btn.configure(state="normal", text="重新生成")
                    self.cancel_btn.configure(state="disabled", text="取消任务")
                    self.copy_btn.configure(state="normal")
                elif kind == "error":
                    _, err, tb = item
                    self._set_summary(f"出错了：\n\n{err}\n")
                    self._log(tb or err)
                    self.progress.set(0)
                    self.status_var.set(
                        "已取消"
                        if (self._closing or self._cancel_event) and "已取消" in err
                        else "失败，请看「运行日志」或总结页错误信息"
                    )
                    self._busy = False
                    self._cancel_event = None
                    self.start_btn.configure(state="normal", text="开始总结")
                    self.regenerate_btn.configure(state="normal", text="重新生成")
                    self.cancel_btn.configure(state="disabled", text="取消任务")
                    self.copy_btn.configure(state="normal")
        except Exception as error:
            # A destroyed widget or malformed queue item must not kill the only
            # Tk `after` pump and freeze all future status updates.
            try:
                self.status_var.set(f"界面更新失败: {error}")
            except Exception:
                return
        if self._closing and not self._worker_alive():
            self.destroy()
            return
        try:
            self.after(120, self._drain_queue)
        except Exception:
            pass

    def _open_output(self) -> None:
        target = self._last_summary_path.parent if self._last_summary_path else OUTPUT_DIR
        target.mkdir(parents=True, exist_ok=True)
        try:
            if sys.platform == "win32":
                os.startfile(str(target))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.run(["open", str(target)], check=False)
            else:
                subprocess.run(["xdg-open", str(target)], check=False)
        except Exception as e:
            self.status_var.set(f"无法打开文件夹: {e}")

    def _copy_summary(self) -> None:
        text = self.summary_box.get("1.0", "end").strip()
        if not text:
            return
        self.clipboard_clear()
        self.clipboard_append(text)
        self.status_var.set("已复制总结到剪贴板")

    def _cancel_current_task(self) -> None:
        if not self._busy or self._cancel_event is None:
            return
        self._cancel_event.set()
        self.cancel_btn.configure(state="disabled", text="取消中…")
        self.status_var.set("正在取消任务；当前网络请求或模型分块结束后退出…")
        self._log("用户请求取消任务。")

    def _on_close(self) -> None:
        if not self._busy:
            self.destroy()
            return
        self._closing = True
        self._close_deadline = time.monotonic() + 5.0
        self._cancel_current_task()
        self.status_var.set("正在取消任务，等待后台进程退出…")
        self.start_btn.configure(state="disabled", text="取消中…")
        self.regenerate_btn.configure(state="disabled", text="取消中…")
        self.after(100, self._close_when_idle)

    def _worker_alive(self) -> bool:
        return self._worker is not None and self._worker.is_alive()

    def _close_when_idle(self) -> None:
        if not self._worker_alive():
            self.destroy()
            return
        # Model downloads and some native inference calls cannot be interrupted.
        # The worker is daemonized, so after a short grace period closing the GUI
        # is safer than trapping the user behind an unresponsive window.
        if self._close_deadline is not None and time.monotonic() >= self._close_deadline:
            self.destroy()
            return
        self.after(100, self._close_when_idle)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("url", nargs="?")
    parser.add_argument("--auto-start", action="store_true")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    app = VideoMemoApp()
    if args.url:
        app.url_var.set(args.url)
    if args.auto_start:
        app.after(300, app._on_start)
    app.mainloop()


if __name__ == "__main__":
    main()
