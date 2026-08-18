import { loadCcSwitchProviders } from "./ccswitch";
import type { CcSwitchUiSettings, ProviderSource } from "./ccswitch-settings";

export interface VideoMemoSettings extends CcSwitchUiSettings {
  projectPath: string;
  targetFolder: string;
  cleanupMedia: boolean;
}

export const DEFAULT_SETTINGS: VideoMemoSettings = {
  projectPath: "",
  providerSource: "ccswitch",
  ccSwitchDbPath: "",
  ccSwitchAppType: "codex",
  ccSwitchFollowCurrent: true,
  ccSwitchProviderId: "",
  model: "",
  customProviderName: "",
  customProviderBaseUrl: "",
  customProviderApiKey: "",
  customProviderModel: "",
  customProviderApiFormat: "chat_completions",
  targetFolder: "Video Memos",
  cleanupMedia: false,
};

export function normalizeSettings(
  stored: Partial<VideoMemoSettings> | null,
): VideoMemoSettings {
  const stringValue = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback;
  const storedProviderSource = stored?.providerSource;
  const providerSource: ProviderSource =
    storedProviderSource === "environment" || storedProviderSource === "custom"
      ? storedProviderSource
      : "ccswitch";
  const customProviderApiFormat =
    stored?.customProviderApiFormat === "responses" ? "responses" : "chat_completions";
  return {
    projectPath: stringValue(stored?.projectPath, DEFAULT_SETTINGS.projectPath),
    providerSource,
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
    customProviderName: stringValue(
      stored?.customProviderName,
      DEFAULT_SETTINGS.customProviderName,
    ),
    customProviderBaseUrl: stringValue(
      stored?.customProviderBaseUrl,
      DEFAULT_SETTINGS.customProviderBaseUrl,
    ),
    customProviderApiKey: stringValue(
      stored?.customProviderApiKey,
      DEFAULT_SETTINGS.customProviderApiKey,
    ),
    customProviderModel: stringValue(
      stored?.customProviderModel,
      DEFAULT_SETTINGS.customProviderModel,
    ),
    customProviderApiFormat,
    targetFolder: stringValue(stored?.targetFolder, DEFAULT_SETTINGS.targetFolder),
    cleanupMedia:
      typeof stored?.cleanupMedia === "boolean"
        ? stored.cleanupMedia
        : DEFAULT_SETTINGS.cleanupMedia,
  };
}

/**
 * One-line human summary of the provider a task would use right now.
 * Reads the cc-switch database, so callers should treat it as best effort.
 */
export function describeProviderSelection(settings: VideoMemoSettings): string {
  if (settings.providerSource === "environment") {
    return settings.model ? `环境配置 · ${settings.model}` : "使用项目环境变量配置";
  }
  if (settings.providerSource === "custom") {
    const name = settings.customProviderName.trim() || "未命名供应商";
    const model = settings.customProviderModel.trim();
    if (!settings.customProviderBaseUrl.trim() || !settings.customProviderApiKey.trim()) {
      return `自定义 · ${name} · 配置需要检查`;
    }
    return model ? `自定义 · ${name} · 模型 ${model}` : `自定义 · ${name} · 尚未选择模型`;
  }
  try {
    const providers = loadCcSwitchProviders(settings.ccSwitchDbPath).providers;
    const provider = settings.ccSwitchFollowCurrent
      ? providers.find(
          (item) => item.appType === settings.ccSwitchAppType && item.isCurrent,
        )
      : providers.find(
          (item) =>
            item.appType === settings.ccSwitchAppType &&
            item.id === settings.ccSwitchProviderId,
        );
    if (!provider) {
      return `cc-switch · ${settings.ccSwitchAppType} · 配置需要检查`;
    }
    const mode = settings.ccSwitchFollowCurrent ? "跟随全局当前" : "已固定";
    const model = settings.model || provider.model;
    return model
      ? `cc-switch · ${provider.name} · ${mode} · 模型 ${model}`
      : `cc-switch · ${provider.name} · ${mode}`;
  } catch {
    return "cc-switch · 无法读取数据库";
  }
}
