import { Modal, Notice, Setting, setIcon, type App } from "obsidian";

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

export class TextPromptModal extends Modal {
  private readonly titleText: string;
  private readonly fieldName: string;
  private readonly placeholder: string;
  private readonly providerBadge: string;
  private readonly onSubmit: (value: string) => void;
  private readonly onOpenSettings: (() => void) | null;
  private readonly showMediaPicker: boolean;

  constructor(
    app: App,
    options: {
      title: string;
      fieldName: string;
      placeholder: string;
      providerBadge?: string;
      showMediaPicker?: boolean;
      onOpenSettings?: () => void;
      onSubmit: (value: string) => void;
    },
  ) {
    super(app);
    this.titleText = options.title;
    this.fieldName = options.fieldName;
    this.placeholder = options.placeholder;
    this.providerBadge = options.providerBadge ?? "";
    this.onSubmit = options.onSubmit;
    this.onOpenSettings = options.onOpenSettings ?? null;
    this.showMediaPicker = options.showMediaPicker ?? false;
  }

  onOpen(): void {
    this.modalEl.addClass("video-memo-shell");
    this.contentEl.addClass("video-memo-modal");
    const titleRow = this.contentEl.createDiv({
      cls: "video-memo-title-row",
    });
    const titleCopy = titleRow.createDiv({ cls: "video-memo-title-copy" });
    titleCopy.createDiv({
      cls: "video-memo-modal-kicker",
      text: this.showMediaPicker ? "新建任务" : "已有运行目录",
    });
    titleCopy.createEl("h2", { text: this.titleText });
    titleCopy.createDiv({
      cls: "video-memo-modal-subtitle",
      text: this.showMediaPicker
        ? "视频链接 · 本地媒体"
        : "已有转写 · 重新生成",
    });
    if (this.providerBadge || this.onOpenSettings) {
      const badgeRow = this.contentEl.createDiv({
        cls: "video-memo-badge-row",
      });
      if (this.providerBadge) {
        const badge = badgeRow.createDiv({
          cls: "video-memo-provider-badge",
          attr: { "aria-label": "当前任务使用的供应商" },
        });
        const badgeIcon = badge.createSpan({
          cls: "video-memo-provider-badge-icon",
        });
        setIcon(badgeIcon, "server");
        badge.createSpan({
          cls: "video-memo-provider-badge-text",
          text: this.providerBadge,
        });
      }
      if (this.onOpenSettings) {
        const settingsButton = badgeRow.createEl("button", {
          cls: "clickable-icon video-memo-settings-button",
          attr: {
            type: "button",
            "aria-label": "打开 VideoMemo 设置",
          },
        });
        setIcon(settingsButton, "settings");
        settingsButton.addEventListener("click", () => {
          this.close();
          this.onOpenSettings?.();
        });
      }
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
        cls: "video-memo-mode-switch",
        attr: { "aria-label": "输入类型" },
      });
      const createModeButton = (
        label: string,
        icon: string,
        mode: "link" | "file",
      ): HTMLButtonElement => {
        const button = modeSwitch.createEl("button", {
          cls: "video-memo-mode-button",
          attr: { type: "button" },
        });
        const iconElement = button.createSpan({
          cls: "video-memo-mode-icon",
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
        .setClass("video-memo-input-setting")
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
        .setClass("video-memo-input-setting")
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
        cls: "video-memo-native-file",
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
        .setClass("video-memo-input-setting")
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
      .setClass("video-memo-actions")
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button.setButtonText("开始").setCta().onClick(submit),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
