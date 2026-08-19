import { loadCcSwitchProviders, normalizeApiFormat } from "./ccswitch";
import type {
  CcSwitchUiSettings,
  CustomProviderConfig,
  ProviderSource,
} from "./ccswitch-settings";

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
  customProviders: [],
  activeCustomProviderId: "",
  targetFolder: "",
  cleanupMedia: false,
};

function normalizeCustomProviders(raw: unknown): CustomProviderConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: CustomProviderConfig[] = [];
  for (let index = 0; index < raw.length; index++) {
    const item = raw[index] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name : "";
    const baseUrl = typeof item.baseUrl === "string" ? item.baseUrl : "";
    const apiKey = typeof item.apiKey === "string" ? item.apiKey : "";
    const model = typeof item.model === "string" ? item.model : "";
    const apiFormat = normalizeApiFormat(item.apiFormat);
    let id = typeof item.id === "string" && item.id ? item.id : `cp_${Date.now()}_${index}`;
    if (seen.has(id)) id = `${id}_${index}`;
    seen.add(id);
    result.push({ id, name, baseUrl, apiKey, model, apiFormat });
  }
  return result;
}

/**
 * Confine the vault-relative output folder.
 *
 * The value is handed to the Python engine, which joins it against the vault
 * root, so a `..` segment or an absolute path would let notes and frame
 * attachments escape the vault entirely.
 */
export function sanitizeTargetFolder(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.targetFolder;
  const cleaned = value
    .trim()
    .replace(/[\\]+/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  if (!cleaned || /^[A-Za-z]:/.test(cleaned)) return DEFAULT_SETTINGS.targetFolder;
  return cleaned;
}

export function normalizeSettings(
  stored: Partial<VideoMemoSettings> | null,
): VideoMemoSettings {
  const stringValue = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback;
  const storedProviderSource = stored?.providerSource;
  const providerSource: ProviderSource = storedProviderSource === "custom" ? "custom" : "ccswitch";

  let customProviders = normalizeCustomProviders(stored?.customProviders);

  // One-time migration from the legacy single-provider fields.
  const legacy = stored as Record<string, unknown> | null;
  const legacyBaseUrl = typeof legacy?.customProviderBaseUrl === "string" ? legacy.customProviderBaseUrl : "";
  const legacyApiKey = typeof legacy?.customProviderApiKey === "string" ? legacy.customProviderApiKey : "";
  if (
    customProviders.length === 0 &&
    (legacyBaseUrl.trim() || legacyApiKey.trim())
  ) {
    const migrated: CustomProviderConfig = {
      id: `cp_migrated_${Date.now()}`,
      name: typeof legacy?.customProviderName === "string" ? legacy.customProviderName : "已迁移供应商",
      baseUrl: legacyBaseUrl,
      apiKey: legacyApiKey,
      model: typeof legacy?.customProviderModel === "string" ? legacy.customProviderModel : "",
      apiFormat: normalizeApiFormat(legacy?.customProviderApiFormat),
    };
    customProviders = [migrated];
  }

  const activeCustomProviderId = stringValue(
    stored?.activeCustomProviderId,
    customProviders[0]?.id ?? "",
  );
  const activeIdIsValid = customProviders.some((p) => p.id === activeCustomProviderId);

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
    customProviders,
    activeCustomProviderId: activeIdIsValid ? activeCustomProviderId : (customProviders[0]?.id ?? ""),
    targetFolder: sanitizeTargetFolder(stored?.targetFolder),
    cleanupMedia:
      typeof stored?.cleanupMedia === "boolean"
        ? stored.cleanupMedia
        : DEFAULT_SETTINGS.cleanupMedia,
  };
}

/**
 * Resolve the currently active custom provider config, or null if none is selected.
 */
export function activeCustomProvider(settings: VideoMemoSettings): CustomProviderConfig | null {
  const list = settings.customProviders;
  if (list.length === 0) return null;
  return (
    list.find((p) => p.id === settings.activeCustomProviderId) ?? list[0] ?? null
  );
}

/**
 * One-line human summary of the provider a task would use right now.
 * Reads the cc-switch database, so callers should treat it as best effort.
 */
export function describeProviderSelection(settings: VideoMemoSettings): string {
  if (settings.providerSource === "custom") {
    const provider = activeCustomProvider(settings);
    if (!provider) return "自定义 · 尚未添加供应商";
    const name = provider.name.trim() || "未命名供应商";
    const model = provider.model.trim();
    if (!provider.baseUrl.trim() || !provider.apiKey.trim()) {
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
