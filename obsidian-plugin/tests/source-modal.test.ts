/**
 * DOM-level tests for TextPromptModal (the task source dialog).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { TextPromptModal } from "../src/source-modal";
import {
  buttonByText,
  clearNotices,
  click,
  lastNotice,
  textOf,
  typeInto,
} from "./ui-helpers";

const app = {} as never;

function makeModal(options: {
  showMediaPicker?: boolean;
  providerBadge?: string;
  onOpenSettings?: () => void;
  onSubmit?: (value: string) => void;
}): { modal: TextPromptModal; onSubmit: (value: string) => void } {
  const calls: string[] = [];
  const modal = new TextPromptModal(app, {
    title: "总结视频或录音",
    fieldName: "链接或本地文件路径",
    placeholder: "https://...",
    providerBadge: options.providerBadge ?? "",
    showMediaPicker: options.showMediaPicker ?? false,
    onOpenSettings: options.onOpenSettings,
    onSubmit: (value) => {
      calls.push(value);
      options.onSubmit?.(value);
    },
  });
  modal.open();
  return {
    modal,
    onSubmit: (value) => assert.ok(calls.includes(value), `onSubmit got ${calls.join(", ")}`),
  };
}

beforeEach(() => {
  document.body.empty();
  clearNotices();
});

describe("TextPromptModal (regenerate mode)", () => {
  test("renders title, kicker, subtitle and badge", () => {
    const { modal } = makeModal({
      providerBadge: "cc-switch · OpenAI · gpt-5",
      onOpenSettings: () => {},
    });
    const content = modal.contentEl;

    assert.equal(textOf(content.querySelector(".video-memo-modal-kicker")), "已有运行目录");
    assert.equal(textOf(content.querySelector("h2")), "总结视频或录音");
    assert.equal(textOf(content.querySelector(".video-memo-modal-subtitle")), "已有转写 · 重新生成");
    assert.equal(
      textOf(content.querySelector(".video-memo-provider-badge-text")),
      "cc-switch · OpenAI · gpt-5",
    );
    assert.ok(content.querySelector(".video-memo-settings-button"));
  });

  test("empty submit shows a notice and stays open", () => {
    const { modal } = makeModal({});
    click(buttonByText(modal.contentEl, "开始"));
    assert.equal(lastNotice(), "链接或本地文件路径不能为空");
    assert.ok(document.body.contains(modal.modalEl));
  });

  test("submit sends the typed value and closes", () => {
    const { modal, onSubmit } = makeModal({});
    const input = modal.contentEl.querySelector<HTMLInputElement>("input");
    typeInto(input!, "D:\\runs\\20260717_x");
    click(buttonByText(modal.contentEl, "开始"));
    onSubmit("D:\\runs\\20260717_x");
    assert.ok(!document.body.contains(modal.modalEl));
  });

  test("Enter key submits", () => {
    const { modal, onSubmit } = makeModal({});
    const input = modal.contentEl.querySelector<HTMLInputElement>("input");
    typeInto(input!, "run-dir");
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    onSubmit("run-dir");
  });

  test("cancel closes without submitting", () => {
    const { modal } = makeModal({});
    click(buttonByText(modal.contentEl, "取消"));
    assert.ok(!document.body.contains(modal.modalEl));
  });
});

describe("TextPromptModal (media picker mode)", () => {
  test("renders the link/file mode switch and defaults to link", () => {
    const { modal } = makeModal({ showMediaPicker: true });
    const content = modal.contentEl;

    assert.equal(textOf(content.querySelector(".video-memo-modal-kicker")), "新建任务");
    assert.equal(textOf(content.querySelector(".video-memo-modal-subtitle")), "视频链接 · 本地媒体");

    const linkSetting = content.querySelectorAll(".video-memo-input-setting")[0];
    const fileSetting = content.querySelectorAll(".video-memo-input-setting")[1];
    assert.ok(linkSetting.classList.contains("is-hidden") === false);
    assert.ok(fileSetting.classList.contains("is-hidden"));

    // Native file input is present but hidden.
    const nativeFile = content.querySelector<HTMLInputElement>(".video-memo-native-file");
    assert.ok(nativeFile);
    assert.match(nativeFile.accept, /\.mp4/);
  });

  test("switching modes toggles visibility and focus target", () => {
    const { modal } = makeModal({ showMediaPicker: true });
    const content = modal.contentEl;
    const modeButtons = Array.from(content.querySelectorAll(".video-memo-mode-button"));
    assert.deepEqual(modeButtons.map((b) => textOf(b)), ["视频链接", "本地文件"]);

    click(modeButtons[1]);
    const linkSetting = content.querySelectorAll(".video-memo-input-setting")[0];
    const fileSetting = content.querySelectorAll(".video-memo-input-setting")[1];
    assert.ok(linkSetting.classList.contains("is-hidden"));
    assert.ok(!fileSetting.classList.contains("is-hidden"));
  });

  test("submits the link value in link mode", () => {
    const { modal, onSubmit } = makeModal({ showMediaPicker: true });
    const linkInput = modal.contentEl.querySelectorAll<HTMLInputElement>("input")[0];
    typeInto(linkInput, "https://example.com/video.mp4");
    click(buttonByText(modal.contentEl, "开始"));
    onSubmit("https://example.com/video.mp4");
  });

  test("picking a local file fills the input and submits the path", () => {
    const { modal, onSubmit } = makeModal({ showMediaPicker: true });
    const content = modal.contentEl;

    click(buttonByText(content, "选择文件…"));
    const fileInput = content.querySelector<HTMLInputElement>(".video-memo-native-file");
    assert.ok(fileInput);
    const file = new File(["binary"], "video.mp4") as File & { __mockPath?: string };
    file.__mockPath = "C:\\videos\\video.mp4";
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    const fileTextInput = content.querySelectorAll<HTMLInputElement>('input[type="text"]')[1];
    assert.equal(fileTextInput.value, "C:\\videos\\video.mp4");

    // Switch to file mode and submit.
    const modeButtons = Array.from(content.querySelectorAll(".video-memo-mode-button"));
    click(modeButtons[1]);
    click(buttonByText(content, "开始"));
    onSubmit("C:\\videos\\video.mp4");
  });

  test("empty file selection does not crash", () => {
    const { modal } = makeModal({ showMediaPicker: true });
    const fileInput = modal.contentEl.querySelector<HTMLInputElement>(".video-memo-native-file");
    assert.ok(fileInput);
    Object.defineProperty(fileInput, "files", { value: [], configurable: true });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    // No crash; nothing submitted.
  });

  test("settings shortcut closes the modal and opens settings", () => {
    let opened = 0;
    const { modal } = makeModal({ onOpenSettings: () => { opened += 1; } });
    const button = modal.contentEl.querySelector(".video-memo-settings-button");
    click(button as Element);
    assert.equal(opened, 1);
    assert.ok(!document.body.contains(modal.modalEl));
  });
});
