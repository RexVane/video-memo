import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

import { requestUrl } from "obsidian";
import { parse as parseToml } from "smol-toml";

type JsonRecord = Record<string, unknown>;

const BASE_URL_KEYS = new Set(["baseurl", "apiurl", "endpoint"]);
const MODEL_KEYS = new Set(["model", "defaultmodel"]);
const FORMAT_KEYS = new Set(["apiformat", "wireapi", "protocol"]);

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

export interface OpenAiCompatibleModelsResponse {
  endpoint: string;
  models: string[];
}

export interface CcSwitchModelListResponse
  extends OpenAiCompatibleModelsResponse {}

export interface OpenAiCompatibleModelsOptions {
  baseUrl: string;
  apiKey: string;
  apiFormat?: OpenAiApiFormat;
}

export type OpenAiApiFormat =
  | "anthropic_messages"
  | "chat_completions"
  | "responses";

export interface OpenAiModelProbeOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat: OpenAiApiFormat;
}

export interface OpenAiModelProbeResult {
  endpoint: string;
  model: string;
}

interface ExtractedProviderConfig {
  baseUrl: string;
  model: string;
  apiFormat: OpenAiApiFormat;
  apiKey: string;
  maskedEnv: Record<string, string>;
  parseError: boolean;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return null;
}

function normalizeKey(value: string): string {
  return value.replaceAll("-", "").replaceAll("_", "").toLowerCase();
}

function keyMatches(normalizedKey: string, acceptedKeys: ReadonlySet<string>): boolean {
  if (acceptedKeys.has(normalizedKey)) return true;
  if (acceptedKeys.has("baseurl") && normalizedKey.endsWith("baseurl")) {
    return true;
  }
  return acceptedKeys.has("model") && normalizedKey.endsWith("model");
}

function findTextByKey(root: unknown, acceptedKeys: ReadonlySet<string>): string {
  const record = asRecord(root);
  if (!record) return "";
  for (const [key, value] of Object.entries(record)) {
    if (keyMatches(normalizeKey(key), acceptedKeys)) {
      const candidate = textValue(value);
      if (candidate) return candidate;
    }
  }
  for (const value of Object.values(record)) {
    const nested = findTextByKey(value, acceptedKeys);
    if (nested) return nested;
  }
  return "";
}

function isSecretValueKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (normalized.endsWith("envkey")) return false;
  return [
    "apikey",
    "authtoken",
    "accesstoken",
    "bearertoken",
    "password",
    "secret",
    "token",
  ].some((suffix) => normalized.endsWith(suffix));
}

function findSecretValue(root: unknown): string {
  const record = asRecord(root);
  if (!record) return "";
  for (const [key, value] of Object.entries(record)) {
    if (isSecretValueKey(key)) {
      const candidate = textValue(value);
      if (candidate) return candidate;
    }
  }
  for (const value of Object.values(record)) {
    const nested = findSecretValue(value);
    if (nested) return nested;
  }
  return "";
}

function findEnvironmentSecret(root: unknown): string {
  const record = asRecord(root);
  if (!record) return "";
  for (const [key, value] of Object.entries(record)) {
    if (normalizeKey(key).endsWith("envkey")) {
      const environmentName = textValue(value);
      if (environmentName) {
        const secret = process.env[environmentName]?.trim();
        if (secret) return secret;
      }
    }
  }
  for (const value of Object.values(record)) {
    const nested = findEnvironmentSecret(value);
    if (nested) return nested;
  }
  return "";
}

function parseJsonRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "string") return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseTomlRecord(value: string): JsonRecord {
  if (!value.trim()) return {};
  try {
    return asRecord(parseToml(value)) ?? {};
  } catch {
    return {};
  }
}

function selectedCodexProvider(toml: JsonRecord): JsonRecord | null {
  const providers = asRecord(toml.model_providers);
  if (!providers) return null;
  const selectedName = textValue(toml.model_provider);
  const selected = selectedName ? asRecord(providers[selectedName]) : null;
  if (selected) return selected;
  return (
    Object.values(providers)
      .map(asRecord)
      .find((provider) => findTextByKey(provider, BASE_URL_KEYS)) ?? null
  );
}

