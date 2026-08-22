import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  FileSystemAdapter,
  Notice,
  Plugin,
  TFile,
  normalizePath,
} from "obsidian";

import { normalizeOpenAiBaseUrl, nodeSqliteSupported, resolveCcSwitchProviderRuntime } from "./ccswitch";
import { RunProgressModal, type TaskState } from "./run-progress";
import {
  activeCustomProvider,
  DEFAULT_SETTINGS,
  describeProviderSelection,
  normalizeSettings,
  sanitizeTargetFolder,
  type VideoMemoSettings,
} from "./settings";
import { VideoMemoSettingTab } from "./settings-tab";
import { TextPromptModal } from "./source-modal";

const EVENT_PREFIX = "@@VIDEOMEMO@@";
const MAX_LOG_LINES = 500;
const NOTE_OPEN_ATTEMPTS = 12;
const NOTE_OPEN_INTERVAL_MS = 250;

interface EngineEvent {
  type: "progress" | "artifact" | "result";
  message?: string;
  progress?: number;
  kind?: string;
  path?: string;
  summary_path?: string;
}

export default class VideoMemoPlugin extends Plugin {
  settings: VideoMemoSettings = DEFAULT_SETTINGS;
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private statusEl: HTMLElement | null = null;
  private stderrTail = "";
  private activeProviderSecret = "";
  private taskState: TaskState | null = null;
  private progressModal: RunProgressModal | null = null;

  async onload(): Promise<void> {
    const stored = (await this.loadData()) as Partial<VideoMemoSettings> | null;
    this.settings = normalizeSettings(stored);
    // The legacy default folder is gone: an empty target folder now means the
    // engine derives a topic folder from the video content itself. Migrate the
    // old default value once so existing installs get the new behavior too.
    if (this.settings.targetFolder === "Video Memos") {
      this.settings.targetFolder = "";
    }
    if (!stored || JSON.stringify(stored) !== JSON.stringify(this.settings)) {
      await this.saveData(this.settings);
    }
    // The cc-switch source reads its database through node:sqlite, which only
    // exists on Obsidian 1.9.10+ installs (Electron 35 / Node 22.13+). Instead
    // of failing every task with a database error on older runtimes, fall back
    // to the custom provider source once and tell the user why.
    if (this.settings.providerSource === "ccswitch" && !nodeSqliteSupported()) {
      this.settings.providerSource = "custom";
      await this.saveData(this.settings);
      new Notice(
        "VideoMemo：当前 Obsidian 运行时不支持 node:sqlite，无法读取 cc-switch 数据库。" +
          "已切换为自定义供应商；升级到 Obsidian 1.9.10 或更新版本的安装器后可改回 cc-switch。",
        10000,
      );
    }
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("video-memo-status");
    this.statusEl.setAttribute("aria-label", "点击查看任务进度");
    this.setStatus("VideoMemo: 就绪");
    this.registerDomEvent(this.statusEl, "click", () => this.openProgressModal());

    const settingTab = new VideoMemoSettingTab(this.app, this);
    this.addSettingTab(settingTab);

    this.addRibbonIcon("video", "总结视频或录音", () => this.openSourceModal());
    this.addCommand({
      id: "summarize-video-or-audio",
      name: "总结视频链接或本地音视频",
      callback: () => this.openSourceModal(),
    });
    this.addCommand({
      id: "regenerate-report",
      name: "从已有运行目录重新生成报告",
      callback: () => this.openRegenerateModal(),
    });
    this.addCommand({
      id: "cancel-active-task",
      name: "取消当前总结任务",
      checkCallback: (checking) => {
        if (!this.activeProcess) return false;
        if (!checking) this.cancelActiveTask();
        return true;
      },
    });
    this.addCommand({
      id: "open-settings",
      name: "打开插件设置",
      callback: () => {
        this.openPluginSettings();
        window.setTimeout(() => {
          settingTab.showHome();
          settingTab.display();
        }, 0);
      },
    });
    this.addCommand({
      id: "open-provider-settings",
      name: "打开供应商设置",
      callback: () => {
        this.openPluginSettings();
        window.setTimeout(() => {
          settingTab.showProviders();
          settingTab.display();
        }, 0);
      },
    });
  }

