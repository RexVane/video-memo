import { Notice, setIcon, type App } from "obsidian";

import {
  defaultCcSwitchDbPath,
  fetchCcSwitchProviderModels,
  fetchOpenAiCompatibleModels,
  loadCcSwitchProviders,
  normalizeOpenAiBaseUrl,
  probeOpenAiCompatibleModel,
  type CcSwitchProvider,
} from "./ccswitch";

export type ProviderSource = "ccswitch" | "custom";
export type CustomProviderApiFormat = "anthropic_messages" | "chat_completions" | "responses";

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

interface ProviderModelState {
  requestId: number;
  status: "loading" | "loaded" | "error";
  models: string[];
  endpoint: string;
  error: string;
  probeStatus: "idle" | "probing" | "probed" | "probe_error";
  probeError: string;
}

interface CustomProviderDraft {
  id: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat: CustomProviderApiFormat;
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
  private visibleSource: ProviderSource | null = null;
  private configTab: "parsed" | "raw" = "parsed";
  private rawDetailExpanded = false;
  private readonly providerModelStates = new Map<string, ProviderModelState>();
  private readonly customModelStates = new Map<string, ProviderModelState>();
  private customDraft: CustomProviderDraft | null = null;
  private modelRequestId = 0;

  constructor(options: ViewOptions) {
    this.options = options;
  }

  showProviderList(): void {
    this.selectedProviderId = "";
    this.visibleSource = null;
    this.customDraft = null;
    this.customModelStates.clear();
    this.configTab = "parsed";
    this.rawDetailExpanded = false;
  }

  private customModelStateKey(draftId: string | null): string {
    return draftId ?? "__new_custom_provider__";
  }

  private customModelStateFor(draftId: string | null): ProviderModelState | null {
    return this.customModelStates.get(this.customModelStateKey(draftId)) ?? null;
  }

  private setCustomModelState(draftId: string | null, state: ProviderModelState): void {
    this.customModelStates.set(this.customModelStateKey(draftId), state);
  }

