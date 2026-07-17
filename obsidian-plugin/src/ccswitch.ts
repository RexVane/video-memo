import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { requestUrl } from "obsidian";
import { parse as parseToml } from "smol-toml";

type JsonRecord = Record<string, unknown>;

const SECRET_MARKERS = ["token", "key", "secret", "auth", "password"];
const BASE_URL_KEYS = [
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "CODEX_BASE_URL",
  "BASE_URL",
  "API_BASE",
  "ENDPOINT",
  "URL",
];
const SECRET_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_AUTH_TOKEN",
  "CODEX_API_KEY",
  "CODEX_AUTH_TOKEN",
  "API_KEY",
  "AUTH_TOKEN",
];

export interface CcSwitchProvider {
  id: string;
  appType: string;
  name: string;
  category: string | null;
  websiteUrl: string | null;
  notes: string | null;
  sortIndex: number | null;
  createdAt: number | null;
  isCurrent: boolean;
  baseUrl: string | null;
  model: string | null;
  apiFormat: string | null;
  maskedEnv: Record<string, string>;
  configParseError: boolean;
  redactedSettingsConfig: string;
  providerType: string | null;
  usable: boolean;
}

export interface CcSwitchProvidersResponse {
  dbPath: string;
  providers: CcSwitchProvider[];
}

export interface CcSwitchProviderRuntime {
  id: string;
  appType: string;
  name: string;
  baseUrl: string;
  model: string | null;
  apiFormat: string | null;
  apiKey: string;
}

export interface CcSwitchModelListResponse {
  endpoint: string;
  models: string[];
}

interface ProviderRow extends Record<string, unknown> {
  id: string;
  app_type: string;
  name: string;
  settings_config: string;
  website_url: string | null;
  category: string | null;
  notes: string | null;
  sort_index: number | null;
  created_at: number | null;
  is_current: number;
  meta: string;
  provider_type: string | null;
}

interface ParsedProviderConfig {
  baseUrl: string | null;
  model: string | null;
  apiFormat: string | null;
  apiKey: string | null;
  maskedEnv: Record<string, string>;
  redactedSettingsConfig: string;
  parseError: boolean;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizeKey(value: string): string {
  return value.trim().replaceAll("-", "_").toUpperCase();
}

function keyMatches(
  key: string,
  exact: readonly string[],
  suffixes: readonly string[],
): boolean {
  const normalized = normalizeKey(key);
  return (
    exact.some((candidate) => normalized === normalizeKey(candidate)) ||
    suffixes.some((suffix) => normalized.endsWith(normalizeKey(suffix)))
  );
}

function findTextByKeyPatterns(
  value: unknown,
  exact: readonly string[],
  suffixes: readonly string[],
): string | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const [key, candidate] of Object.entries(record)) {
    if (keyMatches(key, exact, suffixes)) {
      const text = textValue(candidate);
      if (text) return text;
    }
  }
  for (const candidate of Object.values(record)) {
    const nested = findTextByKeyPatterns(candidate, exact, suffixes);
    if (nested) return nested;
  }
  return null;
}

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_MARKERS.some((marker) => lower.includes(marker));
}

function maskSecret(value: string): string {
  const characters = [...value];
  if (characters.length <= 12) return "***";
  return `${characters.slice(0, 4).join("")}...${characters.slice(-4).join("")}`;
}

function collectMaskedEnv(config: JsonRecord): Record<string, string> {
  const result: Record<string, string> = {};
  for (const sectionName of ["env", "auth"]) {
    const section = asRecord(config[sectionName]);
    if (!section) continue;
    for (const [key, value] of Object.entries(section)) {
      const text = textValue(value) ?? JSON.stringify(value);
      result[key] = isSecretKey(key) ? maskSecret(text) : text;
    }
  }
  return result;
}

function redactSecrets(value: unknown, parentKey = ""): unknown {
  if (isSecretKey(parentKey)) {
    const text = textValue(value);
    return text ? maskSecret(text) : "***";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, redactSecrets(item, key)]),
  );
}

function parseMeta(raw: string): JsonRecord {
  try {
    return asRecord(JSON.parse(raw || "{}")) ?? {};
  } catch {
    return {};
  }
}

