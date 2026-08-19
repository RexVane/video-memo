import { Modal, Notice, setIcon, type App } from "obsidian";

export type TaskStatus = "running" | "success" | "error" | "cancelled";

export interface TaskState {
  kicker: string;
  source: string;
  providerLabel: string;
  status: TaskStatus;
  progress: number;
  stage: string;
  log: string[];
  errorDetail: string;
  notePath: string | null;
}

interface RunProgressOptions {
  state: TaskState;
  onCancel: () => void;
  onOpenNote: () => void;
  onClosed: () => void;
}

const STATUS_KICKER: Record<TaskStatus, string> = {
  running: "正在处理",
  success: "已完成",
  error: "处理失败",
  cancelled: "已取消",
};

const STATUS_BADGE: Record<TaskStatus, string> = {
  running: "",
  success: "✓ 完成",
  error: "✗ 失败",
  cancelled: "已取消",
};

/**
 * Live progress panel for one engine run. The plugin mutates the shared
 * TaskState and calls refresh(); "后台运行" just closes the panel while the
 * child process keeps going, and the status bar can reopen it.
 */
export class RunProgressModal extends Modal {
  private readonly options: RunProgressOptions;
  private kickerEl: HTMLElement | null = null;
  private fillEl: HTMLElement | null = null;
  private percentEl: HTMLElement | null = null;
  private statusBadgeEl: HTMLElement | null = null;
  private stageEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private errorContainerEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private renderedLogCount = 0;
  private renderedStatus: TaskStatus | null = null;

  constructor(app: App, options: RunProgressOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.modalEl.addClass("video-memo-shell");
    this.contentEl.addClass(
      "video-memo-modal",
      "video-memo-progress-modal",
    );
    const state = this.options.state;

    const titleRow = this.contentEl.createDiv({
      cls: "video-memo-title-row",
    });
    const titleCopy = titleRow.createDiv({ cls: "video-memo-title-copy" });
    this.kickerEl = titleCopy.createDiv({ cls: "video-memo-modal-kicker" });
    titleCopy.createEl("h2", {
      cls: "video-memo-progress-source",
      text: state.source,
      attr: { title: state.source },
    });
    titleCopy.createDiv({
      cls: "video-memo-modal-subtitle",
      text: state.providerLabel,
    });

    const block = this.contentEl.createDiv({
      cls: "video-memo-progress-block",
    });
    const track = block.createDiv({ cls: "video-memo-progress-track" });
    this.fillEl = track.createDiv({ cls: "video-memo-progress-fill" });
    const meta = block.createDiv({ cls: "video-memo-progress-meta" });
    this.percentEl = meta.createSpan({ cls: "video-memo-progress-percent" });
    this.statusBadgeEl = meta.createSpan({ cls: "video-memo-progress-status" });

    this.stageEl = this.contentEl.createDiv({
      cls: "video-memo-progress-stage",
    });
    this.logEl = this.contentEl.createDiv({
      cls: "video-memo-progress-log",
      attr: { "aria-label": "运行日志" },
    });
    this.errorContainerEl = this.contentEl.createDiv();
    this.footerEl = this.contentEl.createDiv({
      cls: "video-memo-progress-footer",
    });
    this.refresh();
  }

  refresh(): void {
    const state = this.options.state;
    if (
      !this.fillEl ||
      !this.percentEl ||
      !this.statusBadgeEl ||
      !this.kickerEl ||
      !this.stageEl ||
      !this.logEl
    ) {
      return;
    }

    this.kickerEl.setText(STATUS_KICKER[state.status]);
    const percent = Math.round(Math.max(0, Math.min(1, state.progress)) * 100);
    this.fillEl.style.width = `${percent}%`;
    this.fillEl.toggleClass("is-success", state.status === "success");
    this.fillEl.toggleClass("is-error", state.status === "error");
    this.fillEl.toggleClass("is-cancelled", state.status === "cancelled");
    this.percentEl.setText(`${percent}%`);
    this.statusBadgeEl.setText(STATUS_BADGE[state.status]);
    this.statusBadgeEl.toggleClass("is-success", state.status === "success");
    this.statusBadgeEl.toggleClass("is-error", state.status === "error");
    this.stageEl.setText(state.stage || "处理中…");
    this.appendNewLogLines(state);

    if (this.renderedStatus !== state.status) {
      this.renderedStatus = state.status;
      this.renderErrorBox(state);
      this.renderFooter(state);
    }
  }

  private appendNewLogLines(state: TaskState): void {
    const logEl = this.logEl;
    if (!logEl) return;
    if (this.renderedLogCount > state.log.length) {
      // The plugin capped the log buffer; rebuild from scratch.
      logEl.empty();
      this.renderedLogCount = 0;
    }
    if (this.renderedLogCount === state.log.length) return;
    const nearBottom =
      logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 48;
    for (const line of state.log.slice(this.renderedLogCount)) {
      logEl.createDiv({ cls: "video-memo-progress-log-line", text: line });
    }
    this.renderedLogCount = state.log.length;
    if (nearBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  private renderErrorBox(state: TaskState): void {
    const container = this.errorContainerEl;
    if (!container) return;
    container.empty();
    if (state.status !== "error" || !state.errorDetail.trim()) return;
    const box = container.createDiv({ cls: "video-memo-progress-error" });
    const head = box.createDiv({ cls: "video-memo-progress-error-head" });
    head.createSpan({ text: "错误详情" });
    const copyButton = head.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": "复制错误信息" },
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void navigator.clipboard
        .writeText(state.errorDetail)
        .then(() => new Notice("错误信息已复制"))
        .catch(() => new Notice("复制失败，请手动选择错误信息"));
    });
    box.createEl("pre", { text: state.errorDetail.trim() });
  }

  private renderFooter(state: TaskState): void {
    const footer = this.footerEl;
    if (!footer) return;
    footer.empty();
    const addButton = (
      label: string,
      onClick: () => void,
      variant: "" | "cta" | "warning" = "",
    ): HTMLButtonElement => {
      const button = footer.createEl("button", {
        text: label,
        attr: { type: "button" },
      });
      if (variant === "cta") button.addClass("mod-cta");
      if (variant === "warning") button.addClass("mod-warning");
      button.addEventListener("click", onClick);
      return button;
    };

    if (state.status === "running") {
      addButton("后台运行", () => this.close());
      addButton("取消任务", () => this.options.onCancel(), "warning");
      return;
    }
    if (state.status === "success" && state.notePath) {
      addButton("关闭", () => this.close());
      addButton(
        "打开笔记",
        () => {
          this.options.onOpenNote();
          this.close();
        },
        "cta",
      );
      return;
    }
    addButton("关闭", () => this.close(), state.status === "success" ? "cta" : "");
  }

  onClose(): void {
    this.contentEl.empty();
    this.options.onClosed();
  }
}
