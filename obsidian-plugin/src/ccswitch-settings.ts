import { Notice, setIcon, type App } from "obsidian";

import {
  defaultCcSwitchDbPath,
  loadCcSwitchProviders,
  type CcSwitchProvider,
} from "./ccswitch";

export interface CcSwitchUiSettings {
  providerSource: "ccswitch" | "environment";
  ccSwitchDbPath: string;
  ccSwitchAppType: string;
  ccSwitchFollowCurrent: boolean;
  ccSwitchProviderId: string;
  model: string;
}

interface ViewOptions {
  app: App;
  getSettings: () => CcSwitchUiSettings;
  updateSettings: (patch: Partial<CcSwitchUiSettings>) => Promise<void>;
  rerender: () => void;
}

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

function badge(parent: HTMLElement, label: string, tone: "accent" | "neutral" | "danger"): void {
  parent.createSpan({
    cls: `ccswitch-badge is-${tone}`,
    text: label,
  });
}

function metadataField(parent: HTMLElement, label: string, value: string | null, iconName: string): void {
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

export class CcSwitchProviderSettingsView {
  private readonly options: ViewOptions;
  private selectedAppType = "codex";
  private selectedProviderId = "";
  private configTab: "parsed" | "raw" = "parsed";

  constructor(options: ViewOptions) {
    this.options = options;
  }

  showProviderList(): void {
    this.selectedProviderId = "";
    this.configTab = "parsed";
  }

  render(parent: HTMLElement): boolean {
    const settings = this.options.getSettings();
    const section = parent.createDiv({ cls: "ccswitch-section" });

    let response: ReturnType<typeof loadCcSwitchProviders> | null = null;
    let loadError = "";
    try {
      response = loadCcSwitchProviders(settings.ccSwitchDbPath);
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }

    const selectedProvider = response?.providers.find(
      (provider) => provider.id === this.selectedProviderId,
    );
    if (selectedProvider && response) {
      this.selectedAppType = selectedProvider.appType;
      this.renderDetailNavigation(section, selectedProvider);
      const modelOptions = response.providers
        .filter((provider) => provider.appType === selectedProvider.appType)
        .map((provider) => provider.model)
        .filter((model): model is string => Boolean(model));
      const detail = section.createDiv({ cls: "ccswitch-provider-detail" });
      this.renderProviderDetail(detail, selectedProvider, settings, modelOptions);
      return true;
    }
    if (this.selectedProviderId) this.showProviderList();

    const heading = section.createDiv({ cls: "ccswitch-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", { text: "供应商 (cc-switch)" });
    headingCopy.createEl("p", {
      text: "只读解析本机 cc-switch 数据库，选择视频总结任务使用的 API 供应商。",
    });
    const sourceSwitch = heading.createDiv({
      cls: "ccswitch-source-switch",
      attr: { "aria-label": "供应商配置来源" },
    });
    this.renderSourceButton(sourceSwitch, "cc-switch", "database", "ccswitch");
    this.renderSourceButton(sourceSwitch, "环境配置", "file-cog", "environment");

    this.renderDatabaseCard(section, response?.dbPath ?? null, loadError);
    if (!response) {
      this.renderError(section, loadError);
      return false;
    }

    const counts = new Map<string, number>();
    for (const provider of response.providers) {
      counts.set(provider.appType, (counts.get(provider.appType) ?? 0) + 1);
    }
    const appTypes = [...counts.keys()].sort((left, right) => {
      if (left === "codex") return -1;
      if (right === "codex") return 1;
      return left.localeCompare(right);
    });
    if (!appTypes.includes(this.selectedAppType)) {
      this.selectedAppType = appTypes.includes(settings.ccSwitchAppType)
        ? settings.ccSwitchAppType
        : appTypes[0] ?? "codex";
    }
    this.renderTypeTabs(section, appTypes, counts);

    const visibleProviders = response.providers.filter(
      (provider) => provider.appType === this.selectedAppType,
    );
    section.createDiv({
      cls: "ccswitch-provider-count",
      text: `共 ${visibleProviders.length} 个供应商`,
    });
    if (visibleProviders.length === 0) {
      const empty = section.createDiv({ cls: "ccswitch-empty" });
      icon(empty, "package-open");
      empty.createSpan({ text: "该类型下没有供应商" });
      return false;
    }

    const list = section.createDiv({ cls: "ccswitch-provider-list" });
    for (const provider of visibleProviders) {
      this.renderProviderRow(list, provider, settings);
    }
    return false;
  }

  private renderDetailNavigation(parent: HTMLElement, provider: CcSwitchProvider): void {
    const navigation = parent.createDiv({ cls: "ccswitch-detail-navigation" });
    actionButton(navigation, {
      label: "返回供应商",
      icon: "arrow-left",
      onClick: () => {
        this.showProviderList();
        this.options.rerender();
      },
    });
    const copy = navigation.createDiv({ cls: "ccswitch-detail-navigation-copy" });
    copy.createEl("h2", { text: provider.name });
    copy.createDiv({ text: `${provider.appType} 供应商配置` });
  }

  private renderSourceButton(
    parent: HTMLElement,
    label: string,
    iconName: string,
    source: "ccswitch" | "environment",
  ): void {
    const active = this.options.getSettings().providerSource === source;
    const button = parent.createEl("button", {
      cls: `ccswitch-source-button${active ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(active) },
    });
    icon(button, iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      void this.options.updateSettings({ providerSource: source }).then(() => {
        this.options.rerender();
      });
    });
  }

  private renderDatabaseCard(
    parent: HTMLElement,
    connectedPath: string | null,
    loadError: string,
  ): void {
    const settings = this.options.getSettings();
    const card = parent.createDiv({ cls: "ccswitch-database-card" });
    const top = card.createDiv({ cls: "ccswitch-database-top" });
    const identity = top.createDiv({ cls: "ccswitch-database-identity" });
    const tile = identity.createDiv({ cls: "ccswitch-icon-tile" });
    icon(tile, "database");
    const copy = identity.createDiv({ cls: "ccswitch-database-copy" });
    const title = copy.createDiv({ cls: "ccswitch-database-title" });
    title.createSpan({ text: "cc-switch 数据库" });
    badge(title, connectedPath ? "已连接" : "未连接", connectedPath ? "accent" : "neutral");
    copy.createDiv({
      cls: "ccswitch-database-description",
      text: "只读解析供应商配置；密钥已脱敏，留空使用默认路径。",
    });
    const controls = top.createDiv({ cls: "ccswitch-database-controls" });
    const fileInput = card.createEl("input", {
      cls: "ccswitch-hidden-input",
      attr: { type: "file", accept: ".db" },
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const electron = require("electron") as {
        webUtils?: { getPathForFile: (selected: File) => string };
      };
      const path =
        electron.webUtils?.getPathForFile(file) ??
        (file as File & { path?: string }).path ??
        "";
      if (!path) {
        new Notice("无法读取所选数据库的本地路径");
        return;
      }
      void this.options.updateSettings({ ccSwitchDbPath: path }).then(() => {
        this.selectedProviderId = "";
        this.options.rerender();
      });
    });
    actionButton(controls, {
      label: "选择文件",
      icon: "folder-open",
      onClick: () => fileInput.click(),
    });
    if (settings.ccSwitchDbPath) {
      actionButton(controls, {
        label: "默认路径",
        icon: "undo-2",
        onClick: () => {
          void this.options.updateSettings({ ccSwitchDbPath: "" }).then(() => {
            this.selectedProviderId = "";
            this.options.rerender();
          });
        },
      });
    }
    actionButton(controls, {
      label: "刷新",
      icon: "refresh-cw",
      onClick: () => this.options.rerender(),
    });
    card.createEl("code", {
      cls: "ccswitch-database-path",
      text: connectedPath ?? (settings.ccSwitchDbPath || defaultCcSwitchDbPath()),
      attr: { title: loadError || connectedPath || "" },
    });
  }

  private renderError(parent: HTMLElement, message: string): void {
    const error = parent.createDiv({ cls: "ccswitch-error" });
    icon(error, "triangle-alert");
    const text = error.createDiv();
    text.createEl("strong", { text: "无法读取 cc-switch" });
    text.createDiv({ text: message || "未知错误" });
  }

  private renderTypeTabs(
    parent: HTMLElement,
    appTypes: string[],
    counts: Map<string, number>,
  ): void {
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
        this.options.rerender();
      });
    }
  }

  private isProviderActive(provider: CcSwitchProvider, settings: CcSwitchUiSettings): boolean {
    if (settings.providerSource !== "ccswitch") return false;
    if (settings.ccSwitchAppType !== provider.appType) return false;
    return settings.ccSwitchFollowCurrent
      ? provider.isCurrent
      : provider.id === settings.ccSwitchProviderId;
  }

  private renderProviderRow(
    parent: HTMLElement,
    provider: CcSwitchProvider,
    settings: CcSwitchUiSettings,
  ): void {
    const row = parent.createEl("button", {
      cls: "ccswitch-provider-row",
      attr: { type: "button", "aria-label": `查看 ${provider.name} 配置` },
    });
    const tile = row.createDiv({ cls: "ccswitch-provider-icon" });
    icon(tile, provider.usable ? "server" : "server-off");
    const copy = row.createDiv({ cls: "ccswitch-provider-row-copy" });
    copy.createDiv({ cls: "ccswitch-provider-name", text: provider.name });
    copy.createDiv({ cls: "ccswitch-provider-subtitle", text: providerSubtitle(provider) });
    const trailing = row.createDiv({ cls: "ccswitch-provider-trailing" });
    if (this.isProviderActive(provider, settings)) badge(trailing, "使用中", "accent");
    else if (provider.isCurrent) badge(trailing, "全局当前", "neutral");
    icon(trailing, "chevron-right");
    row.addEventListener("click", () => {
      this.selectedProviderId = provider.id;
      this.configTab = "parsed";
      this.options.rerender();
    });
  }

  private renderProviderDetail(
    parent: HTMLElement,
    provider: CcSwitchProvider,
    settings: CcSwitchUiSettings,
    modelOptions: string[],
  ): void {
    const hero = parent.createDiv({ cls: "ccswitch-detail-hero" });
    const heroMain = hero.createDiv({ cls: "ccswitch-detail-main" });
    const tile = heroMain.createDiv({ cls: "ccswitch-detail-icon" });
    icon(tile, "boxes");
    const copy = heroMain.createDiv({ cls: "ccswitch-detail-copy" });
    const title = copy.createDiv({ cls: "ccswitch-detail-title" });
    title.createEl("h3", { text: provider.name });
    if (provider.isCurrent) badge(title, "全局当前", "accent");
    if (!provider.usable) badge(title, "配置不可用", "danger");
    copy.createDiv({
      cls: "ccswitch-detail-notes",
      text: provider.notes || provider.websiteUrl || "来自 cc-switch 的供应商配置",
    });
    const actions = hero.createDiv({ cls: "ccswitch-detail-actions" });
    const pinned =
      settings.providerSource === "ccswitch" &&
      !settings.ccSwitchFollowCurrent &&
      settings.ccSwitchAppType === provider.appType &&
      settings.ccSwitchProviderId === provider.id;
    actionButton(actions, {
      label: pinned ? "已固定此供应商" : "固定使用此供应商",
      icon: pinned ? "check" : "pin",
      primary: !pinned,
      disabled: pinned || !provider.usable,
      onClick: () => {
        void this.options
          .updateSettings({
            providerSource: "ccswitch",
            ccSwitchAppType: provider.appType,
            ccSwitchFollowCurrent: false,
            ccSwitchProviderId: provider.id,
          })
          .then(() => this.options.rerender());
      },
    });
    actionButton(actions, {
      label: "跟随全局当前",
      icon: "refresh-cw",
      disabled:
        settings.providerSource === "ccswitch" &&
          settings.ccSwitchFollowCurrent &&
          settings.ccSwitchAppType === provider.appType,
      onClick: () => {
        void this.options
          .updateSettings({
            providerSource: "ccswitch",
            ccSwitchAppType: provider.appType,
            ccSwitchFollowCurrent: true,
            ccSwitchProviderId: "",
          })
          .then(() => this.options.rerender());
      },
    });

    this.renderModelSelector(parent, provider, settings, modelOptions);

    const metadata = parent.createDiv({ cls: "ccswitch-metadata-grid" });
    metadataField(metadata, "CLI 类型", provider.appType, "terminal");
    metadataField(metadata, "Base URL", provider.baseUrl, "link-2");
    metadataField(metadata, "模型", provider.model, "cpu");
    metadataField(metadata, "API 格式", provider.apiFormat, "braces");

    const envSection = parent.createDiv({ cls: "ccswitch-detail-section" });
    const envTitle = envSection.createDiv({ cls: "ccswitch-section-title" });
    icon(envTitle, "key-round");
    envTitle.createSpan({ text: "环境变量" });
    const envEntries = Object.entries(provider.maskedEnv);
    if (envEntries.length === 0) {
      envSection.createDiv({ cls: "ccswitch-muted", text: "没有可显示的环境变量" });
    } else {
      const envGrid = envSection.createDiv({ cls: "ccswitch-env-grid" });
      for (const [key, value] of envEntries) {
        const card = envGrid.createDiv({ cls: "ccswitch-env-card" });
        card.createDiv({ cls: "ccswitch-env-key", text: key });
        card.createEl("code", { text: value });
      }
    }

    const configSection = parent.createDiv({ cls: "ccswitch-detail-section" });
    const configTitle = configSection.createDiv({ cls: "ccswitch-section-title" });
    icon(configTitle, "braces");
    configTitle.createSpan({ text: "配置" });
    const tabs = configSection.createDiv({ cls: "ccswitch-config-tabs" });
    this.renderConfigTab(tabs, "解析结果", "parsed");
    this.renderConfigTab(tabs, "供应商配置", "raw");
    const parsedConfig = JSON.stringify(
      {
        baseUrl: provider.baseUrl,
        model: provider.model,
        apiFormat: provider.apiFormat,
        environment: provider.maskedEnv,
      },
      null,
      2,
    );
    const content = this.configTab === "parsed" ? parsedConfig : provider.redactedSettingsConfig;
    const codeHeader = configSection.createDiv({ cls: "ccswitch-code-header" });
    codeHeader.createSpan({
      text: this.configTab === "parsed" ? "插件实际使用的解析结果" : "密钥已脱敏",
    });
    const copyButton = codeHeader.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": "复制配置" },
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(content).then(() => new Notice("配置已复制"));
    });
    configSection.createEl("pre", { cls: "ccswitch-code-block", text: content });
  }

  private renderModelSelector(
    parent: HTMLElement,
    provider: CcSwitchProvider,
    settings: CcSwitchUiSettings,
    models: string[],
  ): void {
    const card = parent.createDiv({ cls: "ccswitch-model-selector" });
    const copy = card.createDiv({ cls: "ccswitch-model-selector-copy" });
    const title = copy.createDiv({ cls: "ccswitch-section-title" });
    icon(title, "cpu");
    title.createSpan({ text: "总结模型" });
    copy.createDiv({
      cls: "ccswitch-muted",
      text: provider.model
        ? `默认跟随 ${provider.name}：${provider.model}`
        : `该供应商未声明默认模型`,
    });

    const select = card.createEl("select", {
      cls: "dropdown ccswitch-model-dropdown",
      attr: { "aria-label": "选择总结模型" },
    });
    select.createEl("option", {
      value: "",
      text: provider.model ? `跟随供应商默认 (${provider.model})` : "跟随供应商默认",
    });
    const options = [...new Set([...models, settings.model].filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
    for (const model of options) {
      select.createEl("option", { value: model, text: model });
    }
    select.value = settings.model;
    select.addEventListener("change", () => {
      void this.options.updateSettings({ model: select.value });
    });
  }

  private renderConfigTab(
    parent: HTMLElement,
    label: string,
    value: "parsed" | "raw",
  ): void {
    const button = parent.createEl("button", {
      cls: `ccswitch-config-tab${this.configTab === value ? " is-active" : ""}`,
      text: label,
      attr: { type: "button" },
    });
    button.addEventListener("click", () => {
      this.configTab = value;
      this.options.rerender();
    });
  }
}