  onunload(): void {
    this.cancelActiveTask(false);
    this.progressModal?.close();
  }

  private openSourceModal(): void {
    new TextPromptModal(this.app, {
      title: "总结视频或录音",
      fieldName: "链接或本地文件路径",
      placeholder: "https://... 或 D:\\Media\\course.mp4",
      providerBadge: describeProviderSelection(this.settings),
      showMediaPicker: true,
      onOpenSettings: () => this.openPluginSettings(),
      onSubmit: (value) => this.startEngine([value]),
    }).open();
  }

  private openRegenerateModal(): void {
    new TextPromptModal(this.app, {
      title: "重新生成报告",
      fieldName: "运行目录",
      placeholder: "D:\\video-memo\\output\\20260717_...",
      providerBadge: describeProviderSelection(this.settings),
      onOpenSettings: () => this.openPluginSettings(),
      onSubmit: (value) => this.startEngine(["--regenerate", value]),
    }).open();
  }

  private vaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("VideoMemo 仅支持桌面文件系统 Vault");
      return null;
    }
    return adapter.getBasePath();
  }

  resolvePython(projectPath: string): string {
    const virtualEnvPython = join(
      projectPath,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    return existsSync(virtualEnvPython) ? virtualEnvPython : "python";
  }

  private openPluginSettings(): void {
    const app = this.app as typeof this.app & {
      setting: { open: () => void; openTabById: (id: string) => void };
    };
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  private redactProviderSecrets(value: string): string {
    let redacted = value;
    if (this.activeProviderSecret) {
      redacted = redacted.replaceAll(this.activeProviderSecret, "***");
    }
    return redacted
      .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1***")
      .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, "$1***");
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
    this.statusEl?.toggleClass("is-clickable", this.taskState !== null);
  }

  private openProgressModal(): void {
    if (!this.taskState || this.progressModal) return;
    const modal = new RunProgressModal(this.app, {
      state: this.taskState,
      onCancel: () => this.cancelActiveTask(),
      onOpenNote: () => void this.openGeneratedNote(),
      onClosed: () => {
        if (this.progressModal === modal) this.progressModal = null;
      },
    });
    this.progressModal = modal;
    modal.open();
  }

  private startEngine(sourceArgs: string[]): void {
    if (this.activeProcess) {
      new Notice("已有总结任务正在运行");
      this.openProgressModal();
      return;
    }
    const projectPath = this.settings.projectPath.trim();
    const pipelinePath = join(projectPath, "src", "pipeline.py");
    if (!projectPath || !existsSync(pipelinePath)) {
      new Notice("请先在插件设置中配置 VideoMemo 项目目录");
      return;
    }
    const vaultPath = this.vaultPath();
    if (!vaultPath) return;
    const sourceValue = sourceArgs[0] === "--regenerate" ? sourceArgs[1] : sourceArgs[0];
    if (!sourceValue || (sourceArgs[0] !== "--regenerate" && sourceValue.startsWith("-"))) {
      new Notice("输入不能以连字符开头，请选择有效 URL 或本地文件");
      return;
    }

    const engineEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: "1" };
    let selectedModel = this.settings.model.trim();
    let providerBaseUrl = "";
    let providerLabel = "供应商配置";
    this.activeProviderSecret = "";
    try {
      if (this.settings.providerSource === "ccswitch") {
        const runtime = resolveCcSwitchProviderRuntime({
          dbPath: this.settings.ccSwitchDbPath,
          appType: this.settings.ccSwitchAppType,
          followCurrent: this.settings.ccSwitchFollowCurrent,
          providerId: this.settings.ccSwitchProviderId,
        });
        providerBaseUrl = runtime.baseUrl;
        selectedModel = selectedModel || runtime.model || "";
        providerLabel = selectedModel
          ? `${runtime.name} · ${selectedModel}`
          : `${runtime.name} · 默认模型`;
        this.activeProviderSecret = runtime.apiKey;
        engineEnv.LLM_API_KEY = runtime.apiKey;
        engineEnv.LLM_BASE_URL = runtime.baseUrl;
        engineEnv.LLM_API_FORMAT = runtime.apiFormat || "chat_completions";
        if (!selectedModel) delete engineEnv.LLM_MODEL;
      } else if (this.settings.providerSource === "custom") {
        const provider = activeCustomProvider(this.settings);
        if (!provider) throw new Error("请先添加并选择一个自定义供应商");
        const name = provider.name.trim();
        const apiKey = provider.apiKey.trim();
        selectedModel = provider.model.trim();
        providerBaseUrl = normalizeOpenAiBaseUrl(provider.baseUrl);
        if (!name) throw new Error("请填写自定义供应商名称");
        if (!apiKey) throw new Error("请填写自定义供应商 API Key");
        if (!selectedModel) throw new Error("请选择自定义供应商模型");
        providerLabel = `自定义 · ${name} · ${selectedModel}`;
        this.activeProviderSecret = apiKey;
        engineEnv.LLM_API_KEY = apiKey;
        engineEnv.LLM_BASE_URL = providerBaseUrl;
        engineEnv.LLM_API_FORMAT = provider.apiFormat;
        delete engineEnv.LLM_MODEL;
      }
    } catch (error) {
      const message = this.redactProviderSecrets(
        error instanceof Error ? error.message : String(error),
      );
      new Notice(`无法使用所选供应商\n${message}`, 8000);
      this.openPluginSettings();
      return;
    }

    const args = [
      pipelinePath,
      ...sourceArgs,
      "--obsidian-vault",
      vaultPath,
      "--obsidian-folder",
      sanitizeTargetFolder(this.settings.targetFolder),
      "--json-progress",
    ];
    if (selectedModel) args.push("--llm-model", selectedModel);
    if (providerBaseUrl) args.push("--api-base-url", providerBaseUrl);
    const isRegenerate = sourceArgs[0] === "--regenerate";
    if (this.settings.cleanupMedia && !isRegenerate) {
      args.push("--cleanup-media");
    }

    this.progressModal?.close();
    this.stderrTail = "";
    this.taskState = {
      kicker: isRegenerate ? "重新生成" : "新建任务",
      source: (isRegenerate ? sourceArgs[1] : sourceArgs[0]) ?? "",
      providerLabel,
      status: "running",
      progress: 0,
      stage: "启动 Python 引擎…",
      log: [],
      errorDetail: "",
      notePath: null,
    };
    this.setStatus("VideoMemo: 启动中");
    const child = spawn(this.resolvePython(projectPath), args, {
      cwd: projectPath,
      env: engineEnv,
      shell: false,
      windowsHide: true,
      // Own a process group on POSIX so cancellation can reach yt-dlp/ffmpeg
      // grandchildren; Windows uses `taskkill /T` for the same effect.
      detached: process.platform !== "win32",
    });
    this.activeProcess = child;
    this.openProgressModal();

    const outputLines = createInterface({ input: child.stdout });
    outputLines.on("line", (line) => {
      this.handleOutputLine(line, vaultPath);
    });
    child.once("close", () => outputLines.close());
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = this.redactProviderSecrets(
        (this.stderrTail + chunk.toString("utf8")).slice(-4000),
      );
    });
    child.on("error", (error) => {
      this.finishTask(false, this.redactProviderSecrets(`无法启动 Python: ${error.message}`));
    });
    child.on("close", (code) => {
      if (this.activeProcess !== child) return;
      if (code === 0) {
        this.finishTask(true);
      } else {
        const detail = this.stderrTail.trim() || `Python 退出码 ${code ?? "未知"}`;
        this.finishTask(false, detail);
      }
    });
  }

  private handleOutputLine(line: string, vaultPath: string): void {
    const marker = line.indexOf(EVENT_PREFIX);
    if (marker < 0) return;
    try {
      const event = JSON.parse(line.slice(marker + EVENT_PREFIX.length)) as EngineEvent;
      const state = this.taskState;
      // Output buffered before the kill lands must not resurrect a task the
      // user already cancelled (or overwrite a terminal error).
      if (state && state.status !== "running") return;
      if (event.type === "progress" && state) {
        state.progress = Math.max(0, Math.min(1, event.progress ?? 0));
        const message = (event.message ?? "").replace(/\s+$/, "");
        const lines = message
          .split("\n")
          .map((item) => item.replace(/\s+$/, ""))
          .filter((item) => item.trim().length > 0);
        const lastLine = lines.at(-1)?.trim() ?? "";
        if (lastLine) state.stage = lastLine;
        state.log.push(...lines);
        if (state.log.length > MAX_LOG_LINES) {
          state.log.splice(0, state.log.length - MAX_LOG_LINES);
        }
        const percent = Math.round(state.progress * 100);
        this.setStatus(`VideoMemo: ${percent}% ${lastLine || "处理中"}`);
        this.progressModal?.refresh();
      } else if (event.type === "artifact" && event.kind === "obsidian_note") {
        if (state && event.path && isAbsolute(event.path)) {
          const absoluteNote = resolve(event.path);
          const absoluteVault = resolve(vaultPath);
          const vaultRelative = relative(absoluteVault, absoluteNote);
          if (
            vaultRelative &&
            vaultRelative !== ".." &&
            !vaultRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
            !isAbsolute(vaultRelative)
          ) {
            state.notePath = normalizePath(vaultRelative);
          }
        }
      }
    } catch {
      // Ignore ordinary engine output and malformed third-party log lines.
    }
  }

  private finishTask(success: boolean, errorMessage?: string): void {
    this.activeProcess = null;
    const state = this.taskState;
    if (!success) {
      if (state) {
        state.status = "error";
        state.errorDetail = errorMessage ?? "未知错误";
        state.stage = "任务失败";
      }
      this.setStatus("VideoMemo: 失败");
      this.progressModal?.refresh();
      new Notice(`视频总结失败\n${errorMessage ?? "未知错误"}`, 10000);
      return;
    }
    if (state) {
      state.status = "success";
      state.progress = 1;
      state.stage = "视频总结已生成";
    }
    this.setStatus("VideoMemo: 完成");
    this.progressModal?.refresh();
    new Notice("视频总结已生成");
    void this.openGeneratedNote();
  }

  /**
   * The engine writes the note straight to disk, so Obsidian may not have
   * indexed it yet when the process exits. Retry briefly before giving up.
   */
  private async openGeneratedNote(): Promise<void> {
    const path = this.taskState?.notePath;
    if (!path) return;
    for (let attempt = 0; attempt < NOTE_OPEN_ATTEMPTS; attempt++) {
      const note = this.app.vault.getAbstractFileByPath(path);
      if (note instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(note);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, NOTE_OPEN_INTERVAL_MS));
    }
  }

  private cancelActiveTask(showNotice = true): void {
    const child = this.activeProcess;
    if (!child) return;
    this.activeProcess = null;
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
    } else if (child.pid) {
      // Signal the whole process group; a bare child.kill() would leave
      // yt-dlp/ffmpeg running and still writing into the output directory.
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    } else {
      child.kill("SIGTERM");
    }
    if (this.taskState) {
      this.taskState.status = "cancelled";
      this.taskState.stage = "任务已取消";
    }
    this.setStatus("VideoMemo: 已取消");
    this.progressModal?.refresh();
    if (showNotice) new Notice("已取消视频总结任务");
  }
}
