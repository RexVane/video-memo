import { PluginSettingTab, Setting, setIcon, type App } from "obsidian";

import { CcSwitchProviderSettingsView } from "./ccswitch-settings";
import { describeProviderSelection } from "./settings";
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
      updateSettings: async (patch) => {
        Object.assign(this.plugin.settings, patch);
        await this.plugin.saveData(this.plugin.settings);
      },
      rerender: () => this.display(),
      onBack: () => {
        this.page = "settings";
        this.display();
      },
    });
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
    introCopy.createDiv({ cls: "video-memo-settings-kicker", text: "工作区设置" });
    introCopy.createEl("h2", { text: "VideoMemo" });
    introCopy.createDiv({
      cls: "video-memo-settings-description",
      text: "运行环境 · 输出 · 供应商",
    });

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
    containerEl.createDiv({
      cls: "video-memo-settings-section-label",
      text: "输出",
    });
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
