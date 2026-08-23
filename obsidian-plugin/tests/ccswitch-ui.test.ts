/** DOM-level tests for the restored provider directory layout. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { CcSwitchProviderSettingsView } from "../src/ccswitch-settings";
import { normalizeSettings, type VideoMemoSettings } from "../src/settings";
import { __setRequestUrlHandler } from "./mocks/obsidian";
import { codexSettingsConfig, codexToml, createFixtureDb, insertProvider } from "./helpers";
import {
  buttonByText,
  clearNotices,
  click,
  firstTextInput,
  flushPromises,
  lastNotice,
  selectInto,
  textOf,
  typeInto,
} from "./ui-helpers";

interface ViewHarness {
  container: HTMLElement;
  settings: VideoMemoSettings;
  view: CcSwitchProviderSettingsView;
  updateCalls: Array<Record<string, unknown>>;
  render: () => void;
}

function makeHarness(overrides: Partial<VideoMemoSettings> = {}): ViewHarness {
  const harness: ViewHarness = {
    container: document.body.createDiv({ cls: "test-host" }),
    settings: { ...normalizeSettings(null), ...overrides },
    view: null as never,
    updateCalls: [],
    render: () => {
      harness.container.empty();
      harness.view.render(harness.container);
    },
  };
  harness.view = new CcSwitchProviderSettingsView({
    app: {} as never,
    getSettings: () => harness.settings,
    updateSettings: async (patch) => {
      Object.assign(harness.settings, patch);
      harness.updateCalls.push(patch);
      harness.render();
    },
    rerender: () => harness.render(),
    onBack: () => undefined,
  });
  harness.render();
  return harness;
}

function openModal(): HTMLElement {
  const modal = document.body.querySelector<HTMLElement>(".video-memo-provider-editor");
  if (!modal) throw new Error("provider editor modal did not open");
  return modal;
}

const envBackup: Record<string, string | undefined> = {};
function setEnv(name: string, value: string): void {
  envBackup[name] = process.env[name];
  process.env[name] = value;
}

beforeEach(() => {
  document.body.empty();
  clearNotices();
});

afterEach(() => {
  for (const [name, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  __setRequestUrlHandler(null);
});

describe("cc-switch provider directory", () => {
  test("restores the compact list and shows every provider", () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "current",
        name: "AgentRouter",
        appType: "claude",
        isCurrent: 1,
        settingsConfig: codexSettingsConfig(codexToml({ model: "claude-opus" })),
      });
      insertProvider(fixture.db, {
        id: "backup",
        name: "BackupRouter",
        appType: "claude",
        isCurrent: 0,
        settingsConfig: codexSettingsConfig(codexToml({ model: "claude-sonnet" })),
      });
      fixture.db.close();

      const harness = makeHarness({
        providerSource: "ccswitch",
        ccSwitchDbPath: fixture.path,
        ccSwitchAppType: "claude",
        ccSwitchFollowCurrent: true,
      });

      assert.equal(textOf(harness.container.querySelector(".ccswitch-heading h2")), "供应商");
      assert.equal(harness.container.querySelectorAll(".ccswitch-provider-row").length, 2);
      const rows = Array.from(harness.container.querySelectorAll<HTMLElement>(".ccswitch-provider-row"));
      assert.match(textOf(rows[0]), /AgentRouter/);
      assert.match(textOf(rows[0]), /使用中/);
      assert.match(textOf(rows[1]), /BackupRouter/);
      assert.match(textOf(rows[1]), /claude-sonnet/);
      assert.ok(harness.container.querySelector(".ccswitch-type-tab.is-active"));
    } finally {
      fixture.cleanup();
    }
  });

  test("persists a stale app type and opens provider details", async () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "p1",
        name: "ClaudePro",
        appType: "claude",
        isCurrent: 1,
        settingsConfig: codexSettingsConfig(codexToml({ model: "claude-4" })),
      });
      fixture.db.close();
      const harness = makeHarness({
        providerSource: "ccswitch",
        ccSwitchDbPath: fixture.path,
        ccSwitchAppType: "codex",
        ccSwitchFollowCurrent: true,
      });
      assert.match(textOf(harness.container.querySelector(".ccswitch-type-tab.is-active")), /claude/);
      assert.deepEqual(harness.updateCalls.find((patch) => "ccSwitchAppType" in patch), {
        ccSwitchAppType: "claude",
        ccSwitchProviderId: "",
        model: "",
      });

      click(harness.container.querySelector(".ccswitch-provider-row") as Element);
      assert.ok(harness.container.querySelector(".ccswitch-detail-hero"));
      assert.match(textOf(harness.container), /ClaudePro/);
      const modelSelect = harness.container.querySelector<HTMLSelectElement>(".ccswitch-model-select");
      assert.ok(modelSelect);
      assert.equal(modelSelect.value, "");
      selectInto(modelSelect, "");
      await flushPromises();
      assert.equal(harness.settings.model, "");
      click(buttonByText(harness.container, "返回供应商"));
      assert.ok(harness.container.querySelector(".ccswitch-provider-list"));
    } finally {
      fixture.cleanup();
    }
  });

  test("model discovery fills the dropdown and selection persists", async () => {
    setEnv("OPENAI_API_KEY", "sk-env-secret");
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
      __setRequestUrlHandler(async () => ({
        status: 200,
        json: { data: [{ id: "gpt-5" }, { id: "gpt-4o" }] },
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      }));
      const harness = makeHarness({
        providerSource: "ccswitch",
        ccSwitchDbPath: fixture.path,
        ccSwitchAppType: "codex",
        ccSwitchFollowCurrent: true,
      });
      click(harness.container.querySelector(".ccswitch-provider-row") as Element);
      click(buttonByText(harness.container, "发现模型"));
      await flushPromises();
      const select = harness.container.querySelector<HTMLSelectElement>(".ccswitch-model-select");
      assert.ok(select);
      assert.deepEqual(
        Array.from(select.options).map((option) => option.value),
        ["", "gpt-4o", "gpt-5"],
      );
      assert.equal(document.body.querySelector(".video-memo-provider-model-picker"), null);
      selectInto(select, "gpt-5");
      await flushPromises();
      assert.equal(harness.settings.model, "gpt-5");
      assert.equal(harness.container.querySelector<HTMLSelectElement>(".ccswitch-model-select")?.value, "gpt-5");
      selectInto(harness.container.querySelector<HTMLSelectElement>(".ccswitch-model-select")!, "");
      await flushPromises();
      assert.equal(harness.settings.model, "");
    } finally {
      fixture.cleanup();
    }
  });

  test("selecting a model automatically fixes the viewed provider", async () => {
    setEnv("OPENAI_API_KEY", "sk-env-secret");
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "current",
        name: "Current",
        appType: "codex",
        isCurrent: 1,
        settingsConfig: codexSettingsConfig(codexToml({ envKey: "OPENAI_API_KEY", model: "gpt-current" })),
      });
      insertProvider(fixture.db, {
        id: "backup",
        name: "Backup",
        appType: "codex",
        isCurrent: 0,
        settingsConfig: codexSettingsConfig(codexToml({ envKey: "OPENAI_API_KEY", model: "gpt-backup" })),
      });
      fixture.db.close();
      __setRequestUrlHandler(async () => ({
        status: 200,
        json: { data: [{ id: "gpt-backup" }, { id: "gpt-4o" }] },
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      }));
      const harness = makeHarness({
        providerSource: "ccswitch",
        ccSwitchDbPath: fixture.path,
        ccSwitchAppType: "codex",
        ccSwitchFollowCurrent: true,
        model: "stale-model",
      });
      const backupRow = Array.from(harness.container.querySelectorAll<HTMLElement>(".ccswitch-provider-row"))
        .find((row) => /Backup/.test(textOf(row)));
      assert.ok(backupRow);
      click(backupRow);
      const modelSelect = harness.container.querySelector<HTMLSelectElement>(".ccswitch-model-select");
      assert.equal(modelSelect?.disabled, false);
      assert.equal(buttonByText(harness.container, "发现模型").disabled, false);

      click(buttonByText(harness.container, "发现模型"));
      await flushPromises();
      selectInto(harness.container.querySelector<HTMLSelectElement>(".ccswitch-model-select")!, "gpt-backup");
      await flushPromises();
      assert.equal(harness.settings.ccSwitchFollowCurrent, false);
      assert.equal(harness.settings.ccSwitchProviderId, "backup");
      assert.equal(harness.settings.model, "gpt-backup");
      assert.equal(harness.container.querySelector<HTMLSelectElement>(".ccswitch-model-select")?.disabled, false);

      click(buttonByText(harness.container, "跟随全局当前"));
      await flushPromises();
      assert.equal(harness.settings.ccSwitchFollowCurrent, true);
      assert.equal(harness.settings.ccSwitchProviderId, "");
      assert.equal(harness.settings.model, "");
    } finally {
      fixture.cleanup();
    }
  });

  test("refreshes the database, switches app types, and restores the default path", async () => {
    const fixture = createFixtureDb();
    try {
      insertProvider(fixture.db, {
        id: "codex",
        name: "CodexProvider",
        appType: "codex",
        isCurrent: 1,
        settingsConfig: codexSettingsConfig(codexToml({ model: "gpt-5" })),
      });
      insertProvider(fixture.db, {
        id: "claude",
        name: "ClaudeProvider",
        appType: "claude",
        isCurrent: 1,
        settingsConfig: codexSettingsConfig(codexToml({ model: "claude-4" })),
      });
      fixture.db.close();
      const harness = makeHarness({
        providerSource: "ccswitch",
        ccSwitchDbPath: fixture.path,
        ccSwitchAppType: "codex",
      });
      click(buttonByText(harness.container, "刷新"));
      assert.ok(harness.container.querySelector(".ccswitch-provider-list"));
      click(buttonByText(harness.container, "claude (1)"));
      await flushPromises();
      assert.equal(harness.settings.ccSwitchAppType, "claude");
      assert.match(textOf(harness.container.querySelector(".ccswitch-provider-row")), /ClaudeProvider/);
      click(buttonByText(harness.container, "默认路径"));
      await flushPromises();
      assert.equal(harness.settings.ccSwitchDbPath, "");
      assert.equal(
        harness.container.querySelector<HTMLInputElement>(".ccswitch-database-input")?.value,
        "",
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("shows a readable database error", () => {
    const harness = makeHarness({
      providerSource: "ccswitch",
      ccSwitchDbPath: "Z:\\missing\\cc-switch.db",
    });
    assert.match(textOf(harness.container.querySelector(".ccswitch-error")), /无法读取 cc-switch/);
  });
});

describe("custom provider directory", () => {
  test("switches source and shows the empty state", async () => {
    const harness = makeHarness({ providerSource: "ccswitch" });
    const customButton = Array.from(harness.container.querySelectorAll(".ccswitch-source-button")).find(
      (button) => textOf(button) === "自定义",
    );
    click(customButton as Element);
    await flushPromises();
    assert.equal(harness.settings.providerSource, "custom");
    assert.match(textOf(harness.container.querySelector(".ccswitch-empty")), /尚未添加供应商/);
  });

  test("adds, masks, selects, edits, and deletes providers", async () => {
    const harness = makeHarness({ providerSource: "custom", customProviders: [] });
    click(buttonByText(harness.container, "添加供应商"));
    const modal = openModal();
    typeInto(firstTextInput(modal), "MyProvider");
    const textInputs = modal.querySelectorAll<HTMLInputElement>('input[type="text"]');
    typeInto(textInputs[1], "https://api.example.com/v1/");
    typeInto(modal.querySelector<HTMLInputElement>('input[type="password"]')!, "sk-secret-1234");
    typeInto(textInputs[2], "gpt-5");
    click(buttonByText(modal, "保存"));
    await flushPromises();

    assert.equal(harness.settings.customProviders.length, 1);
    const row = harness.container.querySelector(".ccswitch-custom-provider-entry");
    assert.ok(row);
    assert.match(textOf(row), /MyProvider/);
    assert.match(textOf(row), /gpt-5/);
    assert.doesNotMatch(textOf(row), /sk-secret-1234/);

    const second = {
      id: "second",
      name: "Second",
      baseUrl: "https://second.example/v1",
      apiKey: "sk-second",
      model: "m2",
      apiFormat: "chat_completions" as const,
    };
    harness.settings.customProviders.push(second);
    harness.render();
    let secondRow = Array.from(harness.container.querySelectorAll<HTMLElement>(".ccswitch-custom-provider-entry")).find(
      (entry) => /Second/.test(textOf(entry)),
    );
    click(buttonByText(secondRow!, "使用"));
    await flushPromises();
    assert.equal(harness.settings.activeCustomProviderId, "second");
    secondRow = Array.from(harness.container.querySelectorAll<HTMLElement>(".ccswitch-custom-provider-entry")).find(
      (entry) => /Second/.test(textOf(entry)),
    );
    click(buttonByText(secondRow!, "编辑"));
    const editModal = openModal();
    assert.equal(firstTextInput(editModal).value, "Second");
    click(buttonByText(editModal, "取消"));
    secondRow = Array.from(harness.container.querySelectorAll<HTMLElement>(".ccswitch-custom-provider-entry")).find(
      (entry) => /Second/.test(textOf(entry)),
    );
    click(buttonByText(secondRow!, "删除"));
    await flushPromises();
    assert.equal(harness.settings.customProviders.length, 1);
  });
});

describe("provider editor", () => {
  test("rejects a non-root URL and discovers models", async () => {
    __setRequestUrlHandler(async () => ({
      status: 200,
      json: { data: [{ id: "gpt-5" }] },
      text: "",
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));
    const harness = makeHarness({ providerSource: "custom" });
    click(buttonByText(harness.container, "添加供应商"));
    const modal = openModal();
    typeInto(firstTextInput(modal), "P");
    const inputs = modal.querySelectorAll<HTMLInputElement>('input[type="text"]');
    typeInto(inputs[1], "https://api.example.com/v1/chat/completions");
    typeInto(modal.querySelector<HTMLInputElement>('input[type="password"]')!, "sk-x");
    typeInto(inputs[2], "m1");
    click(buttonByText(modal, "保存"));
    assert.match(lastNotice(), /API 根地址/);
    assert.equal(harness.settings.customProviders.length, 0);

    typeInto(inputs[1], "https://api.example.com/v1");
    click(buttonByText(modal, "发现模型"));
    await flushPromises();
    assert.ok(modal.querySelector(".video-memo-provider-model-results select"));
  });

  test("tests connection and cancels without saving", async () => {
    __setRequestUrlHandler(async () => ({
      status: 200,
      json: {},
      text: "",
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));
    const harness = makeHarness({ providerSource: "custom" });
    click(buttonByText(harness.container, "添加供应商"));
    const modal = openModal();
    typeInto(firstTextInput(modal), "P");
    const inputs = modal.querySelectorAll<HTMLInputElement>('input[type="text"]');
    typeInto(inputs[1], "https://api.example.com/v1");
    typeInto(modal.querySelector<HTMLInputElement>('input[type="password"]')!, "sk-x");
    typeInto(inputs[2], "m1");
    click(buttonByText(modal, "测试连接"));
    await flushPromises();
    assert.equal(lastNotice(), "连接测试成功");
    click(buttonByText(modal, "取消"));
    assert.equal(harness.settings.customProviders.length, 0);
  });
});
