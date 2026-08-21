import { Modal, Notice, Setting, type App } from "obsidian";
import {
  fetchOpenAiCompatibleModels,
  loadCcSwitchProviders,
  normalizeApiFormat,
  probeOpenAiCompatibleModel,
  type CcSwitchProvider,
} from "./ccswitch";

export type ProviderSource = "ccswitch" | "custom";
export type CustomProviderApiFormat =
  | "anthropic_messages"
  | "chat_completions"
  | "responses";
export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat: CustomProviderApiFormat;
}
export interface CcSwitchUiSettings {
  providerSource: ProviderSource;
  ccSwitchDbPath: string;
  ccSwitchAppType: string;
  ccSwitchFollowCurrent: boolean;
  ccSwitchProviderId: string;
  model: string;
  customProviders: CustomProviderConfig[];
  activeCustomProviderId: string;
}
interface ViewOptions {
  app: App;
  getSettings: () => CcSwitchUiSettings;
  updateSettings: (patch: Partial<CcSwitchUiSettings>) => Promise<void>;
  rerender: () => void;
  onBack: () => void;
}

const maskedKey = (value: string): string =>
  value.trim() ? `•••• ${value.trim().slice(-4)}` : "未填写";
const freshId = (): string =>
  `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const displayBaseUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value ? "已配置地址" : "未识别 Base URL";
  }
};

class ProviderEditorModal extends Modal {
  private draft: CustomProviderConfig;
  constructor(
    app: App,
    provider: CustomProviderConfig | null,
    private readonly save: (value: CustomProviderConfig) => Promise<void>,
  ) {
    super(app);
    this.draft = provider
      ? { ...provider }
      : {
          id: freshId(),
          name: "",
          baseUrl: "",
          apiKey: "",
          model: "",
          apiFormat: "chat_completions",
        };
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("video-memo-provider-editor");
    contentEl.createEl("h2", {
      text: this.draft.name ? "编辑供应商" : "添加供应商",
    });
    new Setting(contentEl).setName("名称").addText((x) =>
      x.setValue(this.draft.name).onChange((v) => {
        this.draft.name = v.trim();
      }),
    );
    new Setting(contentEl).setName("Base URL").addText((x) =>
      x
        .setPlaceholder("https://api.example.com")
        .setValue(this.draft.baseUrl)
        .onChange((v) => {
          this.draft.baseUrl = v.trim();
        }),
    );
    new Setting(contentEl).setName("协议").addDropdown((x) =>
      x
        .addOptions({
          chat_completions: "Chat Completions",
          responses: "Responses",
          anthropic_messages: "Anthropic Messages",
        })
        .setValue(this.draft.apiFormat)
        .onChange((v) => {
          this.draft.apiFormat = normalizeApiFormat(v);
        }),
    );
    new Setting(contentEl)
      .setName("API Key")
      .setDesc(`当前：${maskedKey(this.draft.apiKey)}`)
      .addText((x) => {
        x.inputEl.type = "password";
        x.setPlaceholder(
          this.draft.apiKey ? "输入新值或保留现值" : "输入密钥",
        ).onChange((v) => {
          if (v) this.draft.apiKey = v.trim();
        });
      });
    const modelSetting = new Setting(contentEl).setName("模型").addText((x) =>
      x.setValue(this.draft.model).onChange((v) => {
        this.draft.model = v.trim();
      }),
    );
    const results = contentEl.createDiv({
      cls: "video-memo-provider-model-results",
    });
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("发现模型").onClick(async () => {
          button.setDisabled(true);
          results.empty();
          try {
            const response = await fetchOpenAiCompatibleModels(this.draft);
            if (!response.models.length) {
              results.setText("服务未返回模型列表");
              return;
            }
            new Setting(results).setName("可用模型").addDropdown((dropdown) => {
              dropdown.addOption("", "选择模型");
              for (const model of response.models)
                dropdown.addOption(model, model);
              dropdown.onChange((value) => {
                if (value) {
                  this.draft.model = value;
                  const input = modelSetting.controlEl.querySelector("input");
                  if (input) input.value = value;
                }
              });
            });
          } catch {
            new Notice("模型发现失败，请检查配置");
          } finally {
            button.setDisabled(false);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("测试连接").onClick(async () => {
          if (!this.valid()) return;
          button.setDisabled(true);
          try {
            await probeOpenAiCompatibleModel(this.draft);
            new Notice("连接测试成功");
          } catch {
            new Notice("连接测试失败，请检查配置");
          } finally {
            button.setDisabled(false);
          }
        }),
      );
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("取消").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setCta()
          .setButtonText("保存")
          .onClick(async () => {
            if (!this.valid()) return;
            b.setDisabled(true);
            await this.save({ ...this.draft });
            this.close();
          }),
      );
  }
  private valid(): boolean {
    if (
      !this.draft.name ||
      !this.draft.baseUrl ||
      !this.draft.apiKey ||
      !this.draft.model
    ) {
      new Notice("请填写名称、Base URL、API Key 和模型");
      return false;
    }
    try {
      const u = new URL(this.draft.baseUrl);
      if (
        u.protocol !== "https:" &&
        u.hostname !== "localhost" &&
        u.hostname !== "127.0.0.1"
      )
        throw new Error();
    } catch {
      new Notice("Base URL 必须是 HTTPS，或本机地址");
      return false;
    }
    return true;
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

export class CcSwitchProviderSettingsView {
  constructor(private readonly options: ViewOptions) {}
  showProviderList(): void {}
  render(parent: HTMLElement): boolean {
    parent.addClass("video-memo-provider-view");
    const settings = this.options.getSettings();
    new Setting(parent)
      .setClass("video-memo-provider-header")
      .setName("供应商设置")
      .addExtraButton((b) =>
        b.setIcon("arrow-left").setTooltip("返回").onClick(this.options.onBack),
      );
    new Setting(parent)
      .setName("配置来源")
      .setClass("video-memo-provider-source")
      .addDropdown((d) =>
        d
          .addOptions({
            ccswitch: "cc-switch 数据库",
            custom: "自定义供应商",
          })
          .setValue(settings.providerSource)
          .onChange(async (v) => {
            await this.options.updateSettings({
              providerSource: v as ProviderSource,
            });
            this.options.rerender();
          }),
      );
    if (settings.providerSource === "custom")
      this.renderCustom(parent, settings);
    else this.renderCcSwitch(parent, settings);
    return true;
  }
  private renderCustom(
    parent: HTMLElement,
    settings: CcSwitchUiSettings,
  ): void {
    new Setting(parent)
      .setClass("video-memo-provider-custom-toolbar")
      .setName("自定义供应商")
      .setDesc("密钥仅以掩码显示")
      .addButton((b) =>
        b.setButtonText("添加").onClick(() => this.openEditor(null)),
      );
    if (!settings.customProviders.length) {
      parent.createEl("p", {
        cls: "video-memo-provider-empty",
        text: "尚未添加供应商。",
      });
      return;
    }
    for (const provider of settings.customProviders) {
      const active = provider.id === settings.activeCustomProviderId;
      new Setting(parent)
        .setClass("video-memo-provider-custom-row")
        .setName(`${active ? "当前 · " : ""}${provider.name || "未命名"}`)
        .setDesc(
          `${provider.model || "未选模型"} · ${displayBaseUrl(provider.baseUrl)} · ${maskedKey(provider.apiKey)}`,
        )
        .addButton((b) =>
          b
            .setButtonText(active ? "已选择" : "选择")
            .setDisabled(active)
            .onClick(async () => {
              await this.options.updateSettings({
                activeCustomProviderId: provider.id,
              });
              this.options.rerender();
            }),
        )
        .addExtraButton((b) =>
          b
            .setIcon("pencil")
            .setTooltip("编辑")
            .onClick(() => this.openEditor(provider)),
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip("删除")
            .onClick(async () => {
              const list = settings.customProviders.filter(
                (x) => x.id !== provider.id,
              );
              await this.options.updateSettings({
                customProviders: list,
                activeCustomProviderId: list[0]?.id || "",
              });
              this.options.rerender();
            }),
        );
    }
  }
  private openEditor(provider: CustomProviderConfig | null): void {
    new ProviderEditorModal(this.options.app, provider, async (value) => {
      const settings = this.options.getSettings();
      const exists = settings.customProviders.some((x) => x.id === value.id);
      const customProviders = exists
        ? settings.customProviders.map((x) => (x.id === value.id ? value : x))
        : [...settings.customProviders, value];
      await this.options.updateSettings({
        customProviders,
        activeCustomProviderId: settings.activeCustomProviderId || value.id,
      });
      this.options.rerender();
    }).open();
  }
  private renderCcSwitch(
    parent: HTMLElement,
    settings: CcSwitchUiSettings,
  ): void {
    new Setting(parent)
      .setClass("video-memo-provider-database")
      .setName("数据库文件")
      .setDesc("留空使用 ~/.cc-switch/cc-switch.db")
      .addText((x) =>
        x
          .setPlaceholder("默认路径")
          .setValue(settings.ccSwitchDbPath)
          .onChange(async (v) => {
            await this.options.updateSettings({ ccSwitchDbPath: v.trim() });
          }),
      );
    let providers: CcSwitchProvider[];
    try {
      providers = loadCcSwitchProviders(settings.ccSwitchDbPath).providers;
    } catch {
      parent.createEl("p", {
        cls: "video-memo-provider-error",
        text: "无法读取数据库。请检查路径或 Obsidian 版本。",
      });
      return;
    }
    const appTypes = [...new Set(providers.map((x) => x.appType))];
    const appType = appTypes.includes(settings.ccSwitchAppType)
      ? settings.ccSwitchAppType
      : appTypes[0] || settings.ccSwitchAppType;
    new Setting(parent)
      .setClass("video-memo-provider-app-type")
      .setName("应用类型")
      .addDropdown((d) => {
        for (const v of appTypes) d.addOption(v, v);
        d.setValue(appType).onChange(async (v) => {
          await this.options.updateSettings({
            ccSwitchAppType: v,
            ccSwitchProviderId: "",
            model: "",
          });
          this.options.rerender();
        });
      });
    new Setting(parent)
      .setClass("video-memo-provider-follow-current")
      .setName("跟随全局当前")
      .addToggle((t) =>
        t.setValue(settings.ccSwitchFollowCurrent).onChange(async (v) => {
          await this.options.updateSettings({ ccSwitchFollowCurrent: v });
          this.options.rerender();
        }),
      );
    const list = providers.filter((x) => x.appType === appType);
    if (!settings.ccSwitchFollowCurrent)
      new Setting(parent)
        .setClass("video-memo-provider-fixed-selection")
        .setName("固定供应商")
        .addDropdown((d) => {
          d.addOption("", "请选择");
          for (const p of list) d.addOption(p.id, p.name);
          d.setValue(settings.ccSwitchProviderId).onChange(async (v) => {
            await this.options.updateSettings({
              ccSwitchProviderId: v,
              model: "",
            });
            this.options.rerender();
          });
        });
    const selected = settings.ccSwitchFollowCurrent
      ? list.find((x) => x.isCurrent)
      : list.find((x) => x.id === settings.ccSwitchProviderId);
    if (!selected) {
      parent.createEl("p", {
        cls: "video-memo-provider-empty",
        text: "当前条件下没有可用供应商。",
      });
      return;
    }
    new Setting(parent)
      .setClass("video-memo-provider-summary")
      .setName(selected.name)
      .setDesc(
        `${displayBaseUrl(selected.baseUrl || "")} · ${selected.model || "默认模型"} · API Key ${selected.usable ? "已配置" : "缺失"}`,
      );
    new Setting(parent)
      .setClass("video-memo-provider-model")
      .setName("模型覆盖（可选）")
      .addText((x) =>
        x
          .setValue(settings.model)
          .setPlaceholder(selected.model || "使用供应商默认模型")
          .onChange(async (v) => {
            await this.options.updateSettings({ model: v.trim() });
          }),
      )
      .addButton((b) =>
        b.setButtonText("发现模型").onClick(async () => {
          b.setDisabled(true);
          try {
            const runtime = await import("./ccswitch");
            const r = await runtime.fetchCcSwitchProviderModels({
              dbPath: settings.ccSwitchDbPath,
              appType,
              providerId: selected.id,
            });
            if (r.models.length)
              new ModelPickerModal(
                this.options.app,
                r.models,
                async (model) => {
                  await this.options.updateSettings({ model });
                  this.options.rerender();
                },
              ).open();
            else new Notice("服务未返回模型列表");
          } catch {
            new Notice("模型发现失败，请检查配置");
          } finally {
            b.setDisabled(false);
          }
        }),
      );
  }
}

class ModelPickerModal extends Modal {
  constructor(
    app: App,
    private readonly models: string[],
    private readonly choose: (model: string) => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    this.contentEl.addClass("video-memo-provider-model-picker");
    this.contentEl.createEl("h2", { text: "选择模型" });
    for (const model of this.models)
      new Setting(this.contentEl).setName(model).addButton((b) =>
        b.setButtonText("选择").onClick(async () => {
          await this.choose(model);
          this.close();
        }),
      );
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