function selectedGrokModel(toml: JsonRecord): {
  model: string;
  config: JsonRecord | null;
} {
  const models = asRecord(toml.models);
  const modelName = textValue(models?.default);
  const modelTable = asRecord(toml.model);
  return {
    model: modelName,
    config: modelName && modelTable ? asRecord(modelTable[modelName]) : null,
  };
}

function collectMaskedEnvironment(settings: JsonRecord): Record<string, string> {
  const result: Record<string, string> = {};
  for (const sectionName of ["env", "auth"] as const) {
    const section = asRecord(settings[sectionName]);
    if (!section) continue;
    for (const [key, rawValue] of Object.entries(section)) {
      const value = textValue(rawValue);
      if (!value) continue;
      result[key] = isSecretValueKey(key)
        ? "******"
        : normalizeKey(key).endsWith("baseurl")
          ? sanitizeUrlForDisplay(value)
          : value;
    }
  }
  return result;
}

function extractProviderConfig(
  settingsRaw: string,
  metadataRaw: string,
  appType: string,
): ExtractedProviderConfig {
  const settings = parseJsonRecord(settingsRaw);
  const parsedSettings = settings ?? {};
  const metadata = parseJsonRecord(metadataRaw) ?? {};
  const toml = parseTomlRecord(textValue(parsedSettings.config));
  const codexProvider = selectedCodexProvider(toml);
  const grokModel = selectedGrokModel(toml);

  const apiKeySources = [
    parsedSettings,
    codexProvider,
    grokModel.config,
    toml,
  ];
  const directApiKey = apiKeySources.map(findSecretValue).find(Boolean) ?? "";
  const environmentApiKey =
    apiKeySources.map(findEnvironmentSecret).find(Boolean) ?? "";
  const apiKey = directApiKey || environmentApiKey;
  const preferredConfigSources = [codexProvider, grokModel.config, parsedSettings];
  const baseUrl =
    [...preferredConfigSources, toml]
      .map((value) => findTextByKey(value, BASE_URL_KEYS))
      .find(Boolean) ?? "";
  const model =
    textValue(toml.model) ||
    grokModel.model ||
    findTextByKey(parsedSettings, MODEL_KEYS) ||
    findTextByKey(codexProvider, MODEL_KEYS);
  const apiFormat = normalizeApiFormat(
    findTextByKey(metadata, FORMAT_KEYS) ||
      findTextByKey(codexProvider, FORMAT_KEYS) ||
      findTextByKey(grokModel.config, FORMAT_KEYS) ||
      findTextByKey(parsedSettings, FORMAT_KEYS) ||
      (appType.toLowerCase().startsWith("claude")
        ? "anthropic_messages"
        : "chat_completions"),
  );

  return {
    apiKey,
    baseUrl,
    model,
    apiFormat,
    maskedEnv: collectMaskedEnvironment(parsedSettings),
    parseError: Boolean(settingsRaw.trim() && !settings),
  };
}

function safeConfigSummary(config: ExtractedProviderConfig): string {
  return JSON.stringify({
    baseUrl: sanitizeUrlForDisplay(config.baseUrl) || null,
    model: config.model || null,
    apiFormat: config.apiFormat,
    environment: config.maskedEnv,
    apiKeyConfigured: Boolean(config.apiKey),
  });
}

function sanitizeUrlForDisplay(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value ? "[configured URL]" : "";
  }
}

function tryNormalizeBaseUrl(value: string): string {
  try {
    return normalizeOpenAiBaseUrl(value);
  } catch {
    return "";
  }
}