function parseTomlConfig(raw: string): {
  baseUrl: string | null;
  model: string | null;
  apiFormat: string | null;
} {
  if (!raw.trim()) return { baseUrl: null, model: null, apiFormat: null };
  try {
    const parsed = asRecord(parseToml(raw)) ?? {};
    const selectedName = textValue(parsed.model_provider);
    const providers = asRecord(parsed.model_providers);
    let selectedProvider = selectedName && providers
      ? asRecord(providers[selectedName])
      : null;
    if (!selectedProvider && providers) {
      selectedProvider =
        Object.values(providers)
          .map(asRecord)
          .find((provider) => textValue(provider?.base_url)) ?? null;
    }
    return {
      baseUrl: textValue(selectedProvider?.base_url),
      model: textValue(parsed.model),
      apiFormat: textValue(selectedProvider?.wire_api),
    };
  } catch {
    const model = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
    const baseUrl = raw.match(/^\s*base_url\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
    const apiFormat = raw.match(/^\s*wire_api\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
    return { baseUrl, model, apiFormat };
  }
}

function parseProviderConfig(settingsConfig: string, metaRaw: string): ParsedProviderConfig {
  try {
    const parsed = asRecord(JSON.parse(settingsConfig));
    if (!parsed) throw new Error("provider settings must be an object");
    const env = asRecord(parsed.env);
    const auth = asRecord(parsed.auth);
    const toml = parseTomlConfig(textValue(parsed.config) ?? "");
    const baseUrl =
      findTextByKeyPatterns(env, BASE_URL_KEYS, ["_BASE_URL", "_API_BASE", "_ENDPOINT"]) ??
      findTextByKeyPatterns(
        parsed,
        ["openai_base_url", "chatgpt_base_url", "base_url", "api_base", "endpoint"],
        ["_BASE_URL", "_API_BASE", "_ENDPOINT"],
      ) ??
      toml.baseUrl;
    const model =
      findTextByKeyPatterns(env, ["OPENAI_MODEL", "CODEX_MODEL", "MODEL"], ["_MODEL"]) ??
      textValue(parsed.model) ??
      toml.model;
    const apiKey =
      findTextByKeyPatterns(env, SECRET_KEYS, ["_API_KEY", "_AUTH_TOKEN", "_ACCESS_TOKEN", "_TOKEN"]) ??
      findTextByKeyPatterns(auth, SECRET_KEYS, ["_API_KEY", "_AUTH_TOKEN", "_ACCESS_TOKEN", "_TOKEN"]) ??
      findTextByKeyPatterns(parsed, SECRET_KEYS, ["_API_KEY", "_AUTH_TOKEN", "_ACCESS_TOKEN", "_TOKEN"]);
    const meta = parseMeta(metaRaw);
    const apiFormat = textValue(meta.apiFormat) ?? toml.apiFormat;
    return {
      baseUrl,
      model,
      apiFormat,
      apiKey,
      maskedEnv: collectMaskedEnv(parsed),
      redactedSettingsConfig: JSON.stringify(redactSecrets(parsed), null, 2),
      parseError: false,
    };
  } catch {
    return {
      baseUrl: null,
      model: null,
      apiFormat: null,
      apiKey: null,
      maskedEnv: {},
      redactedSettingsConfig: settingsConfig,
      parseError: true,
    };
  }
}

function providerFromRow(row: ProviderRow): CcSwitchProvider {
  const parsed = parseProviderConfig(row.settings_config, row.meta);
  const openAiCompatible = !parsed.apiFormat?.toLowerCase().includes("anthropic");
  return {
    id: String(row.id),
    appType: String(row.app_type),
    name: String(row.name),
    category: row.category ? String(row.category) : null,
    websiteUrl: row.website_url ? String(row.website_url) : null,
    notes: row.notes ? String(row.notes) : null,
    sortIndex: row.sort_index === null ? null : Number(row.sort_index),
    createdAt: row.created_at === null ? null : Number(row.created_at),
    isCurrent: Boolean(Number(row.is_current)),
    baseUrl: parsed.baseUrl,
    model: parsed.model,
    apiFormat: parsed.apiFormat,
    maskedEnv: parsed.maskedEnv,
    configParseError: parsed.parseError,
    redactedSettingsConfig: parsed.redactedSettingsConfig,
    providerType: row.provider_type ? String(row.provider_type) : null,
    usable: Boolean(parsed.baseUrl && parsed.apiKey && openAiCompatible),
  };
}

export function defaultCcSwitchDbPath(): string {
  return join(homedir(), ".cc-switch", "cc-switch.db");
}

export function resolveCcSwitchDbPath(configuredPath: string): string {
  const configured = configuredPath.trim();
  const expanded = configured.startsWith("~")
    ? join(homedir(), configured.slice(1).replace(/^[/\\]+/, ""))
    : configured;
  return resolve(expanded || defaultCcSwitchDbPath());
}

function openDatabase(configuredPath: string): { db: DatabaseSync; path: string } {
  const path = resolveCcSwitchDbPath(configuredPath);
  if (extname(path).toLowerCase() !== ".db") {
    throw new Error("cc-switch 数据库路径必须指向 .db 文件");
  }
  if (!existsSync(path)) {
    throw new Error(`未找到 cc-switch 数据库: ${path}`);
  }
  return {
    db: new DatabaseSync(path, { readOnly: true, timeout: 15_000 }),
    path,
  };
}

const PROVIDER_QUERY = `
  SELECT id, app_type, name, settings_config, website_url, category, notes,
         sort_index, created_at, is_current, meta, provider_type
  FROM providers
`;

export function loadCcSwitchProviders(configuredPath = ""): CcSwitchProvidersResponse {
  const { db, path } = openDatabase(configuredPath);
  try {
    const rows = db
      .prepare(`${PROVIDER_QUERY} ORDER BY app_type, sort_index, name`)
      .all() as unknown as ProviderRow[];
    return { dbPath: path, providers: rows.map(providerFromRow) };
  } finally {
    db.close();
  }
}

export function resolveCcSwitchProviderRuntime(options: {
  dbPath?: string;
  appType: string;
  followCurrent: boolean;
  providerId?: string;
}): CcSwitchProviderRuntime {
  const { db } = openDatabase(options.dbPath ?? "");
  try {
    const row = options.followCurrent
      ? db
          .prepare(`${PROVIDER_QUERY} WHERE app_type = ? AND is_current = 1 LIMIT 1`)
          .get(options.appType)
      : db
          .prepare(`${PROVIDER_QUERY} WHERE app_type = ? AND id = ? LIMIT 1`)
          .get(options.appType, options.providerId ?? "");
    if (!row) {
      throw new Error(
        options.followCurrent
          ? `cc-switch 未设置 ${options.appType} 的全局当前供应商`
          : "固定的 cc-switch 供应商已不存在，请重新选择",
      );
    }
    const providerRow = row as unknown as ProviderRow;
    const parsed = parseProviderConfig(providerRow.settings_config, providerRow.meta);
    if (!parsed.baseUrl) throw new Error("该供应商缺少 OpenAI 兼容 Base URL");
    if (!parsed.apiKey) throw new Error("该供应商缺少 API Key 或 Token");
    if (parsed.apiFormat?.toLowerCase().includes("anthropic")) {
      throw new Error("该供应商使用 Anthropic 原生协议，不能用于当前总结引擎");
    }
    return {
      id: String(providerRow.id),
      appType: String(providerRow.app_type),
      name: String(providerRow.name),
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      apiFormat: parsed.apiFormat,
      apiKey: parsed.apiKey,
    };
  } finally {
    db.close();
  }
}

export function openAiModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error("模型接口 Base URL 必须使用 http 或 https");
  }
  if (url.username || url.password) {
    throw new Error("模型接口 Base URL 不能包含用户名或密码");
  }
  if (url.search || url.hash) {
    throw new Error("模型接口 Base URL 不能包含查询参数或锚点");
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (!path) {
    url.pathname = "/v1/models";
  } else if (!/\/models$/i.test(path)) {
    url.pathname = `${path}/models`;
  }
  return url.toString();
}

function modelIdsFromResponse(payload: unknown): string[] {
  const record = asRecord(payload);
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : [];
  const models = candidates
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const model = asRecord(item);
      return textValue(model?.id) ?? textValue(model?.name) ?? textValue(model?.model) ?? "";
    })
    .filter((model) => model.length > 0 && model.length <= 200);
  return [...new Set(models)].sort((left, right) =>
    left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }),
  );
}

