import { Modal, Notice, Setting, setIcon, type App } from "obsidian";
import {
  defaultCcSwitchDbPath,
  fetchCcSwitchProviderModels,
  fetchOpenAiCompatibleModels,
  loadCcSwitchProviders,
  nodeSqliteSupported,
  normalizeApiFormat,
  normalizeOpenAiBaseUrl,
  probeOpenAiCompatibleModel,
  resolveEffectiveAppType,
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

function icon(parent: HTMLElement, name: string, className = ""): HTMLElement {
  const element = parent.createSpan({ cls: className });
  setIcon(element, name);
  return element;
}

function actionButton(
  parent: HTMLElement,
  options: {
    label: string;
    icon: string;
    onClick: () => void;
    primary?: boolean;
    disabled?: boolean;
    tooltip?: string;
  },
): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: `ccswitch-action${options.primary ? " is-primary" : ""}`,
    attr: {
      type: "button",
      ...(options.tooltip ? { "aria-label": options.tooltip } : {}),
    },
  });
  icon(button, options.icon, "ccswitch-action-icon");
  button.createSpan({ text: options.label });
  button.disabled = options.disabled ?? false;
  button.addEventListener("click", options.onClick);
  return button;
}

function badge(
  parent: HTMLElement,
  label: string,
  tone: "accent" | "neutral" | "danger",
): void {
  parent.createSpan({ cls: `ccswitch-badge is-${tone}`, text: label });
}

function metadataField(
  parent: HTMLElement,
  label: string,
  value: string | null,
  iconName: string,
): void {
  const field = parent.createDiv({ cls: "ccswitch-meta-field" });
  const labelRow = field.createDiv({ cls: "ccswitch-meta-label" });
  icon(labelRow, iconName);
  labelRow.createSpan({ text: label });
  field.createDiv({
    cls: `ccswitch-meta-value${value ? "" : " is-empty"}`,
    text: value || "未配置",
  });
}

