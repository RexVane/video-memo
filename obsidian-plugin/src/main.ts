import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { isAbsolute, join, relative } from "node:path";
import {
  FileSystemAdapter,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  setIcon,
  type App,
} from "obsidian";

import { resolveCcSwitchProviderRuntime } from "./ccswitch";
import {
  CcSwitchProviderSettingsView,
  type CcSwitchUiSettings,
} from "./ccswitch-settings";

const EVENT_PREFIX = "@@VIDEO_SUMMARIZER@@";
const MEDIA_ACCEPT = [
  ".mp4",
  ".mkv",
  ".webm",
  ".mov",
  ".avi",
  ".flv",
  ".m4v",
  ".ts",
  ".mpg",
  ".mpeg",
  ".wmv",
  ".mp3",
  ".wav",
  ".m4a",
  ".flac",
  ".aac",
  ".ogg",
  ".opus",
  ".wma",
  ".amr",
  ".aiff",
].join(",");

interface VideoSummarizerSettings extends CcSwitchUiSettings {
  projectPath: string;
  pythonPath: string;
  model: string;
  targetFolder: string;
  cleanupMedia: boolean;
}

const DEFAULT_SETTINGS: VideoSummarizerSettings = {
  projectPath: "",
  pythonPath: "",
  providerSource: "ccswitch",
  ccSwitchDbPath: "",
  ccSwitchAppType: "codex",
  ccSwitchFollowCurrent: true,
  ccSwitchProviderId: "",
  model: "",
  targetFolder: "Video Summaries",
  cleanupMedia: false,
};

interface EngineEvent {
  type: "progress" | "artifact" | "result";
  message?: string;
  progress?: number;
  kind?: string;
  path?: string;
  summary_path?: string;
}

function normalizeSettings(
  stored: Partial<VideoSummarizerSettings> | null,
): VideoSummarizerSettings {
  const stringValue = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback;
  return {
    projectPath: stringValue(stored?.projectPath, DEFAULT_SETTINGS.projectPath),
    pythonPath: stringValue(stored?.pythonPath, DEFAULT_SETTINGS.pythonPath),
    providerSource: stored?.providerSource === "environment" ? "environment" : "ccswitch",
    ccSwitchDbPath: stringValue(stored?.ccSwitchDbPath, DEFAULT_SETTINGS.ccSwitchDbPath),
    ccSwitchAppType: stringValue(stored?.ccSwitchAppType, DEFAULT_SETTINGS.ccSwitchAppType),
    ccSwitchFollowCurrent:
      typeof stored?.ccSwitchFollowCurrent === "boolean"
        ? stored.ccSwitchFollowCurrent
        : DEFAULT_SETTINGS.ccSwitchFollowCurrent,
    ccSwitchProviderId: stringValue(
      stored?.ccSwitchProviderId,
      DEFAULT_SETTINGS.ccSwitchProviderId,
    ),
    model: stringValue(stored?.model, DEFAULT_SETTINGS.model),
    targetFolder: stringValue(stored?.targetFolder, DEFAULT_SETTINGS.targetFolder),
    cleanupMedia:
      typeof stored?.cleanupMedia === "boolean"
        ? stored.cleanupMedia
        : DEFAULT_SETTINGS.cleanupMedia,
  };
}

class TextPromptModal extends Modal {
  private readonly titleText: string;
  private readonly fieldName: string;
  private readonly placeholder: string;
  private readonly onSubmit: (value: string) => void;
  private readonly onOpenSettings: (() => void) | null;
  private readonly showMediaPicker: boolean;

  constructor(
    app: App,
    options: {
      title: string;
      fieldName: string;
      placeholder: string;
      showMediaPicker?: boolean;
      onOpenSettings?: () => void;
      onSubmit: (value: string) => void;
    },
  ) {
    super(app);
    this.titleText = options.title;
    this.fieldName = options.fieldName;
    this.placeholder = options.placeholder;
    this.onSubmit = options.onSubmit;
    this.onOpenSettings = options.onOpenSettings ?? null;
    this.showMediaPicker = options.showMediaPicker ?? false;
  }

