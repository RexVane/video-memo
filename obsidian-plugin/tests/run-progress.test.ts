/**
 * DOM-level tests for RunProgressModal (the live task progress panel).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { RunProgressModal, type TaskState } from "../src/run-progress";
import {
  buttonByText,
  clearNotices,
  click,
  flushPromises,
  lastNotice,
  textOf,
} from "./ui-helpers";

const app = {} as never;

function makeState(overrides: Partial<TaskState> = {}): TaskState {
  return {
    kicker: "新建任务",
    source: "https://example.com/video.mp4",
    providerLabel: "cc-switch · OpenAI · gpt-5",
    status: "running",
    progress: 0.4,
    stage: "下载视频…",
    log: [],
    errorDetail: "",
    notePath: null,
    ...overrides,
  };
}

function openModal(state: TaskState): {
  modal: RunProgressModal;
  calls: { cancel: number; openNote: number; closed: number };
} {
  const calls = { cancel: 0, openNote: 0, closed: 0 };
  const modal = new RunProgressModal(app, {
    state,
    onCancel: () => { calls.cancel += 1; },
    onOpenNote: () => { calls.openNote += 1; },
    onClosed: () => { calls.closed += 1; },
  });
  modal.open();
  return { modal, calls };
}

beforeEach(() => {
  document.body.empty();
  clearNotices();
  // Provide a clipboard stub for the error copy button.
  try {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: async () => {} },
      configurable: true,
    });
  } catch {
    // navigator not extensible; copy test will be skipped by its own setup.
  }
});

describe("RunProgressModal", () => {
  test("renders the running state with progress and controls", () => {
    const state = makeState();
    const { modal } = openModal(state);
    const content = modal.contentEl;

    assert.equal(textOf(content.querySelector(".video-memo-modal-kicker")), "正在处理");
    assert.equal(textOf(content.querySelector(".video-memo-progress-source")), state.source);
    assert.equal(textOf(content.querySelector(".video-memo-modal-subtitle")), state.providerLabel);
    assert.equal(textOf(content.querySelector(".video-memo-progress-percent")), "40%");
    assert.equal(textOf(content.querySelector(".video-memo-progress-stage")), "下载视频…");
    assert.equal(content.querySelector(".video-memo-progress-fill")?.getAttribute("style"), "width: 40%;");

    const footer = content.querySelector(".video-memo-progress-footer");
    assert.ok(buttonByText(footer as HTMLElement, "后台运行"));
    assert.ok(buttonByText(footer as HTMLElement, "取消任务"));
  });

  test("refresh updates progress, stage and appends log lines", () => {
    const state = makeState();
    const { modal } = openModal(state);

    state.progress = 0.625;
    state.stage = "转写中…";
    state.log.push("line 1", "line 2");
    modal.refresh();

    assert.equal(textOf(modal.contentEl.querySelector(".video-memo-progress-percent")), "63%");
    assert.equal(textOf(modal.contentEl.querySelector(".video-memo-progress-stage")), "转写中…");
    const lines = Array.from(modal.contentEl.querySelectorAll(".video-memo-progress-log-line")).map((el) => textOf(el));
    assert.deepEqual(lines, ["line 1", "line 2"]);

    // Appending more lines only adds the delta.
    state.log.push("line 3");
    modal.refresh();
    const linesAfter = Array.from(modal.contentEl.querySelectorAll(".video-memo-progress-log-line")).map((el) => textOf(el));
    assert.deepEqual(linesAfter, ["line 1", "line 2", "line 3"]);
  });

  test("background button closes the panel without cancelling", () => {
    const state = makeState();
    const { modal, calls } = openModal(state);
    click(buttonByText(modal.contentEl, "后台运行"));
    assert.ok(!document.body.contains(modal.modalEl));
    assert.equal(calls.cancel, 0);
    assert.equal(calls.closed, 1);
  });

  test("cancel button invokes the cancel callback", () => {
    const state = makeState();
    const { modal, calls } = openModal(state);
    click(buttonByText(modal.contentEl, "取消任务"));
    assert.equal(calls.cancel, 1);
  });

  test("success with a note offers to open the note", () => {
    const state = makeState({ status: "success", progress: 1, stage: "视频总结已生成", notePath: "Git/video.md" });
    const { modal, calls } = openModal(state);

    assert.equal(textOf(modal.contentEl.querySelector(".video-memo-modal-kicker")), "已完成");
    assert.equal(textOf(modal.contentEl.querySelector(".video-memo-progress-status")), "✓ 完成");
    const fill = modal.contentEl.querySelector(".video-memo-progress-fill");
    assert.ok(fill?.classList.contains("is-success"));

    click(buttonByText(modal.contentEl, "打开笔记"));
    assert.equal(calls.openNote, 1);
    assert.ok(!document.body.contains(modal.modalEl));
  });

  test("error state shows the detail box and copies it", async () => {
    const state = makeState({
      status: "error",
      stage: "任务失败",
      errorDetail: "无法下载媒体: 403 Forbidden\nretry later",
    });
    const { modal } = openModal(state);

    assert.equal(textOf(modal.contentEl.querySelector(".video-memo-modal-kicker")), "处理失败");
    const errorBox = modal.contentEl.querySelector(".video-memo-progress-error");
    assert.ok(errorBox, "error box should be rendered");
    assert.match(textOf(errorBox.querySelector("pre")), /403 Forbidden/);

    const copyButton = errorBox?.querySelector('button[aria-label="复制错误信息"]');
    click(copyButton as Element);
    await flushPromises();
    assert.equal(lastNotice(), "错误信息已复制");
  });

  test("cancelled state renders a plain close button", () => {
    const state = makeState({ status: "cancelled", stage: "任务已取消" });
    const { modal, calls } = openModal(state);

    assert.equal(textOf(modal.contentEl.querySelector(".video-memo-modal-kicker")), "已取消");
    assert.equal(textOf(modal.contentEl.querySelector(".video-memo-progress-status")), "已取消");
    const fill = modal.contentEl.querySelector(".video-memo-progress-fill");
    assert.ok(fill?.classList.contains("is-cancelled"));

    // No cancel affordance once cancelled.
    const footer = modal.contentEl.querySelector(".video-memo-progress-footer");
    assert.equal(textOf(footer), "关闭");
    click(buttonByText(footer as HTMLElement, "关闭"));
    assert.ok(!document.body.contains(modal.modalEl));
    assert.equal(calls.cancel, 0);
  });
});