function providerSubtitle(provider: CcSwitchProvider): string {
  return provider.category || provider.model || provider.appType;
}

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
        .setPlaceholder("https://api.example.com/v1")
        .setValue(this.draft.baseUrl)
        .onChange((v) => {
          const trimmed = v.trim();
          try {
            this.draft.baseUrl = trimmed
              ? normalizeOpenAiBaseUrl(trimmed)
              : "";
          } catch {
            // Keep the raw value until save; valid() will reject it.
            this.draft.baseUrl = trimmed;
          }
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
          if (!this.validConnection()) return;
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
            const normalized = { ...this.draft };
            try {
              normalized.baseUrl = normalizeOpenAiBaseUrl(this.draft.baseUrl);
            } catch {
              // valid() already rejected invalid URLs; keep the raw value.
            }
            await this.save(normalized);
            this.close();
          }),
      );
  }
  /** Validate base URL + API key only (used by Discover Models). */
  private validConnection(): boolean {
    if (!this.draft.baseUrl || !this.draft.apiKey) {
      new Notice("请填写 Base URL 和 API Key");
      return false;
    }
    try {
      normalizeOpenAiBaseUrl(this.draft.baseUrl);
    } catch {
      new Notice("请填写有效的 API 根地址（不包含 /chat/completions 等路径）");
      return false;
    }
    return true;
  }

  /** Full validation for save and connection test: also requires model. */
  private valid(): boolean {
    if (!this.draft.name || !this.validConnection()) {
      return false;
    }
    if (!this.draft.model) {
      new Notice("请填写模型名称");
      return false;
    }
    return true;
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

export class CcSwitchProviderSettingsView {
  private selectedAppType = "";
  private selectedProviderId = "";
  private visibleSource: ProviderSource | null = null;
  private readonly discoveredModels = new Map<string, string[]>();
  private readonly modelDiscoveryStatus = new Map<string, string>();
  private modelLoadingKey = "";

  constructor(private readonly options: ViewOptions) {}

  showProviderList(): void {
    this.selectedAppType = "";
    this.selectedProviderId = "";
    this.visibleSource = null;
  }

  render(parent: HTMLElement): boolean {
    parent.addClass("video-memo-provider-view");
    // These legacy helpers remain below for migration compatibility with
    // older plugin state, while the active renderer uses the restored
    // directory layout above.
    void this.renderCustom;
    void this.renderCcSwitch;
    const settings = this.options.getSettings();
    const source = this.visibleSource ?? settings.providerSource;
    const section = parent.createDiv({ cls: "ccswitch-section" });

    const back = section.createDiv({ cls: "ccswitch-page-back" });
    actionButton(back, {
      label: "返回设置",
      icon: "arrow-left",
      onClick: this.options.onBack,
    });

    const heading = section.createDiv({ cls: "ccswitch-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", { text: "供应商" });
    const sourceSwitch = heading.createDiv({
      cls: "ccswitch-source-switch",
      attr: { "aria-label": "供应商配置来源" },
    });
    this.renderRichSourceButton(
      sourceSwitch,
      "cc-switch",
      "database",
      "ccswitch",
      source,
    );
    this.renderRichSourceButton(
      sourceSwitch,
      "自定义",
      "sliders-horizontal",
      "custom",
      source,
    );

    if (source === "custom") {
      this.renderRichCustom(section, settings);
      return true;
    }
    return this.renderRichCcSwitch(section, settings);
  }

  private renderRichSourceButton(
    parent: HTMLElement,
    label: string,
    iconName: string,
    source: ProviderSource,
    visibleSource: ProviderSource,
  ): void {
    const active = visibleSource === source;
    const button = parent.createEl("button", {
      cls: `ccswitch-source-button${active ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(active) },
    });
    icon(button, iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      this.visibleSource = source;
      this.selectedProviderId = "";
      void this.options
        .updateSettings({ providerSource: source })
        .then(() => this.options.rerender());
    });
  }
  private renderRichCcSwitch(
    parent: HTMLElement,
    settings: CcSwitchUiSettings,
  ): boolean {
    if (!nodeSqliteSupported()) {
      this.renderRichError(parent, "当前 Obsidian 运行时不支持 node:sqlite，请升级 Obsidian 或改用自定义供应商。");
      return true;
    }
    let response: ReturnType<typeof loadCcSwitchProviders> | null = null;
    let loadError = "";
    try {
      response = loadCcSwitchProviders(settings.ccSwitchDbPath);
    } catch (error) {
      const detail = String((error as Error | undefined)?.message ?? error).slice(0, 200);
      loadError = /lock|busy/i.test(detail)
        ? `${detail}。数据库正被其他应用占用，请稍后重试。`
        : detail;
    }
    this.renderRichDatabaseCard(parent, response?.dbPath ?? null, loadError, settings);
    if (!response) {
      this.renderRichError(parent, loadError || "无法读取 cc-switch 数据库");
      return true;
    }

    const { appType, persisted } = resolveEffectiveAppType(settings.ccSwitchAppType, response.providers);
    if (persisted) {
      void this.options.updateSettings({ ccSwitchAppType: appType, ccSwitchProviderId: "", model: "" });
    }
    const counts = new Map<string, number>();
    for (const provider of response.providers)
      counts.set(provider.appType, (counts.get(provider.appType) ?? 0) + 1);
    const appTypes = [...counts.keys()].sort((left, right) => {
      if (left === "codex") return -1;
      if (right === "codex") return 1;
      return left.localeCompare(right);
    });
    if (!this.selectedAppType || !appTypes.includes(this.selectedAppType)) this.selectedAppType = appType;
    this.renderRichTypeTabs(parent, appTypes, counts);

    const visible = response.providers.filter((provider) => provider.appType === this.selectedAppType);
    parent.createDiv({ cls: "ccswitch-provider-count", text: `共 ${visible.length} 个供应商` });
    const selected = visible.find((provider) => provider.id === this.selectedProviderId);
    if (selected) {
      this.renderRichProviderDetail(parent, selected, settings);
      return true;
    }
    this.selectedProviderId = "";
    if (!visible.length) {
      const empty = parent.createDiv({ cls: "ccswitch-empty" });
      icon(empty, "package-open");
      empty.createSpan({ text: "该类型下没有供应商" });
      return true;
    }
    const list = parent.createDiv({ cls: "ccswitch-provider-list" });
    for (const provider of visible) this.renderRichProviderRow(list, provider, settings);
    return true;
  }

  private renderRichDatabaseCard(
    parent: HTMLElement,
    connectedPath: string | null,
    loadError: string,
    settings: CcSwitchUiSettings,
  ): void {
    const card = parent.createDiv({ cls: "ccswitch-database-card" });
    const top = card.createDiv({ cls: "ccswitch-database-top" });
    const identity = top.createDiv({ cls: "ccswitch-database-identity" });
    const tile = identity.createDiv({ cls: "ccswitch-icon-tile" });
    icon(tile, "database");
    const copy = identity.createDiv({ cls: "ccswitch-database-copy" });
    const title = copy.createDiv({ cls: "ccswitch-database-title" });
    title.createSpan({ text: "cc-switch 数据库" });
    badge(title, connectedPath ? "已连接" : "未连接", connectedPath ? "accent" : "neutral");
    copy.createDiv({ cls: "ccswitch-database-description", text: "只读解析供应商配置；密钥已脱敏，留空使用默认路径。" });
    const controls = top.createDiv({ cls: "ccswitch-database-controls" });
    if (settings.ccSwitchDbPath)
      actionButton(controls, {
        label: "默认路径",
        icon: "undo-2",
        onClick: () => void this.options.updateSettings({ ccSwitchDbPath: "" }).then(() => this.options.rerender()),
      });
    actionButton(controls, { label: "刷新", icon: "refresh-cw", onClick: () => this.options.rerender() });
    const input = card.createEl("input", {
      cls: "ccswitch-database-input",
      attr: { type: "text", value: settings.ccSwitchDbPath, placeholder: "留空使用默认路径", "aria-label": "cc-switch 数据库路径" },
    });
    input.addEventListener("change", () =>
      void this.options.updateSettings({ ccSwitchDbPath: input.value.trim() }).then(() => this.options.rerender()),
    );
    card.createEl("code", {
      cls: "ccswitch-database-path",
      text: connectedPath ?? (settings.ccSwitchDbPath || defaultCcSwitchDbPath()),
      attr: { title: loadError || connectedPath || "" },
    });
  }

  private renderRichError(parent: HTMLElement, message: string): void {
    const error = parent.createDiv({ cls: "ccswitch-error" });
    icon(error, "triangle-alert");
    const copy = error.createDiv();
    copy.createEl("strong", { text: "无法读取 cc-switch" });
    copy.createDiv({ text: message });
  }

  private renderRichTypeTabs(parent: HTMLElement, appTypes: string[], counts: Map<string, number>): void {
    const tabs = parent.createDiv({ cls: "ccswitch-type-tabs" });
    for (const appType of appTypes) {
      const button = tabs.createEl("button", {
        cls: `ccswitch-type-tab${appType === this.selectedAppType ? " is-active" : ""}`,
        text: `${appType} (${counts.get(appType) ?? 0})`,
        attr: { type: "button" },
      });
      button.addEventListener("click", () => {
        this.selectedAppType = appType;
        this.selectedProviderId = "";
        void this.options.updateSettings({ ccSwitchAppType: appType, ccSwitchProviderId: "", model: "" }).then(() => this.options.rerender());
      });
    }
  }

  private isRichProviderActive(provider: CcSwitchProvider, settings: CcSwitchUiSettings): boolean {
    if (settings.providerSource !== "ccswitch" || settings.ccSwitchAppType !== provider.appType) return false;
    return settings.ccSwitchFollowCurrent ? provider.isCurrent : provider.id === settings.ccSwitchProviderId;
  }

  private renderRichProviderRow(parent: HTMLElement, provider: CcSwitchProvider, settings: CcSwitchUiSettings): void {
    const active = this.isRichProviderActive(provider, settings);
    const row = parent.createEl("button", {
      cls: `ccswitch-provider-row${active ? " is-active" : ""}`,
      attr: { type: "button", "aria-label": `查看 ${provider.name} 配置` },
    });
    const tile = row.createDiv({ cls: "ccswitch-provider-icon" });
    icon(tile, provider.usable ? "server" : "server-off");
    const copy = row.createDiv({ cls: "ccswitch-provider-row-copy" });
    copy.createDiv({ cls: "ccswitch-provider-name", text: provider.name });
    copy.createDiv({ cls: "ccswitch-provider-subtitle", text: providerSubtitle(provider) });
    const trailing = row.createDiv({ cls: "ccswitch-provider-trailing" });
    if (active) badge(trailing, "使用中", "accent");
    else if (provider.isCurrent) badge(trailing, "全局当前", "neutral");
    if (!provider.usable) badge(trailing, "配置缺失", "danger");
    icon(trailing, "chevron-right");
    row.addEventListener("click", () => {
      this.selectedProviderId = provider.id;
      this.options.rerender();
    });
  }

  private renderRichProviderDetail(parent: HTMLElement, provider: CcSwitchProvider, settings: CcSwitchUiSettings): void {
    const navigation = parent.createDiv({ cls: "ccswitch-detail-navigation" });
    actionButton(navigation, {
      label: "返回供应商",
      icon: "arrow-left",
      onClick: () => {
        this.selectedProviderId = "";
        this.options.rerender();
      },
    });
    const navigationCopy = navigation.createDiv({ cls: "ccswitch-detail-navigation-copy" });
    navigationCopy.createEl("h2", { text: provider.name });
    navigationCopy.createDiv({ text: `${provider.appType} 供应商配置` });

    const detail = parent.createDiv({ cls: "ccswitch-provider-detail" });
    const hero = detail.createDiv({ cls: "ccswitch-detail-hero" });
    const heroMain = hero.createDiv({ cls: "ccswitch-detail-main" });
    const tile = heroMain.createDiv({ cls: "ccswitch-detail-icon" });
    icon(tile, "boxes");
    const copy = heroMain.createDiv({ cls: "ccswitch-detail-copy" });
    const title = copy.createDiv({ cls: "ccswitch-detail-title" });
    title.createEl("h3", { text: provider.name });
    if (provider.isCurrent) badge(title, "全局当前", "accent");
    if (!provider.usable) badge(title, "配置不可用", "danger");
    copy.createDiv({ cls: "ccswitch-detail-notes", text: provider.notes || provider.websiteUrl || "来自 cc-switch 的供应商配置" });
    const actions = hero.createDiv({ cls: "ccswitch-detail-actions" });
    const pinned = !settings.ccSwitchFollowCurrent && settings.ccSwitchAppType === provider.appType && settings.ccSwitchProviderId === provider.id;
    actionButton(actions, {
      label: pinned ? "已固定此供应商" : "固定使用此供应商",
      icon: pinned ? "check" : "pin",
      primary: !pinned,
      disabled: pinned || !provider.usable,
      onClick: () => void this.options.updateSettings({ providerSource: "ccswitch", ccSwitchAppType: provider.appType, ccSwitchFollowCurrent: false, ccSwitchProviderId: provider.id, model: "" }).then(() => this.options.rerender()),
    });
    actionButton(actions, {
      label: "跟随全局当前",
      icon: "refresh-cw",
      disabled: settings.ccSwitchFollowCurrent && settings.ccSwitchAppType === provider.appType,
      onClick: () => void this.options.updateSettings({ providerSource: "ccswitch", ccSwitchAppType: provider.appType, ccSwitchFollowCurrent: true, ccSwitchProviderId: "", model: "" }).then(() => this.options.rerender()),
    });

    const active = this.isRichProviderActive(provider, settings);
    const modelCard = detail.createDiv({ cls: `ccswitch-model-selector${provider.usable ? "" : " is-unavailable"}` });
    const modelCopy = modelCard.createDiv({ cls: "ccswitch-model-selector-copy" });
    const modelTitle = modelCopy.createDiv({ cls: "ccswitch-section-title" });
    icon(modelTitle, "cpu");
    modelTitle.createSpan({ text: "总结模型" });
    modelCopy.createDiv({
      cls: "ccswitch-model-status",
      text: !provider.usable
        ? "供应商配置缺失，无法发现模型"
        : active
          ? provider.model
            ? `当前供应商默认模型：${provider.model}`
            : "当前供应商未提供默认模型"
          : "选择模型后将自动固定此供应商",
    });
    const modelControls = modelCard.createDiv({ cls: "ccswitch-model-controls" });
    const modelKey = this.providerModelKey(provider);
    const discovered = this.discoveredModels.get(modelKey) ?? [];
    const modelSelect = modelControls.createEl("select", {
      cls: "ccswitch-model-select",
      attr: { "aria-label": "总结模型" },
    });
    modelSelect.createEl("option", {
      text: provider.model ? `使用供应商默认（${provider.model}）` : "使用供应商默认模型",
      attr: { value: "" },
    });
    const models: string[] = [];
    for (const model of [provider.model, ...discovered]) {
      if (model && !models.includes(model)) models.push(model);
    }
    if (active && settings.model && !models.includes(settings.model)) models.unshift(settings.model);
    for (const model of models) {
      modelSelect.createEl("option", {
        text: model === settings.model && !discovered.includes(model) ? `当前覆盖：${model}` : model,
        attr: { value: model },
      });
    }
    modelSelect.value = active ? settings.model : "";
    modelSelect.disabled = !provider.usable;
    modelSelect.addEventListener("change", () =>
      void this.options.updateSettings({
        providerSource: "ccswitch",
        ccSwitchAppType: provider.appType,
        ccSwitchFollowCurrent: false,
        ccSwitchProviderId: provider.id,
        model: modelSelect.value,
      }).then(() => this.options.rerender()),
    );
    const loading = this.modelLoadingKey === modelKey;
    actionButton(modelControls, {
      label: loading ? "发现中…" : discovered.length ? "刷新模型" : "发现模型",
      icon: "refresh-cw",
      disabled: !provider.usable || loading,
      onClick: () => {
        this.modelLoadingKey = modelKey;
        this.modelDiscoveryStatus.delete(modelKey);
        this.options.rerender();
        void fetchCcSwitchProviderModels({ dbPath: settings.ccSwitchDbPath, appType: provider.appType, providerId: provider.id })
          .then((response) => {
            if (!response.models.length) {
              const message = "服务未返回可解析的模型列表，当前仅显示供应商默认模型";
              this.modelDiscoveryStatus.set(modelKey, message);
              new Notice(message);
              return;
            }
            this.discoveredModels.set(modelKey, response.models);
            this.modelDiscoveryStatus.set(modelKey, `已发现 ${response.models.length} 个可选模型`);
          })
          .catch((error) => {
            const detail = error instanceof Error ? error.message : "模型接口请求失败";
            const message = `${detail}；当前仅显示供应商默认模型`;
            this.modelDiscoveryStatus.set(modelKey, message);
            new Notice(message);
          })
          .finally(() => {
            if (this.modelLoadingKey === modelKey) this.modelLoadingKey = "";
            this.options.rerender();
          });
      },
    });
    const discoveryStatus = this.modelDiscoveryStatus.get(modelKey);
    if (discoveryStatus)
      modelCard.createDiv({ cls: "ccswitch-model-discovery-status", text: discoveryStatus });
    const metadata = detail.createDiv({ cls: "ccswitch-metadata-grid" });
    metadataField(metadata, "应用类型", provider.appType, "terminal");
    metadataField(metadata, "Base URL", provider.baseUrl, "link-2");
    metadataField(metadata, "模型", provider.model, "cpu");
    metadataField(metadata, "API Key", provider.usable ? "已配置" : "缺失", "key-round");
  }

  private providerModelKey(provider: CcSwitchProvider): string {
    return `${provider.appType}\u0000${provider.id}`;
  }

  private renderRichCustom(parent: HTMLElement, settings: CcSwitchUiSettings): void {
    const card = parent.createDiv({ cls: "ccswitch-custom-card" });
    const heading = card.createDiv({ cls: "ccswitch-custom-heading" });
    const title = heading.createDiv({ cls: "ccswitch-section-title" });
    icon(title, "sliders-horizontal");
    title.createSpan({ text: "自定义供应商" });
    actionButton(heading, { label: "添加供应商", icon: "plus", primary: true, onClick: () => this.openEditor(null) });
    if (!settings.customProviders.length) {
      const empty = card.createDiv({ cls: "ccswitch-empty" });
      icon(empty, "package-open");
      empty.createSpan({ text: "尚未添加供应商" });
      return;
    }
    const list = card.createDiv({ cls: "ccswitch-custom-provider-list" });
    for (const provider of settings.customProviders) {
      const active = provider.id === settings.activeCustomProviderId;
      const row = list.createDiv({ cls: "ccswitch-custom-provider-entry" });
      const copy = row.createDiv({ cls: "ccswitch-custom-provider-entry-copy" });
      copy.createDiv({ cls: "ccswitch-custom-provider-entry-name", text: provider.name.trim() || "未命名供应商" });
      copy.createDiv({ cls: "ccswitch-custom-provider-entry-sub", text: `${provider.model || "尚未选择模型"} · ${displayBaseUrl(provider.baseUrl)} · ${maskedKey(provider.apiKey)}` });
      if (active) badge(row, "使用中", "accent");
      const actions = row.createDiv({ cls: "ccswitch-custom-provider-entry-actions" });
      actionButton(actions, { label: active ? "使用中" : "使用", icon: active ? "check" : "play", primary: !active, disabled: active, onClick: () => void this.options.updateSettings({ providerSource: "custom", activeCustomProviderId: provider.id }).then(() => this.options.rerender()) });
      actionButton(actions, { label: "编辑", icon: "pencil", onClick: () => this.openEditor(provider) });
      actionButton(actions, { label: "删除", icon: "trash-2", onClick: () => {
        const remaining = settings.customProviders.filter((item) => item.id !== provider.id);
        const activeId = settings.activeCustomProviderId === provider.id ? remaining[0]?.id || "" : settings.activeCustomProviderId;
        void this.options.updateSettings({ customProviders: remaining, activeCustomProviderId: activeId }).then(() => this.options.rerender());
      } });
    }
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
    if (!nodeSqliteSupported()) {
      parent.createEl("p", {
        cls: "video-memo-provider-error",
        text:
          "当前 Obsidian 运行时不支持 node:sqlite，无法读取 cc-switch 数据库。" +
          "请安装 Obsidian 1.9.10 或更新版本的安装器，或改用自定义供应商。",
      });
      return;
    }
    let providers: CcSwitchProvider[];
    try {
      providers = loadCcSwitchProviders(settings.ccSwitchDbPath).providers;
    } catch (error) {
      // Surface the real reason: "database is locked" (another app holds the
      // file) looks completely different from a wrong path and used to hide
      // behind the same generic message.
      const detail = String((error as Error | undefined)?.message ?? error)
        .slice(0, 200);
      const hint = /lock|busy/i.test(detail)
        ? "数据库正被其他应用占用（例如 cc-switch 正在写入），请稍后重试。"
        : "请检查路径或 Obsidian 版本。";
      parent.createEl("p", {
        cls: "video-memo-provider-error",
        text: `无法读取数据库：${detail}。${hint}`,
      });
      return;
    }
    const { appType, persisted } = resolveEffectiveAppType(
      settings.ccSwitchAppType,
      providers,
    );
    // Persist the resolved app type so the settings badge and startEngine
    // agree with the type actually shown in the provider list.
    if (persisted) {
      void this.options.updateSettings({
        ccSwitchAppType: appType,
        ccSwitchProviderId: "",
        model: "",
      });
    }
    const appTypes = [...new Set(providers.map((x) => x.appType))];
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
    new Setting(parent)
      .setClass("video-memo-provider-list-header")
      .setName("可用供应商")
      .setDesc(
        `${list.length} 个 ${appType} 供应商` +
          (settings.ccSwitchFollowCurrent
            ? ` · 全局当前：${list.find((x) => x.isCurrent)?.name || "未设置"}`
            : " · 关闭跟随后可固定选择"),
      );
    for (const provider of list) {
      const isSelected =
        (settings.ccSwitchFollowCurrent && provider.isCurrent) ||
        (!settings.ccSwitchFollowCurrent &&
          provider.id === settings.ccSwitchProviderId);
      const state = [
        provider.isCurrent ? "全局当前" : "",
        isSelected ? "任务使用" : "",
        provider.usable ? "已配置" : "配置缺失",
      ].filter(Boolean);
      const providerSetting = new Setting(parent)
        .setClass("video-memo-provider-option")
        .setName(provider.name)
        .setDesc(
          `${state.join(" · ")} · ${displayBaseUrl(provider.baseUrl || "")} · ${provider.model || "默认模型"}`,
        );
      if (isSelected) providerSetting.settingEl.addClass("is-selected");
    }
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