  onOpen(): void {
    this.modalEl.addClass("video-summarizer-shell");
    this.contentEl.addClass("video-summarizer-modal");
    const titleRow = this.contentEl.createDiv({
      cls: "video-summarizer-title-row",
    });
    titleRow.createEl("h2", { text: this.titleText });
    if (this.onOpenSettings) {
      const settingsButton = titleRow.createEl("button", {
        cls: "clickable-icon video-summarizer-settings-button",
        attr: {
          type: "button",
          "aria-label": "打开 Video Summarizer 设置",
        },
      });
      setIcon(settingsButton, "settings");
      settingsButton.addEventListener("click", () => {
        this.close();
        this.onOpenSettings?.();
      });
    }
    let value = "";
    let linkValue = "";
    let fileValue = "";
    let sourceMode: "link" | "file" = "link";
    const submit = (): void => {
      const normalized = (
        this.showMediaPicker
          ? sourceMode === "link"
            ? linkValue
            : fileValue
          : value
      ).trim();
      if (!normalized) {
        const missing = this.showMediaPicker
          ? sourceMode === "link"
            ? "请输入视频链接"
            : "请选择本地文件"
          : `${this.fieldName}不能为空`;
        new Notice(missing);
        return;
      }
      this.close();
      this.onSubmit(normalized);
    };

    if (this.showMediaPicker) {
      const modeSwitch = this.contentEl.createDiv({
        cls: "video-summarizer-mode-switch",
        attr: { "aria-label": "输入类型" },
      });
      const createModeButton = (
        label: string,
        icon: string,
        mode: "link" | "file",
      ): HTMLButtonElement => {
        const button = modeSwitch.createEl("button", {
          cls: "video-summarizer-mode-button",
          attr: { type: "button" },
        });
        const iconElement = button.createSpan({
          cls: "video-summarizer-mode-icon",
        });
        setIcon(iconElement, icon);
        button.createSpan({ text: label });
        button.addEventListener("click", () => setSourceMode(mode));
        return button;
      };

      let linkInput: HTMLInputElement | null = null;
      let fileControl: { setValue: (next: string) => unknown } | null = null;
      let fileInputElement: HTMLInputElement | null = null;
      const linkSetting = new Setting(this.contentEl)
        .setClass("video-summarizer-input-setting")
        .setName("视频链接")
        .addText((text) => {
          linkInput = text.inputEl;
          text.setPlaceholder("https://...").onChange((next) => {
            linkValue = next;
          });
          text.inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") submit();
          });
        });
      const fileSetting = new Setting(this.contentEl)
        .setClass("video-summarizer-input-setting")
        .setName("本地视频或录音")
        .addText((text) => {
          fileControl = text;
          fileInputElement = text.inputEl;
          text.setPlaceholder("选择文件，或粘贴本地路径").onChange((next) => {
            fileValue = next;
          });
          text.inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") submit();
          });
        });
      const fileInput = this.contentEl.createEl("input", {
        cls: "video-summarizer-native-file",
        attr: { type: "file", accept: MEDIA_ACCEPT },
      });
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const electron = require("electron") as {
          webUtils?: { getPathForFile: (selected: File) => string };
        };
        const selectedPath =
          electron.webUtils?.getPathForFile(file) ??
          (file as File & { path?: string }).path ??
          "";
        if (!selectedPath) {
          new Notice("无法读取所选文件的本地路径");
          return;
        }
        fileValue = selectedPath;
        fileControl?.setValue(selectedPath);
      });
      fileSetting.addButton((button) =>
        button
          .setButtonText("选择文件…")
          .setTooltip("选择本地视频或录音")
          .onClick(() => fileInput.click()),
      );

      const linkButton = createModeButton("视频链接", "link", "link");
      const fileButton = createModeButton("本地文件", "folder-open", "file");
      function setSourceMode(mode: "link" | "file"): void {
        sourceMode = mode;
        linkButton.toggleClass("is-active", mode === "link");
        fileButton.toggleClass("is-active", mode === "file");
        linkSetting.settingEl.toggleClass("is-hidden", mode !== "link");
        fileSetting.settingEl.toggleClass("is-hidden", mode !== "file");
        window.setTimeout(
          () => (mode === "link" ? linkInput : fileInputElement)?.focus(),
          0,
        );
      }
      setSourceMode("link");
    } else {
      new Setting(this.contentEl)
        .setClass("video-summarizer-input-setting")
        .setName(this.fieldName)
        .addText((text) => {
          text.setPlaceholder(this.placeholder).onChange((next) => {
            value = next;
          });
          text.inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") submit();
          });
          window.setTimeout(() => text.inputEl.focus(), 0);
        });
    }
    new Setting(this.contentEl)
      .setClass("video-summarizer-actions")
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button.setButtonText("开始").setCta().onClick(submit),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export default class VideoSummarizerPlugin extends Plugin {
  settings: VideoSummarizerSettings = DEFAULT_SETTINGS;
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private statusEl: HTMLElement | null = null;
  private generatedNotePath: string | null = null;
  private stderrTail = "";

  async onload(): Promise<void> {
    const stored = (await this.loadData()) as Partial<VideoSummarizerSettings> | null;
    this.settings = normalizeSettings(stored);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(this.settings)) {
      await this.saveData(this.settings);
    }
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("video-summarizer-status");
    this.statusEl.setText("Video Summarizer: 就绪");

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
    this.addSettingTab(new VideoSummarizerSettingTab(this.app, this));
  }

  onunload(): void {
    this.cancelActiveTask(false);
  }

  private openSourceModal(): void {
    new TextPromptModal(this.app, {
      title: "总结视频或录音",
      fieldName: "链接或本地文件路径",
      placeholder: "https://... 或 D:\\Media\\course.mp4",
      showMediaPicker: true,
      onOpenSettings: () => this.openPluginSettings(),
      onSubmit: (value) => this.startEngine([value]),
    }).open();
  }

  private openRegenerateModal(): void {
    new TextPromptModal(this.app, {
      title: "重新生成报告",
      fieldName: "运行目录",
      placeholder: "D:\\video-summarizer\\output\\20260717_...",
      onOpenSettings: () => this.openPluginSettings(),
      onSubmit: (value) => this.startEngine(["--regenerate", value]),
    }).open();
  }

  private vaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Video Summarizer 仅支持桌面文件系统 Vault");
      return null;
    }
    return adapter.getBasePath();
  }

  private resolvePython(projectPath: string): string {
    if (this.settings.pythonPath.trim()) return this.settings.pythonPath.trim();
    const virtualEnvPython = join(
      projectPath,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    return existsSync(virtualEnvPython) ? virtualEnvPython : "python";
  }

  private openPluginSettings(): void {
    const app = this.app as App & {
      setting: { open: () => void; openTabById: (id: string) => void };
    };
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  private startEngine(sourceArgs: string[]): void {
    if (this.activeProcess) {
      new Notice("已有总结任务正在运行");
      return;
    }
    const projectPath = this.settings.projectPath.trim();
    const pipelinePath = join(projectPath, "src", "pipeline.py");
    if (!projectPath || !existsSync(pipelinePath)) {
      new Notice("请先在插件设置中配置 Video Summarizer 项目目录");
      return;
    }
    const vaultPath = this.vaultPath();
    if (!vaultPath) return;

    const engineEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: "1" };
    let selectedModel = this.settings.model.trim();
    let providerBaseUrl = "";
    if (this.settings.providerSource === "ccswitch") {
      try {
        const runtime = resolveCcSwitchProviderRuntime({
          dbPath: this.settings.ccSwitchDbPath,
          appType: this.settings.ccSwitchAppType,
          followCurrent: this.settings.ccSwitchFollowCurrent,
          providerId: this.settings.ccSwitchProviderId,
        });
        providerBaseUrl = runtime.baseUrl;
        selectedModel = selectedModel || runtime.model || "";
        engineEnv.LLM_API_KEY = runtime.apiKey;
        engineEnv.LLM_BASE_URL = runtime.baseUrl;
        if (runtime.apiFormat) engineEnv.LLM_API_FORMAT = runtime.apiFormat;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`无法使用 cc-switch 供应商\n${message}`, 8000);
        this.openPluginSettings();
        return;
      }
    }

    const args = [
      pipelinePath,
      ...sourceArgs,
      "--obsidian-vault",
      vaultPath,
      "--obsidian-folder",
      this.settings.targetFolder.trim() || DEFAULT_SETTINGS.targetFolder,
      "--json-progress",
    ];
    if (selectedModel) args.push("--llm-model", selectedModel);
    if (providerBaseUrl) args.push("--api-base-url", providerBaseUrl);
    if (this.settings.cleanupMedia && sourceArgs[0] !== "--regenerate") {
      args.push("--cleanup-media");
    }

    this.generatedNotePath = null;
    this.stderrTail = "";
    this.statusEl?.setText("Video Summarizer: 启动中");
    const child = spawn(this.resolvePython(projectPath), args, {
      cwd: projectPath,
      env: engineEnv,
      shell: false,
      windowsHide: true,
    });
    this.activeProcess = child;

    createInterface({ input: child.stdout }).on("line", (line) => {
      this.handleOutputLine(line, vaultPath);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4000);
    });
    child.on("error", (error) => {
      this.finishTask(false, `无法启动 Python: ${error.message}`);
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
      if (event.type === "progress") {
        const percent = Math.round((event.progress ?? 0) * 100);
        const message = (event.message ?? "处理中").trim().split("\n").at(-1);
        this.statusEl?.setText(`Video Summarizer: ${percent}% ${message ?? ""}`);
      } else if (event.type === "artifact" && event.kind === "obsidian_note") {
        if (event.path && isAbsolute(event.path)) {
          this.generatedNotePath = normalizePath(relative(vaultPath, event.path));
        }
      }
    } catch {
      // Ignore ordinary engine output and malformed third-party log lines.
    }
  }

  private finishTask(success: boolean, errorMessage?: string): void {
    this.activeProcess = null;
    if (!success) {
      this.statusEl?.setText("Video Summarizer: 失败");
      new Notice(`视频总结失败\n${errorMessage ?? "未知错误"}`, 10000);
      return;
    }
    this.statusEl?.setText("Video Summarizer: 完成");
    new Notice("视频总结已生成");
    if (!this.generatedNotePath) return;
    const note = this.app.vault.getAbstractFileByPath(this.generatedNotePath);
    if (note instanceof TFile) {
      void this.app.workspace.getLeaf(false).openFile(note);
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
    } else {
      child.kill("SIGTERM");
    }
    this.statusEl?.setText("Video Summarizer: 已取消");
    if (showNotice) new Notice("已取消视频总结任务");
  }
}

