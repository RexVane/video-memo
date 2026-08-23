/**
 * Unit tests for src/ccswitch.ts.
 *
 * Runs against the real node:sqlite module (Node >= 22.13), so the SQLite
 * cache and WAL invalidation behavior are exercised against a genuine
 * database. The `obsidian` import is aliased to tests/mocks/obsidian.ts by the
 * esbuild test bundle.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, test } from "node:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  defaultCcSwitchDbPath,
  fetchOpenAiCompatibleModels,
  loadCcSwitchProviders,
  nodeSqliteSupported,
  normalizeApiFormat,
  normalizeOpenAiBaseUrl,
  openAiModelsUrl,
  probeOpenAiCompatibleModel,
  resolveCcSwitchDbPath,
  resolveCcSwitchProviderRuntime,
  resolveEffectiveAppType,
} from "../src/ccswitch";
import {
  __clearRequestUrlHandler,
  __setRequestUrlHandler,
} from "./mocks/obsidian";
import {
  codexSettingsConfig,
  codexToml,
  createFixtureDb,
  insertProvider,
  type FixtureDb,
} from "./helpers";

const envBackup: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  envBackup[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  __clearRequestUrlHandler();
});

describe("normalizeOpenAiBaseUrl", () => {
  test("keeps a well-formed v1 base URL", () => {
    assert.equal(
      normalizeOpenAiBaseUrl("https://api.openai.com/v1"),
      "https://api.openai.com/v1",
    );
  });

  test("strips trailing slashes", () => {
    assert.equal(
      normalizeOpenAiBaseUrl("https://api.openai.com/v1/"),
      "https://api.openai.com/v1",
    );
    assert.equal(
      normalizeOpenAiBaseUrl("https://example.com/"),
      "https://example.com",
    );
  });

  test("accepts http and localhost", () => {
    assert.equal(
      normalizeOpenAiBaseUrl("http://localhost:8000/v1"),
      "http://localhost:8000/v1",
    );
  });

  test("trims surrounding whitespace", () => {
    assert.equal(
      normalizeOpenAiBaseUrl("  https://api.openai.com/v1  "),
      "https://api.openai.com/v1",
    );
  });

  test("rejects an empty or blank value", () => {
    assert.throws(() => normalizeOpenAiBaseUrl(""), /Base URL/);
    assert.throws(() => normalizeOpenAiBaseUrl("   "), /Base URL/);
  });

  test("rejects a non-URL value", () => {
    assert.throws(() => normalizeOpenAiBaseUrl("not a url"), /无效/);
  });

  test("rejects non-http(s) protocols", () => {
    assert.throws(() => normalizeOpenAiBaseUrl("ftp://example.com"), /HTTP 或 HTTPS/);
  });

  test("rejects embedded credentials", () => {
    assert.throws(
      () => normalizeOpenAiBaseUrl("https://user:pass@example.com/v1"),
      /凭据/,
    );
  });

  test("rejects query strings and hashes", () => {
    assert.throws(
      () => normalizeOpenAiBaseUrl("https://example.com/v1?key=1"),
      /查询参数或锚点/,
    );
    assert.throws(
      () => normalizeOpenAiBaseUrl("https://example.com/v1#frag"),
      /查询参数或锚点/,
    );
  });

  test("rejects full API endpoints instead of the root", () => {
    for (const endpoint of [
      "https://example.com/v1/chat/completions",
      "https://example.com/v1/responses",
      "https://example.com/v1/messages",
      "https://example.com/v1/models",
    ]) {
      assert.throws(() => normalizeOpenAiBaseUrl(endpoint), /API 根地址/);
    }
  });

  test("keeps a mixed-case v1 path for downstream case-insensitive checks", () => {
    assert.equal(
      normalizeOpenAiBaseUrl("https://example.com/V1"),
      "https://example.com/V1",
    );
  });
});

describe("resolveEffectiveAppType (Fix 1)", () => {
  const provider = (appType: string) =>
    ({
      id: `p-${appType}`,
      appType,
      name: appType,
      category: null,
      websiteUrl: null,
      notes: null,
      sortIndex: null,
      createdAt: null,
      isCurrent: false,
      baseUrl: null,
      model: null,
      apiFormat: "chat_completions",
      maskedEnv: {},
      configParseError: false,
      redactedSettingsConfig: "{}",
      providerType: null,
      usable: false,
    }) as const;

  test("keeps the saved type when it exists in the database", () => {
    const result = resolveEffectiveAppType("codex", [
      provider("codex"),
      provider("claude"),
    ]);
    assert.deepEqual(result, { appType: "codex", persisted: false });
  });

  test("falls back to the first available type when the saved one is gone", () => {
    const result = resolveEffectiveAppType("codex", [
      provider("claude"),
      provider("grok"),
    ]);
    assert.deepEqual(result, { appType: "claude", persisted: true });
  });

  test("returns the saved type unchanged when there are no providers", () => {
    const result = resolveEffectiveAppType("codex", []);
    assert.deepEqual(result, { appType: "codex", persisted: false });
  });

  test("deduplicates app types from multiple providers", () => {
    const result = resolveEffectiveAppType("grok", [
      provider("claude"),
      provider("claude"),
      provider("codex"),
    ]);
    assert.deepEqual(result, { appType: "claude", persisted: true });
  });
});

describe("normalizeApiFormat", () => {
  test("defaults to chat_completions", () => {
    assert.equal(normalizeApiFormat(undefined), "chat_completions");
    assert.equal(normalizeApiFormat(null), "chat_completions");
    assert.equal(normalizeApiFormat(""), "chat_completions");
    assert.equal(normalizeApiFormat(42), "chat_completions");
    assert.equal(normalizeApiFormat("unknown_format"), "chat_completions");
  });

  test("maps anthropic variants", () => {
    for (const value of [
      "anthropic",
      "anthropic_messages",
      "messages",
      "ANTHROPIC-MESSAGES",
    ]) {
      assert.equal(normalizeApiFormat(value), "anthropic_messages");
    }
  });

  test("maps responses variants", () => {
    for (const value of ["responses", "response", "openai_responses"]) {
      assert.equal(normalizeApiFormat(value), "responses");
    }
  });

  test("keeps chat_completions", () => {
    assert.equal(normalizeApiFormat("chat_completions"), "chat_completions");
    assert.equal(normalizeApiFormat("chat"), "chat_completions");
  });
});

describe("cc-switch database path resolution", () => {
  test("default path lives under the home directory", () => {
    assert.equal(
      defaultCcSwitchDbPath(),
      join(homedir(), ".cc-switch", "cc-switch.db"),
    );
  });

  test("empty configuration resolves to the default path", () => {
    assert.equal(resolveCcSwitchDbPath(""), defaultCcSwitchDbPath());
  });

  test("expands a leading tilde", () => {
    assert.equal(
      resolveCcSwitchDbPath("~/apps/cc-switch.db"),
      join(homedir(), "apps", "cc-switch.db"),
    );
  });

  test("keeps absolute and relative paths", () => {
    const absolute = "C:\\Users\\me\\cc-switch.db";
    assert.equal(resolveCcSwitchDbPath(absolute), resolve(absolute));
    assert.equal(
      resolveCcSwitchDbPath("data/cc-switch.db"),
      resolve("data/cc-switch.db"),
    );
  });
});

describe("openAiModelsUrl", () => {
  test("appends /models to a v1 base", () => {
    assert.equal(
      openAiModelsUrl("https://api.openai.com/v1"),
      "https://api.openai.com/v1/models",
    );
  });

  test("adds the /v1 segment when missing", () => {
    assert.equal(
      openAiModelsUrl("https://example.com"),
      "https://example.com/v1/models",
    );
  });
});

describe("loadCcSwitchProviders (real SQLite)", () => {
  test("extracts a codex provider with env-key API key", () => {
    const fixture = createFixtureDb();
    try {
      setEnv("OPENAI_API_KEY", "sk-env-secret");
      insertProvider(fixture.db, {
        id: "p1",
        name: "OpenAI",
        appType: "codex",
        isCurrent: 1,
        sortIndex: 10,
        websiteUrl: "https://openai.com",
        settingsConfig: codexSettingsConfig(
          codexToml({ envKey: "OPENAI_API_KEY", wireApi: "responses" }),
        ),
      });
      fixture.db.close();

      const { providers, dbPath } = loadCcSwitchProviders(fixture.path);
      assert.equal(dbPath, fixture.path);
      assert.equal(providers.length, 1);
      const provider = providers[0];
      assert.equal(provider.id, "p1");
      assert.equal(provider.name, "OpenAI");
      assert.equal(provider.appType, "codex");
      assert.equal(provider.baseUrl, "https://api.openai.com/v1");
      assert.equal(provider.apiFormat, "responses");
      assert.equal(provider.isCurrent, true);
      assert.equal(provider.usable, true);
      assert.equal(provider.configParseError, false);
      assert.equal(provider.websiteUrl, "https://openai.com");
      assert.equal(provider.sortIndex, 10);
      assert.equal(provider.redactedSettingsConfig.includes("sk-env-secret"), false);
      assert.equal(provider.redactedSettingsConfig.includes("apiKeyConfigured\":true"), true);
    } finally {
      fixture.cleanup();
    }
  });

  test("reads a direct API key and marks unusable providers", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "p1",
        appType: "codex",
        settingsConfig: JSON.stringify({
          config: `model_provider = "openai"\n\n[model_providers.openai]\nbase_url = "https://api.openai.com/v1"\napi_key = "sk-direct"`,
        }),
      });
      insertProvider(fixture.db, {
        id: "p2",
        name: "NoKey",
        appType: "codex",
        settingsConfig: JSON.stringify({
          config: `[model_providers.anon]\nbase_url = "https://example.com"`,
        }),
      });
      fixture.db.close();

      const providers = loadCcSwitchProviders(fixture.path).providers;
      const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
      assert.equal(byId.p1.usable, true);
      assert.equal(byId.p1.baseUrl, "https://api.openai.com/v1");
      assert.equal(byId.p2.usable, false);
      assert.equal(byId.p2.apiFormat, "chat_completions");
    } finally {
      fixture.cleanup();
    }
  });

  test("extracts a grok provider model and format", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "g1",
        appType: "grok",
        settingsConfig: JSON.stringify({
          config: `models.default = "grok-4"\n\n[model.grok-4]\nbase_url = "https://api.x.ai/v1"\napi_key = "sk-grok"`,
        }),
        meta: JSON.stringify({ apiFormat: "chat_completions" }),
      });
      fixture.db.close();

      const provider = loadCcSwitchProviders(fixture.path).providers[0];
      assert.equal(provider.model, "grok-4");
      assert.equal(provider.appType, "grok");
      assert.equal(provider.baseUrl, "https://api.x.ai/v1");
      assert.equal(provider.usable, true);
    } finally {
      fixture.cleanup();
    }
  });

  test("extracts model, base URL and key from claude-code {name, value} arrays", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "cl1",
        name: "AgentRouter",
        appType: "claude",
        isCurrent: 1,
        settingsConfig: JSON.stringify({
          "claudeCode.environmentVariables": [
            { name: "ANTHROPIC_AUTH_TOKEN", value: "sk-array-secret" },
            { name: "ANTHROPIC_BASE_URL", value: "https://agentrouter.org" },
            { name: "ANTHROPIC_MODEL", value: "claude-opus-4-8" },
            { name: "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", value: "1" },
          ],
        }),
        meta: JSON.stringify({ apiFormat: "anthropic" }),
      });
      fixture.db.close();

      const provider = loadCcSwitchProviders(fixture.path).providers[0];
      assert.equal(provider.name, "AgentRouter");
      // The model, base URL and key all live inside the environment array;
      // nothing should be lost to array-shaped config.
      assert.equal(provider.model, "claude-opus-4-8");
      assert.equal(provider.baseUrl, "https://agentrouter.org");
      assert.equal(provider.apiFormat, "anthropic_messages");
      assert.equal(provider.usable, true);
      assert.equal(provider.redactedSettingsConfig.includes("sk-array-secret"), false);
    } finally {
      fixture.cleanup();
    }
  });

  test("marks configParseError for invalid settings JSON", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "bad",
        appType: "codex",
        settingsConfig: "{not valid json",
      });
      fixture.db.close();

      const provider = loadCcSwitchProviders(fixture.path).providers[0];
      assert.equal(provider.configParseError, true);
      assert.equal(provider.usable, false);
    } finally {
      fixture.cleanup();
    }
  });

  test("sorts by app type, then sort index, then name", () => {
    const fixture = createFixtureDb();
    try {
      for (const row of [
        { id: "a1", appType: "codex", sortIndex: 2, name: "Zeta" },
        { id: "a2", appType: "codex", sortIndex: 1, name: "Alpha" },
        { id: "b1", appType: "claude", sortIndex: 5, name: "Claude" },
        { id: "c1", appType: "codex", sortIndex: 1, name: "Beta" },
      ]) {
        insertProvider(fixture.db, row);
      }
      fixture.db.close();

      const ids = loadCcSwitchProviders(fixture.path).providers.map((p) => p.id);
      assert.deepEqual(ids, ["b1", "a2", "c1", "a1"]);
    } finally {
      fixture.cleanup();
    }
  });

  test("rejects a non-.db path and a missing database", () => {
    const fixture = createFixtureDb();
    try {
      fixture.db.close();
      assert.throws(
        () => loadCcSwitchProviders(join(fixture.path, "..", "config.json")),
        /\.db 文件/,
      );
      assert.throws(
        () => loadCcSwitchProviders(join(fixture.path, "missing.db")),
        /未找到 cc-switch 数据库/,
      );
    } finally {
      fixture.cleanup();
    }
  });
});

describe("provider cache and WAL invalidation (Fix 2)", () => {
  test("re-reads when the main .db file changes", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, { id: "p1", appType: "codex" });
      fixture.db.close();

      assert.equal(loadCcSwitchProviders(fixture.path).providers.length, 1);

      const writer = new DatabaseSync(fixture.path);
      insertProvider(writer, { id: "p2", appType: "codex" });
      writer.close();

      const second = loadCcSwitchProviders(fixture.path);
      assert.equal(second.providers.length, 2);
    } finally {
      fixture.cleanup();
    }
  });

  test("re-reads when only the -wal sidecar changes (WAL mode)", () => {
    const fixture = createFixtureDb();
    try {
      const { db, path } = fixture;
      // Writes now land in the -wal file; the main .db stays untouched, so
      // only the sidecar signature can tell the cache the data changed.
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA wal_autocheckpoint = 0");
      insertProvider(db, {
        id: "p1",
        appType: "codex",
        isCurrent: 1,
        settingsConfig: codexSettingsConfig(
          codexToml({ envKey: "OPENAI_API_KEY" }),
        ),
      });

      const first = loadCcSwitchProviders(path);
      assert.equal(first.providers.length, 1);
      assert.equal(first.providers[0].id, "p1");

      insertProvider(db, { id: "p2", appType: "codex" });

      const second = loadCcSwitchProviders(path);
      assert.equal(second.providers.length, 2, "must see rows from the WAL");
      assert.equal(second.providers[0].id, "p1");
    } finally {
      fixture.cleanup();
    }
  });

  test("serves consistent data on repeated reads and isolates paths", () => {
    const fixtureA = createFixtureDb();
    const fixtureB = createFixtureDb();
    try {
      insertProvider(fixtureA.db, { id: "a1", appType: "codex", name: "A" });
      insertProvider(fixtureB.db, { id: "b1", appType: "grok", name: "B" });
      fixtureA.db.close();
      fixtureB.db.close();

      const firstA = loadCcSwitchProviders(fixtureA.path).providers;
      const firstB = loadCcSwitchProviders(fixtureB.path).providers;
      const secondA = loadCcSwitchProviders(fixtureA.path).providers;
      const secondB = loadCcSwitchProviders(fixtureB.path).providers;

      assert.deepEqual(
        secondA.map((p) => p.id),
        firstA.map((p) => p.id),
      );
      assert.deepEqual(
        secondB.map((p) => p.id),
        firstB.map((p) => p.id),
      );
      assert.deepEqual(firstA.map((p) => p.id), ["a1"]);
    } finally {
      fixtureA.cleanup();
      fixtureB.cleanup();
    }
  });
});

describe("resolveCcSwitchProviderRuntime", () => {
  let fixture: FixtureDb;

  beforeEach(() => {
    fixture = createFixtureDb();
  });

  afterEach(() => fixture.cleanup());

  test("selects the current provider when followCurrent is set", () => {
    setEnv("OPENAI_API_KEY", "sk-env-secret");
    insertProvider(fixture.db, {
      id: "old",
      appType: "codex",
      isCurrent: 0,
      settingsConfig: codexSettingsConfig(
        codexToml({ envKey: "OPENAI_API_KEY", model: "gpt-5" }),
      ),
    });
    insertProvider(fixture.db, {
      id: "current",
      appType: "codex",
      isCurrent: 1,
      settingsConfig: codexSettingsConfig(
        codexToml({ envKey: "OPENAI_API_KEY", model: "gpt-4o" }),
      ),
    });
    fixture.db.close();

    const runtime = resolveCcSwitchProviderRuntime({
      dbPath: fixture.path,
      appType: "codex",
      followCurrent: true,
    });
    assert.equal(runtime.id, "current");
    assert.equal(runtime.name, "current");
    assert.equal(runtime.baseUrl, "https://api.openai.com/v1");
    assert.equal(runtime.model, "gpt-4o");
    assert.equal(runtime.apiKey, "sk-env-secret");
    assert.equal(runtime.apiFormat, "chat_completions");
  });

  test("selects a provider by id when not following the current one", () => {
    setEnv("OPENAI_API_KEY", "sk-env-secret");
    insertProvider(fixture.db, {
      id: "target",
      appType: "codex",
      isCurrent: 0,
      settingsConfig: codexSettingsConfig(
        codexToml({ envKey: "OPENAI_API_KEY" }),
      ),
    });
    fixture.db.close();

    const runtime = resolveCcSwitchProviderRuntime({
      dbPath: fixture.path,
      appType: "codex",
      followCurrent: false,
      providerId: "target",
    });
    assert.equal(runtime.id, "target");
  });

  test("filters by app type", () => {
    insertProvider(fixture.db, {
      id: "claude1",
      appType: "claude",
      isCurrent: 1,
      settingsConfig: codexSettingsConfig(
        codexToml({ envKey: "ANTHROPIC_API_KEY" }),
      ),
    });
    fixture.db.close();

    assert.throws(
      () =>
        resolveCcSwitchProviderRuntime({
          dbPath: fixture.path,
          appType: "codex",
          followCurrent: true,
        }),
      /未找到所选供应商/,
    );
  });

  test("throws when the provider has no usable API key", () => {
    insertProvider(fixture.db, {
      id: "nokey",
      appType: "codex",
      isCurrent: 1,
      settingsConfig: codexSettingsConfig(
        codexToml({ baseUrl: "https://example.com/v1" }),
      ),
    });
    fixture.db.close();

    assert.throws(
      () =>
        resolveCcSwitchProviderRuntime({
          dbPath: fixture.path,
          appType: "codex",
          followCurrent: true,
        }),
      /缺少可用的 API Key/,
    );
  });
});

describe("fetchOpenAiCompatibleModels (mocked requestUrl)", () => {
  test("parses a data array, dedupes, and sorts", async () => {
    __setRequestUrlHandler(async (options) => {
      assert.equal(options.method, "GET");
      assert.equal(options.url, "https://api.openai.com/v1/models");
      assert.equal(options.headers?.Authorization, "Bearer sk-test");
      return {
        status: 200,
        json: { data: [{ id: "gpt-5" }, { id: "gpt-4o" }, { id: "gpt-5" }] },
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      };
    });

    const result = await fetchOpenAiCompatibleModels({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });
    assert.deepEqual(result.models, ["gpt-4o", "gpt-5"]);
    assert.equal(result.endpoint, "https://api.openai.com/v1/models");
  });

  test("parses a flat string array and a grok-style models object", async () => {
    __setRequestUrlHandler(async () => ({
      status: 200,
      json: { models: ["b", "a"] },
      text: "",
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));
    const flat = await fetchOpenAiCompatibleModels({
      baseUrl: "https://x.test",
      apiKey: "k",
    });
    assert.deepEqual(flat.models, ["a", "b"]);
    assert.equal(flat.endpoint, "https://x.test/v1/models");
  });

  test("uses x-api-key headers for the anthropic wire format", async () => {
    __setRequestUrlHandler(async (options) => {
      assert.equal(options.headers?.["x-api-key"], "sk-anthropic");
      assert.equal(options.headers?.["anthropic-version"], "2023-06-01");
      assert.equal(options.headers?.Authorization, undefined);
      return {
        status: 200,
        json: { data: [{ id: "claude-4" }] },
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      };
    });
    const result = await fetchOpenAiCompatibleModels({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-anthropic",
      apiFormat: "anthropic_messages",
    });
    assert.deepEqual(result.models, ["claude-4"]);
  });

  test("throws a friendly error on non-2xx responses", async () => {
    __setRequestUrlHandler(async () => ({
      status: 401,
      json: { error: "unauthorized" },
      text: "",
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));
    await assert.rejects(
      fetchOpenAiCompatibleModels({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "bad",
      }),
      /供应商请求失败/,
    );
  });

  test("throws a friendly error on network failure", async () => {
    __setRequestUrlHandler(async () => {
      throw new Error("ECONNREFUSED");
    });
    await assert.rejects(
      fetchOpenAiCompatibleModels({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
      }),
      /供应商请求失败/,
    );
  });

  test("filters out empty and overlong model ids", async () => {
    __setRequestUrlHandler(async () => ({
      status: 200,
      json: {
        data: [
          { id: "" },
          { id: " ".repeat(250) },
          { id: "gpt-5" },
          { id: "gpt-4o" },
        ],
      },
      text: "",
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));
    const result = await fetchOpenAiCompatibleModels({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });
    assert.deepEqual(result.models, ["gpt-4o", "gpt-5"]);
  });
});

describe("probeOpenAiCompatibleModel (mocked requestUrl)", () => {
  test("posts a chat-completions ping", async () => {
    __setRequestUrlHandler(async (options) => {
      assert.equal(options.method, "POST");
      assert.equal(options.url, "https://api.openai.com/v1/chat/completions");
      assert.equal(options.headers?.Authorization, "Bearer sk-test");
      const body = JSON.parse(options.body ?? "{}");
      assert.equal(body.model, "gpt-5");
      assert.equal(body.messages[0].content, "ping");
      assert.equal(body.max_tokens, 1);
      return {
        status: 200,
        json: {},
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      };
    });
    const result = await probeOpenAiCompatibleModel({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-5",
      apiFormat: "chat_completions",
    });
    assert.equal(result.model, "gpt-5");
    assert.equal(result.endpoint, "https://api.openai.com/v1/chat/completions");
  });

  test("posts a responses-format ping with input text", async () => {
    __setRequestUrlHandler(async (options) => {
      assert.equal(options.url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body ?? "{}");
      assert.equal(body.input, "ping");
      assert.equal(body.max_output_tokens, 16);
      return {
        status: 200,
        json: {},
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      };
    });
    const result = await probeOpenAiCompatibleModel({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-5",
      apiFormat: "responses",
    });
    assert.equal(result.endpoint, "https://api.openai.com/v1/responses");
  });

  test("posts an anthropic messages ping with x-api-key", async () => {
    __setRequestUrlHandler(async (options) => {
      assert.equal(options.url, "https://api.anthropic.com/v1/messages");
      assert.equal(options.headers?.["x-api-key"], "sk-anthropic");
      const body = JSON.parse(options.body ?? "{}");
      assert.equal(body.max_tokens, 1);
      return {
        status: 200,
        json: {},
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      };
    });
    await probeOpenAiCompatibleModel({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-anthropic",
      model: "claude-4",
      apiFormat: "anthropic_messages",
    });
  });

  test("rejects non-2xx responses", async () => {
    __setRequestUrlHandler(async () => ({
      status: 429,
      json: {},
      text: "",
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));
    await assert.rejects(
      probeOpenAiCompatibleModel({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "gpt-5",
        apiFormat: "chat_completions",
      }),
      /供应商请求失败/,
    );
  });
});

describe("nodeSqliteSupported", () => {
  test("returns true on a runtime with node:sqlite", () => {
    assert.equal(nodeSqliteSupported(), true);
  });
});