function responseErrorDetail(text: string): string {
  try {
    const payload = asRecord(JSON.parse(text));
    const error = asRecord(payload?.error);
    const detail = textValue(error?.message) ?? textValue(payload?.message);
    return detail?.slice(0, 240) ?? "";
  } catch {
    return "";
  }
}

export async function fetchCcSwitchProviderModels(options: {
  dbPath?: string;
  appType: string;
  providerId: string;
}): Promise<CcSwitchModelListResponse> {
  const runtime = resolveCcSwitchProviderRuntime({
    dbPath: options.dbPath,
    appType: options.appType,
    followCurrent: false,
    providerId: options.providerId,
  });
  const endpoint = openAiModelsUrl(runtime.baseUrl);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      requestUrl({
        url: endpoint,
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${runtime.apiKey}`,
        },
        throw: false,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("模型接口请求超时（15 秒）")), 15_000);
      }),
    ]);
    if (response.status < 200 || response.status >= 300) {
      const label =
        response.status === 401 || response.status === 403
          ? "模型接口鉴权失败"
          : response.status === 404
            ? "未找到模型接口"
            : "模型接口请求失败";
      const detail = responseErrorDetail(response.text);
      throw new Error(`${label} (HTTP ${response.status})${detail ? `：${detail}` : ""}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(response.text);
    } catch {
      throw new Error("模型接口没有返回有效 JSON");
    }
    const models = modelIdsFromResponse(payload);
    if (models.length === 0) {
      throw new Error("模型接口返回成功，但列表为空");
    }
    return { endpoint, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replaceAll(runtime.apiKey, "***"));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