class VideoSummarizerSettingTab extends PluginSettingTab {
  private readonly plugin: VideoSummarizerPlugin;
  private readonly providerView: CcSwitchProviderSettingsView;

  constructor(app: App, plugin: VideoSummarizerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.providerView = new CcSwitchProviderSettingsView({
      app,
      getSettings: () => this.plugin.settings,
      updateSettings: async (patch) => {
        Object.assign(this.plugin.settings, patch);
        await this.plugin.saveData(this.plugin.settings);
      },
      rerender: () => this.display(),
    });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Video Summarizer" });
    if (this.providerView.render(containerEl)) return;
    containerEl.createEl("h3", { text: "运行设置" });
    new Setting(containerEl)
      .setName("项目目录")
      .setDesc("包含 src/pipeline.py 的 Video Summarizer 目录")
      .addText((text) =>
        text
          .setPlaceholder("D:\\AIApp\\video-summarizer")
          .setValue(this.plugin.settings.projectPath)
          .onChange(async (value) => {
            this.plugin.settings.projectPath = value.trim();
            await this.plugin.saveData(this.plugin.settings);
          }),
      );
    new Setting(containerEl)
      .setName("Python 路径")
      .setDesc("留空时优先使用项目 .venv，随后使用 PATH 中的 python")
      .addText((text) =>
        text.setValue(this.plugin.settings.pythonPath).onChange(async (value) => {
          this.plugin.settings.pythonPath = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
    new Setting(containerEl)
      .setName("Vault 目标文件夹")
      .addText((text) =>
        text.setValue(this.plugin.settings.targetFolder).onChange(async (value) => {
          this.plugin.settings.targetFolder = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
    new Setting(containerEl)
      .setName("完成后清理媒体")
      .setDesc("删除输出目录中的下载媒体和音轨，不删除本地输入文件")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.cleanupMedia).onChange(async (value) => {
          this.plugin.settings.cleanupMedia = value;
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
  }

  hide(): void {
    this.providerView.showProviderList();
  }
}
