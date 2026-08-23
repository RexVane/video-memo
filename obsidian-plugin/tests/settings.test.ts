/**
 * Unit tests for src/settings.ts.
 *
 * settings.ts has no Obsidian imports of its own (the ccswitch-settings import
 * is type-only and erased), so these tests run against the plain module plus
 * the real node:sqlite-backed ccswitch helpers.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SETTINGS,
  activeCustomProvider,
  describeProviderSelection,
  normalizeSettings,
  sanitizeTargetFolder,
  type VideoMemoSettings,
} from "../src/settings";
import { codexSettingsConfig, codexToml, createFixtureDb, insertProvider } from "./helpers";

describe("sanitizeTargetFolder", () => {
  test("returns the default for non-string input", () => {
    assert.equal(sanitizeTargetFolder(null), "");
    assert.equal(sanitizeTargetFolder(undefined), "");
    assert.equal(sanitizeTargetFolder(42), "");
  });

  test("trims whitespace and normalizes separators", () => {
    assert.equal(sanitizeTargetFolder("  a \\ b  "), "a/b");
    assert.equal(sanitizeTargetFolder("a\\\\b\\c"), "a/b/c");
  });

  test("removes . and .. segments", () => {
    assert.equal(sanitizeTargetFolder("a/../b"), "a/b");
    assert.equal(sanitizeTargetFolder("./a"), "a");
    assert.equal(sanitizeTargetFolder("a/./b"), "a/b");
  });

  test("rejects Windows absolute paths", () => {
    assert.equal(sanitizeTargetFolder("C:\\Users\\me\\notes"), "");
    assert.equal(sanitizeTargetFolder("D:/notes"), "");
  });

  test("rejects an empty result", () => {
    assert.equal(sanitizeTargetFolder("   "), "");
    assert.equal(sanitizeTargetFolder("../.."), "");
  });
});

describe("normalizeSettings", () => {
  test("returns defaults for a null payload", () => {
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  });

  test("fills missing fields with defaults", () => {
    const settings = normalizeSettings({ projectPath: "C:\\video-memo" });
    assert.equal(settings.projectPath, "C:\\video-memo");
    assert.equal(settings.providerSource, "ccswitch");
    assert.equal(settings.ccSwitchAppType, "codex");
    assert.equal(settings.cleanupMedia, false);
  });

  test("forces providerSource into the known set", () => {
    assert.equal(
      normalizeSettings({ providerSource: "garbage" } as unknown as Partial<VideoMemoSettings>)
        .providerSource,
      "ccswitch",
    );
    assert.equal(normalizeSettings({ providerSource: "custom" }).providerSource, "custom");
  });

  test("migrates legacy single-provider fields", () => {
    const settings = normalizeSettings({
      customProviderBaseUrl: "https://api.example.com/v1",
      customProviderApiKey: "sk-legacy",
      customProviderName: "旧供应商",
      customProviderModel: "model-x",
      customProviderApiFormat: "responses",
    } as unknown as Partial<VideoMemoSettings>);
    assert.equal(settings.providerSource, "ccswitch");
    assert.equal(settings.customProviders.length, 1);
    const migrated = settings.customProviders[0];
    assert.equal(migrated.name, "旧供应商");
    assert.equal(migrated.baseUrl, "https://api.example.com/v1");
    assert.equal(migrated.apiKey, "sk-legacy");
    assert.equal(migrated.model, "model-x");
    assert.equal(migrated.apiFormat, "responses");
    assert.equal(settings.activeCustomProviderId, migrated.id);
  });

  test("normalizes custom provider entries and dedupes ids", () => {
    const settings = normalizeSettings({
      customProviders: [
        { id: "dup", name: "A", baseUrl: "https://a", apiKey: "k1", model: "m1", apiFormat: "anthropic" },
        { id: "dup", name: "B", baseUrl: "https://b", apiKey: "k2", model: "m2", apiFormat: "garbage" },
        { name: "C", baseUrl: "https://c", apiKey: "k3", model: "m3", apiFormat: "openai_responses" },
        "not-an-object",
        null,
      ],
    } as unknown as Partial<VideoMemoSettings>);
    assert.equal(settings.customProviders.length, 3);
    const [a, b, c] = settings.customProviders;
    assert.equal(a.id, "dup");
    assert.equal(b.id, "dup_1");
    assert.notEqual(c.id, "");
    assert.equal(a.apiFormat, "anthropic_messages");
    assert.equal(b.apiFormat, "chat_completions");
    assert.equal(c.apiFormat, "responses");
  });

  test("falls back to the first provider when activeCustomProviderId is stale", () => {
    const settings = normalizeSettings({
      customProviders: [
        {
          id: "one",
          name: "A",
          baseUrl: "https://a",
          apiKey: "k",
          model: "m",
          apiFormat: "chat_completions",
        },
      ],
      activeCustomProviderId: "missing",
    });
    assert.equal(settings.activeCustomProviderId, "one");
  });

  test("sanitizes the target folder", () => {
    // The .. segment is dropped but the remaining segment stays inside the vault.
    assert.equal(normalizeSettings({ targetFolder: "..\\evil" }).targetFolder, "evil");
    assert.equal(normalizeSettings({ targetFolder: ".." }).targetFolder, "");
    assert.equal(normalizeSettings({ targetFolder: "C:\\notes" }).targetFolder, "");
  });
});

describe("activeCustomProvider", () => {
  const base: VideoMemoSettings = {
    ...DEFAULT_SETTINGS,
    customProviders: [
      { id: "one", name: "A", baseUrl: "https://a", apiKey: "k", model: "m", apiFormat: "chat_completions" },
      { id: "two", name: "B", baseUrl: "https://b", apiKey: "k", model: "m", apiFormat: "chat_completions" },
    ],
  };

  test("returns null with no providers", () => {
    assert.equal(activeCustomProvider({ ...base, customProviders: [] }), null);
  });

  test("returns the provider matching the active id", () => {
    assert.equal(activeCustomProvider({ ...base, activeCustomProviderId: "two" })?.id, "two");
  });

  test("falls back to the first provider for an unknown id", () => {
    assert.equal(activeCustomProvider({ ...base, activeCustomProviderId: "nope" })?.id, "one");
  });
});

describe("describeProviderSelection", () => {
  test("reports missing custom providers", () => {
    const settings: VideoMemoSettings = { ...DEFAULT_SETTINGS, providerSource: "custom" };
    assert.equal(describeProviderSelection(settings), "自定义 · 尚未添加供应商");
  });

  test("reports incomplete custom provider config", () => {
    const settings: VideoMemoSettings = {
      ...DEFAULT_SETTINGS,
      providerSource: "custom",
      customProviders: [
        { id: "p", name: "MyProvider", baseUrl: "", apiKey: "", model: "", apiFormat: "chat_completions" },
      ],
    };
    assert.equal(describeProviderSelection(settings), "自定义 · MyProvider · 配置需要检查");
  });

  test("reports a complete custom provider with model", () => {
    const settings: VideoMemoSettings = {
      ...DEFAULT_SETTINGS,
      providerSource: "custom",
      customProviders: [
        { id: "p", name: "MyProvider", baseUrl: "https://api.x/v1", apiKey: "k", model: "gpt-5", apiFormat: "chat_completions" },
      ],
    };
    assert.equal(describeProviderSelection(settings), "自定义 · MyProvider · 模型 gpt-5");
  });

  test("reports the cc-switch current provider and model (Fix 1 badge)", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "p1",
        name: "OpenAI",
        appType: "codex",
        isCurrent: 1,
        settingsConfig: codexSettingsConfig(codexToml({ envKey: "OPENAI_API_KEY" })),
      });
      fixture.db.close();
      const settings: VideoMemoSettings = {
        ...DEFAULT_SETTINGS,
        providerSource: "ccswitch",
        ccSwitchDbPath: fixture.path,
        ccSwitchAppType: "codex",
        ccSwitchFollowCurrent: true,
      };
      assert.equal(
        describeProviderSelection(settings),
        "cc-switch · OpenAI · 跟随全局当前",
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("resolves a stale saved app type against the database (Fix 1)", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "c1",
        name: "ClaudePro",
        appType: "claude",
        isCurrent: 1,
        settingsConfig: codexSettingsConfig(
          codexToml({ envKey: "ANTHROPIC_API_KEY", model: "claude-4" }),
        ),
      });
      fixture.db.close();
      const settings: VideoMemoSettings = {
        ...DEFAULT_SETTINGS,
        providerSource: "ccswitch",
        ccSwitchDbPath: fixture.path,
        // The saved type is not in the database anymore.
        ccSwitchAppType: "codex",
        ccSwitchFollowCurrent: true,
      };
      const badge = describeProviderSelection(settings);
      assert.match(badge, /ClaudePro/);
      assert.match(badge, /claude-4/);
      assert.doesNotMatch(badge, /配置需要检查/);
    } finally {
      fixture.cleanup();
    }
  });

  test("reports when no cc-switch provider matches", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "c1",
        name: "ClaudePro",
        appType: "claude",
        isCurrent: 0,
        settingsConfig: codexSettingsConfig(codexToml({ envKey: "ANTHROPIC_API_KEY" })),
      });
      fixture.db.close();
      const settings: VideoMemoSettings = {
        ...DEFAULT_SETTINGS,
        providerSource: "ccswitch",
        ccSwitchDbPath: fixture.path,
        ccSwitchAppType: "codex",
        ccSwitchFollowCurrent: true,
      };
      assert.match(describeProviderSelection(settings), /配置需要检查/);
    } finally {
      fixture.cleanup();
    }
  });

  test("reports an unreadable database", () => {
    const settings: VideoMemoSettings = {
      ...DEFAULT_SETTINGS,
      providerSource: "ccswitch",
      ccSwitchDbPath: "Z:\\does-not-exist\\cc-switch.db",
    };
    assert.equal(describeProviderSelection(settings), "cc-switch · 无法读取数据库");
  });
});
