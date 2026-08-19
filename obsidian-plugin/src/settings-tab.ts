import { Notice, PluginSettingTab, Setting, setIcon, type App } from "obsidian";

import { CcSwitchProviderSettingsView } from "./ccswitch-settings";
import { describeProviderSelection, sanitizeTargetFolder } from "./settings";
import type VideoMemoPlugin from "./main";

export class VideoMemoSettingTab extends PluginSettingTab {
  private readonly plugin: VideoMemoPlugin;
  private readonly providerView: CcSwitchProviderSettingsView;
  private page: "settings" | "providers" = "settings";

  constructor(app: App, plugin: VideoMemoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.providerView = new CcSwitchProviderSettingsView({
      app,
      getSettings: () => this.plugin.settings,
      // Never reject: dozens of call sites chain .then() without .catch(), so a
      // failed write must surface as a Notice here instead of becoming an
      // unhandled rejection that also skips the caller's re-render.
      updateSettings: async (patch) => {
        Object.assign(this.plugin.settings, patch);
        await this.persist();
      },
      rerender: () => this.display(),
      onBack: () => {
        this.page = "settings";
        this.display();
      },
    });
  }

  private async persist(): Promise<void> {
    try {
      await this.plugin.saveData(this.plugin.settings);
    } catch (error) {
      console.error("VideoMemo: failed to save settings", error);
      new Notice("VideoMemo 设置保存失败，请检查 Vault 是否可写");
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.addClass("video-memo-settings-tab");
    containerEl.empty();
    if (this.page === "providers") {
      this.providerView.render(containerEl);
      return;
    }

    const intro = containerEl.createDiv({ cls: "video-memo-settings-intro" });
    const introMark = intro.createDiv({ cls: "video-memo-settings-mark" });
    setIcon(introMark, "video");
    const introCopy = intro.createDiv({ cls: "video-memo-settings-intro-copy" });
    introCopy.createEl("h2", { text: "VideoMemo" });

    const openProviders = (): void => {
      this.page = "providers";
      this.providerView.showProviderList();
      this.display();
    };
    const providerSetting = new Setting(containerEl)
      .setName("供应商")
      .setDesc(describeProviderSelection(this.plugin.settings))
      .addExtraButton((button) =>
        button.setIcon("chevron-right").setTooltip("打开供应商设置").onClick(openProviders),
      );
    providerSetting.settingEl.addClass("video-memo-navigation-setting");
    providerSetting.settingEl.setAttribute("role", "button");
    providerSetting.settingEl.tabIndex = 0;
    providerSetting.settingEl.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      openProviders();
    });
    providerSetting.settingEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openProviders();
    });
    containerEl.createDiv({
      cls: "video-memo-settings-section-label",
      text: "运行环境",
    });
    new Setting(containerEl)
      .setName("项目目录")
      .setDesc("包含 src/pipeline.py 的 VideoMemo 目录")
      .addText((text) =>
        text
          .setPlaceholder("D:\\AIApp\\video-memo")
          .setValue(this.plugin.settings.projectPath)
          .onChange(async (value) => {
            this.plugin.settings.projectPath = value.trim();
            await this.persist();
            this.display();
          }),
      );
    const projectPath = this.plugin.settings.projectPath.trim();
    const pythonPath = projectPath ? this.plugin.resolvePython(projectPath) : "";
    new Setting(containerEl)
      .setName("Python 路径")
      .setDesc("自动检测项目 .venv，未找到时使用系统 PATH 中的 python")
      .addText((text) => {
        text
          .setPlaceholder("填写项目目录后自动识别")
          .setValue(pythonPath)
          .inputEl.disabled = true;
      });
    containerEl.createDiv({
      cls: "video-memo-settings-section-label",
      text: "输出",
    });
    new Setting(containerEl)
      .setName("Vault 目标文件夹（可选）")
      .setDesc("留空：按视频内容自动创建主题文件夹（如 Git/）；填写：固定放到 Vault 内该相对路径（不允许绝对路径或 .. 片段）")
      .addText((text) =>
        text
          .setPlaceholder("留空 = 自动按主题归类")
          .setValue(this.plugin.settings.targetFolder)
          .onChange(async (value) => {
            this.plugin.settings.targetFolder = sanitizeTargetFolder(value);
            await this.persist();
          }),
      );
    new Setting(containerEl)
      .setName("完成后清理媒体")
      .setDesc("删除输出目录中的下载媒体和音轨，不删除本地输入文件")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.cleanupMedia).onChange(async (value) => {
          this.plugin.settings.cleanupMedia = value;
          await this.persist();
        }),
      );
  }

  showHome(): void {
    this.page = "settings";
    this.providerView.showProviderList();
  }

  showProviders(): void {
    this.page = "providers";
    this.providerView.showProviderList();
  }

  hide(): void {
    this.showHome();
  }
}