  render(parent: HTMLElement): boolean {
    const settings = this.options.getSettings();
    const source = this.visibleSource ?? settings.providerSource;
    const section = parent.createDiv({ cls: "ccswitch-section" });

    let response: ReturnType<typeof loadCcSwitchProviders> | null = null;
    let loadError = "";
    if (source === "ccswitch") {
      try {
        response = loadCcSwitchProviders(settings.ccSwitchDbPath);
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
      }
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
      const modelState = this.ensureProviderModels(selectedProvider);
      const detail = section.createDiv({ cls: "ccswitch-provider-detail" });
      this.renderProviderDetail(detail, selectedProvider, settings, modelOptions, modelState);
      return true;
    }
    if (this.selectedProviderId) this.selectedProviderId = "";

    const back = section.createDiv({ cls: "ccswitch-page-back" });
    actionButton(back, {
      label: "返回设置",
      icon: "arrow-left",
      onClick: () => {
        this.showProviderList();
        this.options.onBack();
      },
    });

    const heading = section.createDiv({ cls: "ccswitch-heading" });
    const headingCopy = heading.createDiv();
    headingCopy.createEl("h2", { text: "供应商" });
    const sourceSwitch = heading.createDiv({
      cls: "ccswitch-source-switch",
      attr: { "aria-label": "供应商配置来源" },
    });
    this.renderSourceButton(sourceSwitch, "cc-switch", "database", "ccswitch", source);
    this.renderSourceButton(sourceSwitch, "自定义", "sliders-horizontal", "custom", source);

    if (source === "custom") {
      this.renderCustomProvider(section, settings);
      return false;
    }

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
      this.selectedProviderId = "";
      this.visibleSource = source;
      if (source === "custom") {
        this.customDraft = null;
        void this.options.updateSettings({ providerSource: "custom" }).then(() => {
          this.options.rerender();
        });
        return;
      }
      void this.options.updateSettings({ providerSource: source }).then(() => {
        this.options.rerender();
      });
    });
  }

  private customDraftFromSettings(): CustomProviderDraft {
    const settings = this.options.getSettings();
    const active =
      settings.customProviders.find((p) => p.id === settings.activeCustomProviderId) ??
      settings.customProviders[0];
    if (active) {
      return {
        id: active.id,
        name: active.name,
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
        model: active.model,
        apiFormat: active.apiFormat,
      };
    }
    return {
      id: null,
      name: "",
      baseUrl: "",
      apiKey: "",
      model: "",
      apiFormat: "chat_completions",
    };
  }

  private renderCustomProvider(parent: HTMLElement, settings: CcSwitchUiSettings): void {
    const card = parent.createDiv({ cls: "ccswitch-custom-card" });
    const heading = card.createDiv({ cls: "ccswitch-custom-heading" });
    const title = heading.createDiv({ cls: "ccswitch-section-title" });
    icon(title, "sliders-horizontal");
    title.createSpan({ text: "自定义供应商" });
    actionButton(heading, {
      label: "添加供应商",
      icon: "plus",
      onClick: () => {
        this.customModelStates.delete(this.customModelStateKey(null));
        this.customDraft = {
          id: null,
          name: "",
          baseUrl: "",
          apiKey: "",
          model: "",
          apiFormat: "chat_completions",
        };
        this.options.rerender();
      },
    });

    // Provider list
    const providers = settings.customProviders;
    if (providers.length > 0) {
      const list = card.createDiv({ cls: "ccswitch-custom-provider-list" });
      for (const provider of providers) {
        this.renderCustomProviderRow(list, provider, settings);
      }
    }

    // Edit form (draft)
    const draft = this.customDraft ?? this.customDraftFromSettings();
    this.renderCustomProviderForm(card, draft, settings);
  }

  private renderCustomProviderRow(
    parent: HTMLElement,
    provider: CustomProviderConfig,
    settings: CcSwitchUiSettings,
  ): void {
    const row = parent.createDiv({ cls: "ccswitch-custom-provider-entry" });
    const isActive =
      settings.providerSource === "custom" &&
      settings.activeCustomProviderId === provider.id;
    const copy = row.createDiv({ cls: "ccswitch-custom-provider-entry-copy" });
    copy.createDiv({
      cls: "ccswitch-custom-provider-entry-name",
      text: provider.name.trim() || "未命名供应商",
    });
    const subtitle = provider.model.trim() || "尚未选择模型";
    const formatLabel =
      provider.apiFormat === "anthropic_messages"
        ? "Anthropic"
        : provider.apiFormat === "responses"
          ? "Responses"
          : "Chat";
    copy.createDiv({
      cls: "ccswitch-custom-provider-entry-sub",
      text: `${subtitle} · ${formatLabel}`,
    });
    if (isActive) badge(row, "使用中", "accent");
    const trailing = row.createDiv({ cls: "ccswitch-custom-provider-entry-actions" });
    actionButton(trailing, {
      label: isActive ? "使用中" : "使用",
      icon: isActive ? "check" : "play",
      primary: !isActive,
      disabled: isActive,
      onClick: () => this.activateExistingProvider(provider.id),
    });
    actionButton(trailing, {
      label: "编辑",
      icon: "pencil",
      onClick: () => {
        this.customDraft = {
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          apiFormat: provider.apiFormat,
        };
        this.options.rerender();
      },
    });
    actionButton(trailing, {
      label: "删除",
      icon: "trash-2",
      onClick: () => this.deleteCustomProvider(provider.id),
    });
    row.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      this.customDraft = {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        apiFormat: provider.apiFormat,
      };
      this.options.rerender();
    });
  }

  private renderCustomProviderForm(
    parent: HTMLElement,
    draft: CustomProviderDraft,
    settings: CcSwitchUiSettings,
  ): void {
    const form = parent.createDiv({ cls: "ccswitch-custom-form" });
    const formTitle = form.createDiv({ cls: "ccswitch-custom-form-title" });
    formTitle.createSpan({
      text: draft.id ? "编辑供应商" : "新供应商",
    });

    const modelState = this.customModelStateFor(draft.id);
    const status = form.createDiv({
      cls: `ccswitch-custom-status${
        modelState?.status === "loaded"
          ? " is-success"
          : modelState?.status === "error"
            ? " is-error"
            : ""
      }`,
      text: this.customStatusText(draft.id),
    });
    let discoveredModelSelect: HTMLSelectElement | null = null;
    const invalidateTest = (): void => {
      this.customModelStates.delete(this.customModelStateKey(draft.id));
      status.className = "ccswitch-custom-status is-warning";
      status.setText("配置已更改，请重新测试连接");
      if (discoveredModelSelect) {
        discoveredModelSelect.empty();
        discoveredModelSelect.createEl("option", {
          value: "",
          text: "刷新后可选择模型",
        });
        discoveredModelSelect.value = "";
        discoveredModelSelect.disabled = true;
      }
    };

    this.renderCustomTextField(form, {
      label: "供应商名称",
      value: draft.name,
      placeholder: "例如：My API",
      onInput: (value) => {
        draft.name = value;
      },
    });
    this.renderCustomTextField(form, {
      label: "API Base URL",
      value: draft.baseUrl,
      placeholder: "https://example.com/v1",
      onInput: (value) => {
        draft.baseUrl = value;
        invalidateTest();
      },
    });
    if (this.isUntrustedHttpUrl(draft.baseUrl)) {
      form.createDiv({
        cls: "ccswitch-custom-status is-warning",
        text: "远程 HTTP 会明文传输 API Key；请改用可信 HTTPS。localhost HTTP 不受此限制。",
      });
    }

    const keyField = form.createDiv({ cls: "ccswitch-custom-field" });
    keyField.createEl("label", { text: "API Key" });
    const keyRow = keyField.createDiv({ cls: "ccswitch-custom-password-row" });
    const keyInput = keyRow.createEl("input", {
      attr: {
        type: "password",
        value: draft.apiKey,
        placeholder: "sk-...",
        autocomplete: "off",
        "aria-label": "自定义供应商 API Key",
      },
    });
    keyInput.addEventListener("input", () => {
      draft.apiKey = keyInput.value;
      invalidateTest();
    });
    const reveal = keyRow.createEl("button", {
      cls: "clickable-icon ccswitch-custom-key-toggle",
      attr: { type: "button", "aria-label": "显示 API Key", "aria-pressed": "false" },
    });
    setIcon(reveal, "eye");
    reveal.addEventListener("click", () => {
      const visible = keyInput.type === "text";
      keyInput.type = visible ? "password" : "text";
      reveal.setAttribute("aria-label", visible ? "显示 API Key" : "隐藏 API Key");
      reveal.setAttribute("aria-pressed", String(!visible));
      setIcon(reveal, visible ? "eye" : "eye-off");
    });
    keyField.createDiv({
      cls: "ccswitch-custom-hint is-warning",
      text: "API Key 会明文保存在当前 Vault 的插件 data.json；不会写入日志或命令行。",
    });

    const formatField = form.createDiv({ cls: "ccswitch-custom-field" });
    formatField.createEl("label", { text: "API 格式" });
    const formatSelect = formatField.createEl("select", {
      cls: "dropdown ccswitch-custom-select",
      attr: { "aria-label": "选择 API 格式" },
    });
    formatSelect.createEl("option", { value: "anthropic_messages", text: "Anthropic Messages" });
    formatSelect.createEl("option", { value: "chat_completions", text: "Chat Completions" });
    formatSelect.createEl("option", { value: "responses", text: "Responses API" });
    formatSelect.value = draft.apiFormat;
    formatSelect.addEventListener("change", () => {
      draft.apiFormat = formatSelect.value === "responses" ? "responses" : "chat_completions";
      invalidateTest();
    });

    const modelField = form.createDiv({ cls: "ccswitch-custom-field" });
    modelField.createEl("label", { text: "模型" });
    const modelRow = modelField.createDiv({ cls: "ccswitch-custom-model-controls" });
    const models = modelState?.status === "loaded" ? modelState.models : [];
    const modelSelect = modelRow.createEl("select", {
      cls: "dropdown ccswitch-custom-model-select",
      attr: { "aria-label": "选择已发现模型" },
    });
    discoveredModelSelect = modelSelect;
    modelSelect.createEl("option", {
      value: "",
      text: models.length > 0 ? "选择已发现模型…" : "刷新后可选择模型",
    });
    for (const model of models) {
      modelSelect.createEl("option", { value: model, text: model });
    }
    modelSelect.disabled = models.length === 0;
    modelSelect.value = models.includes(draft.model) ? draft.model : "";

    const modelInput = modelRow.createEl("input", {
      cls: "ccswitch-custom-model-input",
      attr: {
        type: "text",
        value: draft.model,
        placeholder: "也可手动输入模型名称",
        "aria-label": "手动输入自定义供应商模型",
      },
    });
    modelSelect.addEventListener("change", () => {
      if (!modelSelect.value) return;
      draft.model = modelSelect.value;
      modelInput.value = modelSelect.value;
    });
    modelInput.addEventListener("input", () => {
      draft.model = modelInput.value;
      modelSelect.value = models.includes(modelInput.value) ? modelInput.value : "";
    });

    const actions = form.createDiv({ cls: "ccswitch-custom-action-row" });
    const loading = modelState?.status === "loading";
    actionButton(actions, {
      label: loading ? "连接中..." : "刷新模型",
      icon: loading ? "loader-circle" : "refresh-cw",
      disabled: loading,
      onClick: () => this.startCustomModelRequest(false),
    });
    actionButton(actions, {
      label: loading ? "测试中..." : "测试连接",
      icon: loading ? "loader-circle" : "plug-zap",
      disabled: loading,
      onClick: () => this.startCustomModelRequest(true),
    });
    actionButton(actions, {
      label: draft.id ? "保存并使用" : "添加并使用",
      icon: "check",
      primary: true,
      onClick: () => this.saveCustomProvider(),
    });
  }

  private renderCustomTextField(
    parent: HTMLElement,
    options: {
      label: string;
      value: string;
      placeholder: string;
      onInput: (value: string) => void;
    },
  ): void {
    const field = parent.createDiv({ cls: "ccswitch-custom-field" });
    field.createEl("label", { text: options.label });
    const input = field.createEl("input", {
      attr: { type: "text", value: options.value, placeholder: options.placeholder },
    });
    input.addEventListener("input", () => options.onInput(input.value));
  }

  private isUntrustedHttpUrl(value: string): boolean {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "http:") return false;
      return !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  private customStatusText(draftId: string | null): string {
    const state = this.customModelStateFor(draftId);
    if (!state) return "尚未测试连接";
    if (state.status === "loading") return "正在获取模型列表...";
    if (state.status === "error") return `模型列表获取失败：${state.error}`;
    if (state.probeStatus === "probing") return "正在发送真实模型请求...";
    if (state.probeStatus === "probe_error") return `模型调用失败：${state.probeError}`;
    if (state.probeStatus === "probed") return `模型调用成功：发现 ${state.models.length} 个模型，模型可正常调用`;
    return `模型接口可用：发现 ${state.models.length} 个模型（未测试模型调用）`;
  }

  private startCustomModelRequest(showNotice: boolean): void {
    const draft = (this.customDraft ??= this.customDraftFromSettings());
    const draftId = draft.id;
    if (!draft.baseUrl.trim() || !draft.apiKey.trim()) {
      const message = "请先填写 API Base URL 和 API Key";
      this.setCustomModelState(draftId, {
        requestId: ++this.modelRequestId,
        status: "error",
        models: [],
        endpoint: "",
        error: message,
        probeStatus: "idle",
        probeError: "",
      });
      if (showNotice) new Notice(message);
      this.options.rerender();
      return;
    }
    const requestId = ++this.modelRequestId;
    this.setCustomModelState(draftId, {
      requestId,
      status: "loading",
      models: [],
      endpoint: "",
      error: "",
      probeStatus: "idle",
      probeError: "",
    });
    this.options.rerender();
    void fetchOpenAiCompatibleModels({
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      apiFormat: draft.apiFormat,
    })
      .then((response) => {
        const current = this.customModelStateFor(draftId);
        if (current?.requestId !== requestId) return;
        this.setCustomModelState(draftId, {
          requestId,
          status: "loaded",
          models: response.models,
          endpoint: response.endpoint,
          error: "",
          probeStatus: "idle",
          probeError: "",
        });
        if (!draft.model && response.models.length > 0) draft.model = response.models[0];
        if (showNotice) {
          // Real model probe after model list success
          this.probeModel(draft, requestId);
        } else {
          new Notice(`刷新成功，发现 ${response.models.length} 个模型`);
          this.options.rerender();
        }
      })
      .catch((error: unknown) => {
        const current = this.customModelStateFor(draftId);
        if (current?.requestId !== requestId) return;
        const message = error instanceof Error ? error.message : String(error);
        this.setCustomModelState(draftId, {
          requestId,
          status: "error",
          models: [],
          endpoint: "",
          error: message,
          probeStatus: "idle",
          probeError: "",
        });
        if (showNotice) new Notice(`连接失败\n${message}`, 8000);
        this.options.rerender();
      });
  }

  private probeModel(draft: CustomProviderDraft, listRequestId: number): void {
    const draftId = draft.id;
    const model = draft.model.trim();
    if (!model) {
      const current = this.customModelStateFor(draftId);
      if (current?.requestId === listRequestId) {
        this.setCustomModelState(draftId, {
          ...current,
          probeStatus: "probe_error",
          probeError: "请先选择或输入模型名称",
        });
        new Notice("请先选择或输入模型名称", 8000);
        this.options.rerender();
      }
      return;
    }
    const current = this.customModelStateFor(draftId);
    if (current?.requestId === listRequestId) {
      this.setCustomModelState(draftId, { ...current, probeStatus: "probing" });
      this.options.rerender();
    }
    void probeOpenAiCompatibleModel({
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      model,
      apiFormat: draft.apiFormat,
    })
      .then(() => {
        const state = this.customModelStateFor(draftId);
        if (state?.requestId !== listRequestId) return;
        this.setCustomModelState(draftId, { ...state, probeStatus: "probed", probeError: "" });
        new Notice(`连接成功，模型 ${model} 可正常调用`);
        this.options.rerender();
      })
      .catch((error: unknown) => {
        const state = this.customModelStateFor(draftId);
        if (state?.requestId !== listRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        this.setCustomModelState(draftId, { ...state, probeStatus: "probe_error", probeError: message });
        new Notice(`模型调用失败\n${message}`, 8000);
        this.options.rerender();
      });
  }

  private saveCustomProvider(): void {
    const draft = (this.customDraft ??= this.customDraftFromSettings());
    try {
      const name = draft.name.trim();
      const baseUrl = normalizeOpenAiBaseUrl(draft.baseUrl);
      const apiKey = draft.apiKey.trim();
      const model = draft.model.trim();
      if (!name) throw new Error("请填写供应商名称");
      if (!apiKey) throw new Error("请填写 API Key");
      if (!model) throw new Error("请选择或输入模型名称");

      const settings = this.options.getSettings();
      const isNew = draft.id === null;
      const previousStateKey = this.customModelStateKey(draft.id);
      let providers: CustomProviderConfig[];
      let activeId: string;

      if (draft.id) {
        providers = settings.customProviders.map((p) =>
          p.id === draft.id
            ? { id: p.id, name, baseUrl, apiKey, model, apiFormat: draft.apiFormat }
            : p,
        );
        activeId = draft.id;
      } else {
        const newId = `cp_${Date.now()}`;
        providers = [
          ...settings.customProviders,
          { id: newId, name, baseUrl, apiKey, model, apiFormat: draft.apiFormat },
        ];
        activeId = newId;
        draft.id = newId;
        const pendingState = this.customModelStates.get(previousStateKey);
        if (pendingState) {
          this.customModelStates.set(newId, pendingState);
          this.customModelStates.delete(previousStateKey);
        }
      }

      void this.options
        .updateSettings({
          providerSource: "custom",
          customProviders: providers,
          activeCustomProviderId: activeId,
        })
        .then(() => {
          this.customDraft = this.customDraftFromSettings();
          new Notice(isNew ? "已添加供应商" : "已保存供应商");
          this.options.rerender();
        });
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private activateExistingProvider(providerId: string): void {
    void this.options
      .updateSettings({
        providerSource: "custom",
        activeCustomProviderId: providerId,
      })
      .then(() => {
        new Notice("已切换供应商");
        this.options.rerender();
      });
  }

  private deleteCustomProvider(providerId: string): void {
    const settings = this.options.getSettings();
    const providers = settings.customProviders.filter((p) => p.id !== providerId);
    let activeId = settings.activeCustomProviderId;
    if (activeId === providerId) {
      activeId = providers[0]?.id ?? "";
    }
    void this.options
      .updateSettings({
        customProviders: providers,
        activeCustomProviderId: activeId,
      })
      .then(() => {
        this.customModelStates.delete(providerId);
        this.customDraft = null;
        new Notice("已删除供应商");
        this.options.rerender();
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
        this.providerModelStates.clear();
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
            this.providerModelStates.clear();
            this.options.rerender();
          });
        },
      });
    }
    actionButton(controls, {
      label: "刷新",
      icon: "refresh-cw",
      onClick: () => {
        this.providerModelStates.clear();
        this.options.rerender();
      },
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
    const active = this.isProviderActive(provider, settings);
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
    icon(trailing, "chevron-right");
    row.addEventListener("click", () => {
      this.selectedProviderId = provider.id;
      this.configTab = "parsed";
      this.rawDetailExpanded = false;
      this.providerModelStates.delete(this.providerModelKey(provider));
      this.options.rerender();
    });
  }

  private renderProviderDetail(
    parent: HTMLElement,
    provider: CcSwitchProvider,
    settings: CcSwitchUiSettings,
    modelOptions: string[],
    modelState: ProviderModelState,
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

    this.renderModelSelector(parent, provider, settings, modelOptions, modelState);

    const metadata = parent.createDiv({ cls: "ccswitch-metadata-grid" });
    metadataField(metadata, "CLI 类型", provider.appType, "terminal");
    metadataField(metadata, "Base URL", provider.baseUrl, "link-2");
    metadataField(metadata, "模型", provider.model, "cpu");
    metadataField(metadata, "API 格式", provider.apiFormat, "braces");

    const rawToggle = parent.createEl("button", {
      cls: "ccswitch-raw-toggle",
      attr: {
        type: "button",
        "aria-expanded": String(this.rawDetailExpanded),
      },
    });
    icon(rawToggle, this.rawDetailExpanded ? "chevron-down" : "chevron-right");
    rawToggle.createSpan({ text: "查看原始配置（已脱敏）" });
    rawToggle.addEventListener("click", () => {
      this.rawDetailExpanded = !this.rawDetailExpanded;
      this.options.rerender();
    });
    if (!this.rawDetailExpanded) return;

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
    fallbackModels: string[],
    modelState: ProviderModelState,
  ): void {
    const card = parent.createDiv({ cls: "ccswitch-model-selector" });
    const copy = card.createDiv({ cls: "ccswitch-model-selector-copy" });
    const title = copy.createDiv({ cls: "ccswitch-section-title" });
    icon(title, "cpu");
    title.createSpan({ text: "总结模型" });
    const statusText =
      modelState.status === "loading"
        ? "正在使用供应商 Key 和 URL 获取模型列表..."
        : modelState.status === "loaded"
          ? `已实时获取 ${modelState.models.length} 个模型`
          : `实时获取失败：${modelState.error}；当前显示本地模型`;
    copy.createDiv({
      cls: `ccswitch-model-status${modelState.status === "error" ? " is-error" : ""}`,
      text: statusText,
      attr: modelState.endpoint ? { title: modelState.endpoint } : {},
    });

    const controls = card.createDiv({ cls: "ccswitch-model-controls" });
    const select = controls.createEl("select", {
      cls: "dropdown ccswitch-model-dropdown",
      attr: { "aria-label": "选择总结模型" },
    });
    select.createEl("option", {
      value: "",
      text: provider.model ? `跟随供应商默认 (${provider.model})` : "跟随供应商默认",
    });
    const sourceModels = modelState.status === "loaded" ? modelState.models : fallbackModels;
    const options = [
      ...new Set([...sourceModels, provider.model ?? "", settings.model].filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
    for (const model of options) {
      select.createEl("option", { value: model, text: model });
    }
    select.value = settings.model;
    select.addEventListener("change", () => {
      void this.options.updateSettings({ model: select.value });
    });
    const refresh = controls.createEl("button", {
      cls: `clickable-icon ccswitch-model-refresh${
        modelState.status === "loading" ? " is-loading" : ""
      }`,
      attr: { type: "button", "aria-label": "实时刷新模型列表" },
    });
    setIcon(refresh, "refresh-cw");
    refresh.disabled = modelState.status === "loading";
    refresh.addEventListener("click", () => this.startProviderModelRequest(provider, true));
  }

  private providerModelKey(provider: CcSwitchProvider): string {
    return `${provider.appType}:${provider.id}`;
  }

  private ensureProviderModels(provider: CcSwitchProvider): ProviderModelState {
    const existing = this.providerModelStates.get(this.providerModelKey(provider));
    return existing ?? this.startProviderModelRequest(provider, false);
  }

  private startProviderModelRequest(
    provider: CcSwitchProvider,
    rerender: boolean,
  ): ProviderModelState {
    const key = this.providerModelKey(provider);
    const requestId = ++this.modelRequestId;
    const state: ProviderModelState = {
      requestId,
      status: "loading",
      models: [],
      endpoint: "",
      error: "",
      probeStatus: "idle",
      probeError: "",
    };
    this.providerModelStates.set(key, state);
    if (rerender) this.options.rerender();

    void fetchCcSwitchProviderModels({
      dbPath: this.options.getSettings().ccSwitchDbPath,
      appType: provider.appType,
      providerId: provider.id,
    })
      .then((response) => {
        if (this.providerModelStates.get(key)?.requestId !== requestId) return;
        this.providerModelStates.set(key, {
          requestId,
          status: "loaded",
          models: response.models,
          endpoint: response.endpoint,
          error: "",
          probeStatus: "idle",
          probeError: "",
        });
        this.options.rerender();
      })
      .catch((error: unknown) => {
        if (this.providerModelStates.get(key)?.requestId !== requestId) return;
        this.providerModelStates.set(key, {
          requestId,
          status: "error",
          models: [],
          endpoint: provider.baseUrl ?? "",
          error: error instanceof Error ? error.message : String(error),
          probeStatus: "idle",
          probeError: "",
        });
        this.options.rerender();
      });
    return state;
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