export function normalizeApiFormat(value: unknown): OpenAiApiFormat {
  if (typeof value !== "string") return "chat_completions";
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  if (["anthropic", "anthropic_messages", "messages"].includes(normalized)) {
    return "anthropic_messages";
  }
  if (["openai_responses", "response", "responses"].includes(normalized)) {
    return "responses";
  }
  return "chat_completions";
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

/**
 * Whether this Obsidian/Electron runtime ships the `node:sqlite` module.
 *
 * Reading the cc-switch database needs Node >= 22.13 (Electron >= 35), which
 * reached the public desktop channel with Obsidian 1.9.10 and its updated
 * installer. Older runtimes keep the whole plugin working through the custom
 * provider source, so callers should detect this instead of guessing from the
 * app version — the installer, not the app version, decides the runtime.
 */
export function nodeSqliteSupported(): boolean {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

function loadNodeSqlite(): typeof import("node:sqlite") {
  try {
    return require("node:sqlite") as typeof import("node:sqlite");
  } catch {
    throw new Error(
      "当前 Obsidian 运行时不支持 node:sqlite；请切换到自定义供应商或升级 Obsidian",
    );
  }
}

// node:sqlite is fully synchronous: every call runs on the renderer thread. A
// locked or hot-journal database would otherwise freeze the whole window for
// the busy timeout, so keep the wait short and cache rows keyed by file
// identity (path + mtime + size) to avoid re-reading on every re-render of the
// settings page or the provider badge.
const SQLITE_BUSY_TIMEOUT_MS = 1_500;

interface ProviderRowsCacheEntry {
  path: string;
  mtimeMs: number;
  size: number;
  rows: JsonRecord[];
}

let providerRowsCache: ProviderRowsCacheEntry | null = null;

function readProviderRows(configuredPath: string): {
  rows: JsonRecord[];
  path: string;
} {
  const path = resolveCcSwitchDbPath(configuredPath);
  if (extname(path).toLowerCase() !== ".db") {
    throw new Error("cc-switch 数据库路径必须指向 .db 文件");
  }
  if (!existsSync(path)) {
    throw new Error("未找到 cc-switch 数据库");
  }
  let stat: { mtimeMs: number; size: number } | null = null;
  try {
    const info = statSync(path);
    stat = { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    stat = null;
  }
  const cached = providerRowsCache;
  if (
    cached &&
    stat &&
    cached.path === path &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return { rows: cached.rows, path };
  }
  const { DatabaseSync } = loadNodeSqlite();
  const db = new DatabaseSync(path, {
    readOnly: true,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });
  let rows: JsonRecord[];
  try {
    rows = db.prepare("SELECT * FROM providers").all() as JsonRecord[];
  } finally {
    db.close();
  }
  if (stat) {
    providerRowsCache = { path, mtimeMs: stat.mtimeMs, size: stat.size, rows };
  }
  return { rows, path };
}

export function loadCcSwitchProviders(
  configuredPath = "",
): CcSwitchProvidersResponse {
  const { rows, path } = readProviderRows(configuredPath);
  const providers = rows.map((row): CcSwitchProvider => {
    const appType = textValue(row.app_type);
    const config = extractProviderConfig(
      textValue(row.settings_config),
      textValue(row.meta),
      appType,
    );
    const baseUrl = tryNormalizeBaseUrl(config.baseUrl);
    return {
      id: textValue(row.id),
      appType,
      name: textValue(row.name) || textValue(row.id),
      category: textValue(row.category) || null,
      websiteUrl: sanitizeUrlForDisplay(textValue(row.website_url)) || null,
      notes: textValue(row.notes) || null,
      sortIndex: numberValue(row.sort_index),
      createdAt: numberValue(row.created_at),
      isCurrent: Number(row.is_current) === 1,
      baseUrl: baseUrl || null,
      model: config.model || null,
      apiFormat: config.apiFormat,
      maskedEnv: config.maskedEnv,
      configParseError: config.parseError,
      redactedSettingsConfig: safeConfigSummary(config),
      providerType: textValue(row.provider_type) || null,
      usable: Boolean(baseUrl && config.apiKey),
    };
  });
  providers.sort((left, right) => {
    const appTypeOrder = left.appType.localeCompare(right.appType, "en", {
      sensitivity: "base",
    });
    if (appTypeOrder !== 0) return appTypeOrder;
    const leftIndex = left.sortIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.sortIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.name.localeCompare(right.name, "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
  return { dbPath: path, providers };
}

export function resolveCcSwitchProviderRuntime(options: {
  dbPath?: string;
  appType: string;
  followCurrent: boolean;
  providerId?: string;
}): CcSwitchProviderRuntime {
  const { rows } = readProviderRows(options.dbPath ?? "");
  const candidates = rows.filter(
    (item) => textValue(item.app_type) === options.appType,
  );
  const row = options.followCurrent
    ? candidates.find((item) => Number(item.is_current) === 1)
    : candidates.find((item) => textValue(item.id) === (options.providerId ?? ""));
  if (!row) throw new Error("未找到所选供应商");

  const appType = textValue(row.app_type);
  const config = extractProviderConfig(
    textValue(row.settings_config),
    textValue(row.meta),
    appType,
  );
  const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl);
  if (!config.apiKey) throw new Error("供应商缺少可用的 API Key");
  return {
    id: textValue(row.id),
    appType,
    name: textValue(row.name) || textValue(row.id),
    baseUrl,
    model: config.model || null,
    apiFormat: config.apiFormat,
    apiKey: config.apiKey,
  };
}

export function normalizeOpenAiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("供应商缺少 Base URL");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("供应商 Base URL 无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("供应商 Base URL 必须使用 HTTP 或 HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("供应商 Base URL 不能包含凭据、查询参数或锚点");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/(?:chat\/completions|responses|messages|models)$/i.test(path)) {
    throw new Error("供应商 Base URL 应填写 API 根地址");
  }
  url.pathname = path || "/";
  return url.toString().replace(/\/$/, "");
}

function apiEndpoint(baseUrl: string, resource: string): string {
  const base = normalizeOpenAiBaseUrl(baseUrl);
  return /\/v1$/i.test(base) ? `${base}/${resource}` : `${base}/v1/${resource}`;
}

export function openAiModelsUrl(baseUrl: string): string {
  return apiEndpoint(baseUrl, "models");
}

function authenticationHeaders(
  apiKey: string,
  apiFormat: OpenAiApiFormat,
): Record<string, string> {
  return apiFormat === "anthropic_messages"
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${apiKey}` };
}

function modelIdsFromPayload(payload: unknown): string[] {
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
      return (
        textValue(model?.id) || textValue(model?.name) || textValue(model?.model)
      );
    })
    .filter((model) => model.length > 0 && model.length <= 200);
  return [...new Set(models)].sort((left, right) =>
    left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }),
  );
}

function requestError(): Error {
  return new Error("供应商请求失败，请检查网络与配置");
}

export async function fetchOpenAiCompatibleModels(
  options: OpenAiCompatibleModelsOptions,
): Promise<OpenAiCompatibleModelsResponse> {
  const endpoint = openAiModelsUrl(options.baseUrl);
  const apiFormat = normalizeApiFormat(options.apiFormat);
  try {
    const response = await requestUrl({
      url: endpoint,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authenticationHeaders(options.apiKey, apiFormat),
      },
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) throw requestError();
    const models = modelIdsFromPayload(response.json);
    return { endpoint, models };
  } catch {
    throw requestError();
  }
}

export async function fetchCcSwitchProviderModels(options: {
  dbPath?: string;
  appType: string;
  providerId: string;
}): Promise<CcSwitchModelListResponse> {
  const runtime = resolveCcSwitchProviderRuntime({
    ...options,
    followCurrent: false,
  });
  return fetchOpenAiCompatibleModels({
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    apiFormat: normalizeApiFormat(runtime.apiFormat),
  });
}

export async function probeOpenAiCompatibleModel(
  options: OpenAiModelProbeOptions,
): Promise<OpenAiModelProbeResult> {
  const endpoint =
    options.apiFormat === "anthropic_messages"
      ? apiEndpoint(options.baseUrl, "messages")
      : options.apiFormat === "responses"
        ? apiEndpoint(options.baseUrl, "responses")
        : apiEndpoint(options.baseUrl, "chat/completions");
  const body =
    options.apiFormat === "anthropic_messages"
      ? {
          model: options.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }
      : options.apiFormat === "responses"
        ? { model: options.model, input: "ping", max_output_tokens: 16 }
        : {
            model: options.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          };
  try {
    const response = await requestUrl({
      url: endpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authenticationHeaders(options.apiKey, options.apiFormat),
      },
      body: JSON.stringify(body),
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) throw requestError();
    return { endpoint, model: options.model };
  } catch {
    throw requestError();
  }
}
