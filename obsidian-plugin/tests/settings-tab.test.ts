/**
 * DOM-level tests for VideoMemoSettingTab (the plugin settings page).
 *
 * A fake plugin object stands in for VideoMemoPlugin; the tab itself renders
 * into the jsdom document through the mocked Obsidian Setting component.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { VideoMemoSettingTab } from "../src/settings-tab";
import { normalizeSettings, type VideoMemoSettings } from "../src/settings";
import {
  click,
  firstTextInput,
  flushPromises,
  settingItem,
  settingNames,
  textOf,
  toggleInto,
  typeInto,
} from "./ui-helpers";

interface FakePlugin {
  settings: VideoMemoSettings;
  saveData: (data: VideoMemoSettings) => Promise<void>;
  saveCalls: number;
  resolvePython: (projectPath: string) => string;
  autoDetectProjectDirectory: (quiet: boolean) => string;
  autoDetectCalls: number;
}

function makeFakePlugin(): FakePlugin {
  const fake: FakePlugin = {
    settings: normalizeSettings(null),
    saveData: async (data) => {
      fake.settings = data;
      fake.saveCalls += 1;
    },
    saveCalls: 0,
    resolvePython: () => "python",
    autoDetectProjectDirectory: () => {
      fake.autoDetectCalls += 1;
      return "";
    },
    autoDetectCalls: 0,
  };
  return fake;
}

function makeTab(plugin: FakePlugin): VideoMemoSettingTab {
  return new VideoMemoSettingTab({} as never, plugin as never);
}

describe("VideoMemoSettingTab home page", () => {
  test("renders the intro, provider badge, and all setting rows", () => {
    const plugin = makeFakePlugin();
    const tab = makeTab(plugin);
    tab.display();

    const container = tab.containerEl;
    const heading = container.querySelector("h2");
    assert.equal(textOf(heading), "VideoMemo");

    assert.deepEqual(settingNames(container), [
      "供应商",
      "项目目录",
      "Python 路径",
      "Vault 目标文件夹（可选）",
      "完成后清理媒体",
    ]);

    // Provider badge: with no cc-switch database available it must degrade
    // gracefully instead of throwing.
    const providerSetting = settingItem(container, "供应商");
    assert.match(
      textOf(providerSetting?.querySelector(".setting-item-description")),
      /^cc-switch/,
    );
  });

  test("provider row navigates to the providers page on click and keyboard", () => {
    const plugin = makeFakePlugin();
    const tab = makeTab(plugin);
    tab.display();

    const providerRow = settingItem(tab.containerEl, "供应商");
    assert.ok(providerRow);
    click(providerRow);
    assert.ok(
      tab.containerEl.querySelector(".ccswitch-heading h2"),
      "providers view header should be visible",
    );

    // Back home, then navigate via Enter key.
    tab.showHome();
    tab.display();
    assert.ok(settingItem(tab.containerEl, "供应商"));
    const rowAgain = settingItem(tab.containerEl, "供应商");
    rowAgain?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    assert.ok(tab.containerEl.querySelector(".ccswitch-heading h2"));
  });

  test("project path input updates settings and saves", async () => {
    const plugin = makeFakePlugin();
    const tab = makeTab(plugin);
    tab.display();

    const projectSetting = settingItem(tab.containerEl, "项目目录");
    const input = firstTextInput(projectSetting!);
    typeInto(input, "  D:\\AIApp\\video-memo  ");
    await flushPromises();

    assert.equal(plugin.settings.projectPath, "D:\\AIApp\\video-memo");
    assert.ok(plugin.saveCalls >= 1);
  });

  test("auto-detect button calls autoDetectProjectDirectory and re-renders", async () => {
    const plugin = makeFakePlugin();
    plugin.autoDetectProjectDirectory = () => {
      plugin.autoDetectCalls += 1;
      // Mirrors the real plugin: adoption also writes the path back to settings.
      plugin.settings.projectPath = "C:\\projects\\video-memo";
      return "C:\\projects\\video-memo";
    };
    const tab = makeTab(plugin);
    tab.display();

    const projectSetting = settingItem(tab.containerEl, "项目目录");
    const searchButton = projectSetting?.querySelector(
      'button[aria-label="自动检测项目目录"]',
    );
    assert.ok(searchButton, "search button should exist");
    click(searchButton as Element);

    assert.equal(plugin.autoDetectCalls, 1);
    const projectInput = firstTextInput(settingItem(tab.containerEl, "项目目录")!);
    assert.equal(projectInput.value, "C:\\projects\\video-memo");
  });

  test("python path input is read-only", () => {
    const plugin = makeFakePlugin();
    plugin.settings.projectPath = "D:\\AIApp\\video-memo";
    const tab = makeTab(plugin);
    tab.display();

    const pythonSetting = settingItem(tab.containerEl, "Python 路径");
    const input = firstTextInput(pythonSetting!);
    assert.equal(input.disabled, true);
  });

  test("target folder input sanitizes the value", async () => {
    const plugin = makeFakePlugin();
    const tab = makeTab(plugin);
    tab.display();

    const folderSetting = settingItem(tab.containerEl, "Vault 目标文件夹（可选）");
    const input = firstTextInput(folderSetting!);
    typeInto(input, "  ..\\Git  ");
    await flushPromises();

    assert.equal(plugin.settings.targetFolder, "Git");
    assert.ok(plugin.saveCalls >= 1);
  });

  test("cleanup toggle persists the value", async () => {
    const plugin = makeFakePlugin();
    const tab = makeTab(plugin);
    tab.display();

    const cleanupSetting = settingItem(tab.containerEl, "完成后清理媒体");
    const checkbox = cleanupSetting?.querySelector('input[type="checkbox"]');
    assert.ok(checkbox instanceof HTMLInputElement);
    toggleInto(checkbox as HTMLInputElement, true);
    await flushPromises();

    assert.equal(plugin.settings.cleanupMedia, true);
    assert.ok(plugin.saveCalls >= 1);
  });
});
