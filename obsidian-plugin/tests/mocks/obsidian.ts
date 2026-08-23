/**
 * Mock of the Obsidian API for plugin UI tests.
 *
 * Runs the whole suite inside jsdom: the module creates a jsdom window at
 * import time, exposes its globals (document, HTMLElement, Event, ...), and
 * patches HTMLElement.prototype with the DOM helpers Obsidian plugins rely on
 * (createDiv, createEl, empty, addClass, toggleClass, setText, ...).
 *
 * The component classes (Setting, Modal, PluginSettingTab, Notice, setIcon)
 * build real DOM and wire onChange/onClick through native input/change/click
 * events, so tests drive them exactly like a user would: set an input's value,
 * dispatch an "input" event, click a button, ...
 *
 * esbuild aliases `obsidian` to this file (see esbuild.test.config.mjs).
 */
import { JSDOM } from "jsdom";

// ---------------------------------------------------------------------------
// jsdom environment
// ---------------------------------------------------------------------------
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "https://localhost/",
});
const { window } = dom;

// Expose a curated set of jsdom globals on globalThis. A blanket copy would
// overwrite Node's own function globals (setTimeout, queueMicrotask, ...) with
// jsdom's, and jsdom's internals re-enter the global versions of those, which
// ends in infinite recursion (timerInitializationSteps -> setTimeout -> ...).
const globalKeys = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "HTMLOptionElement",
  "HTMLDivElement",
  "HTMLSpanElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "UIEvent",
  "InputEvent",
  "CustomEvent",
  "Node",
  "Element",
  "NodeList",
  "HTMLCollection",
  "File",
  "FileList",
  "Blob",
  "Text",
  "Comment",
  "DocumentFragment",
  "Range",
  "Selection",
  "getComputedStyle",
  "CSSStyleDeclaration",
  "DOMParser",
  "MutationObserver",
  "location",
] as const;
for (const key of globalKeys) {
  try {
    Object.defineProperty(globalThis, key, {
      value: (window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  } catch {
    // Read-only global; leave as is.
  }
}
globalThis.window = window as unknown as Window & typeof globalThis;

// ---------------------------------------------------------------------------
// HTMLElement prototype helpers (Obsidian patches these onto the prototype)
// ---------------------------------------------------------------------------
type ElementTag = keyof HTMLElementTagNameMap;
interface ElOpts {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean>;
  parent?: HTMLElement;
  prepend?: boolean;
}

function createElImpl<K extends ElementTag>(
  tag: K,
  opts?: ElOpts,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (opts?.cls) {
    el.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
  }
  if (opts?.text !== undefined) el.textContent = opts.text;
  if (opts?.attr) {
    for (const [key, value] of Object.entries(opts.attr)) {
      el.setAttribute(key, String(value));
    }
  }
  if (opts?.parent) {
    if (opts.prepend) opts.parent.prepend(el);
    else opts.parent.appendChild(el);
  }
  return el;
}

// Patch the jsdom prototype so plugin code (and tests) can use Obsidian's
// DOM helpers. The prototype is accessed through a Record cast to avoid
// fighting the DOM lib's sealed type for unknown extension methods.
const proto = window.HTMLElement.prototype as unknown as Record<
  string,
  unknown
>;

proto.createEl = function (
  this: HTMLElement,
  tag: string,
  opts?: ElOpts,
): HTMLElement {
  return createElImpl(tag as ElementTag, { parent: this, ...opts });
};

proto.createDiv = function (
  this: HTMLElement,
  opts?: ElOpts,
): HTMLDivElement {
  return createElImpl("div", { parent: this, ...opts });
};

proto.createSpan = function (
  this: HTMLElement,
  opts?: ElOpts,
): HTMLSpanElement {
  return createElImpl("span", { parent: this, ...opts });
};

proto.empty = function (this: HTMLElement): void {
  while (this.firstChild) this.removeChild(this.firstChild);
};

proto.addClass = function (this: HTMLElement, ...classes: string[]): void {
  for (const cls of classes) this.classList.add(cls);
};

proto.removeClass = function (this: HTMLElement, ...classes: string[]): void {
  for (const cls of classes) this.classList.remove(cls);
};

proto.toggleClass = function (
  this: HTMLElement,
  cls: string,
  force?: boolean,
): void {
  this.classList.toggle(cls, force);
};

proto.setText = function (this: HTMLElement, text: string): void {
  this.textContent = text ?? "";
};

proto.setAttr = function (this: HTMLElement, name: string, value: string): void {
  this.setAttribute(name, value);
};

// ---------------------------------------------------------------------------
// Component classes
// ---------------------------------------------------------------------------
export class TextComponent {
  inputEl: HTMLInputElement;
  constructor(containerEl: HTMLElement) {
    this.inputEl = createElImpl("input", {
      cls: "text-input",
      parent: containerEl,
    });
    this.inputEl.type = "text";
  }
  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }
  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
  getValue(): string {
    return this.inputEl.value;
  }
  onChange(callback: (value: string) => unknown): this {
    this.inputEl.addEventListener("input", () => {
      void callback(this.inputEl.value);
    });
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return this;
  }
}

export class DropdownComponent {
  selectEl: HTMLSelectElement;
  constructor(containerEl: HTMLElement) {
    this.selectEl = createElImpl("select", {
      cls: "dropdown",
      parent: containerEl,
    });
  }
  addOption(value: string, display: string): this {
    const option = createElImpl("option", { text: display });
    option.value = value;
    this.selectEl.appendChild(option);
    return this;
  }
  addOptions(options: Record<string, string>): this {
    for (const [value, display] of Object.entries(options)) {
      this.addOption(value, display);
    }
    return this;
  }
  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }
  getValue(): string {
    return this.selectEl.value;
  }
  onChange(callback: (value: string) => unknown): this {
    this.selectEl.addEventListener("change", () => {
      void callback(this.selectEl.value);
    });
    return this;
  }
}

export class ToggleComponent {
  toggleEl: HTMLElement;
  inputEl: HTMLInputElement;
  constructor(containerEl: HTMLElement) {
    this.toggleEl = createElImpl("div", { cls: "checkbox-container", parent: containerEl });
    this.inputEl = createElImpl("input", {
      cls: "checkbox",
      attr: { type: "checkbox" },
      parent: this.toggleEl,
    });
  }
  setValue(value: boolean): this {
    this.inputEl.checked = value;
    this.toggleEl.classList.toggle("is-enabled", value);
    return this;
  }
  getValue(): boolean {
    return this.inputEl.checked;
  }
  onChange(callback: (value: boolean) => unknown): this {
    this.inputEl.addEventListener("change", () => {
      void callback(this.inputEl.checked);
    });
    return this;
  }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(containerEl: HTMLElement) {
    this.buttonEl = createElImpl("button", {
      cls: "button",
      attr: { type: "button" },
      parent: containerEl,
    });
  }
  setButtonText(text: string): this {
    this.buttonEl.setText(text);
    return this;
  }
  setCta(): this {
    this.buttonEl.addClass("mod-cta");
    return this;
  }
  setWarning(): this {
    this.buttonEl.addClass("mod-warning");
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return this;
  }
  setTooltip(tooltip: string): this {
    this.buttonEl.setAttr("aria-label", tooltip);
    return this;
  }
  setIcon(icon: string): this {
    setIcon(this.buttonEl, icon);
    return this;
  }
  onClick(callback: (evt: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener("click", (event) => void callback(event));
    return this;
  }
}

export class ExtraButtonComponent extends ButtonComponent {
  constructor(containerEl: HTMLElement) {
    super(containerEl);
    this.buttonEl.addClass("clickable-icon");
  }
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement | null;
  controlEl: HTMLElement;
  components: Array<{ component: unknown }>;

  constructor(containerEl: HTMLElement) {
    this.settingEl = createElImpl("div", {
      cls: "setting-item",
      parent: containerEl,
    });
    this.infoEl = createElImpl("div", {
      cls: "setting-item-info",
      parent: this.settingEl,
    });
    this.nameEl = createElImpl("div", {
      cls: "setting-item-name",
      parent: this.infoEl,
    });
    this.descEl = null;
    this.controlEl = createElImpl("div", {
      cls: "setting-item-control",
      parent: this.settingEl,
    });
    this.components = [];
  }

  setName(name: string): this {
    this.nameEl.setText(name);
    return this;
  }
  setDesc(desc: string): this {
    if (!this.descEl) {
      this.descEl = createElImpl("div", {
        cls: "setting-item-description",
        parent: this.infoEl,
      });
    }
    this.descEl.setText(desc);
    return this;
  }
  setClass(cls: string): this {
    this.settingEl.addClass(cls);
    return this;
  }
  setHeading(): this {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }
  addText(callback: (component: TextComponent) => unknown): this {
    const component = new TextComponent(this.controlEl);
    void callback(component);
    this.components.push({ component });
    return this;
  }
  addDropdown(callback: (component: DropdownComponent) => unknown): this {
    const component = new DropdownComponent(this.controlEl);
    void callback(component);
    this.components.push({ component });
    return this;
  }
  addToggle(callback: (component: ToggleComponent) => unknown): this {
    const component = new ToggleComponent(this.controlEl);
    void callback(component);
    this.components.push({ component });
    return this;
  }
  addButton(callback: (component: ButtonComponent) => unknown): this {
    const component = new ButtonComponent(this.controlEl);
    void callback(component);
    this.components.push({ component });
    return this;
  }
  addExtraButton(callback: (component: ExtraButtonComponent) => unknown): this {
    const component = new ExtraButtonComponent(this.controlEl);
    void callback(component);
    this.components.push({ component });
    return this;
  }
}

export class Modal {
  app: App;
  modalEl: HTMLElement;
  contentEl: HTMLElement;
  scope: unknown;
  isOpen = false;

  constructor(app: App) {
    this.app = app;
    this.modalEl = createElImpl("div", { cls: "modal-container" });
    this.contentEl = createElImpl("div", { cls: "modal-content" });
    this.modalEl.appendChild(this.contentEl);
  }
  open(): void {
    document.body.appendChild(this.modalEl);
    this.isOpen = true;
    this.onOpen();
  }
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose();
    this.modalEl.remove();
  }
  onOpen(): void {}
  onClose(): void {}
}

export class PluginSettingTab {
  app: App;
  plugin: unknown;
  containerEl: HTMLElement;

  constructor(app: App, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = createElImpl("div", {
      cls: "setting-tab",
      parent: document.body,
    });
  }
  display(): void {}
  hide(): void {}
}

export class Plugin {
  app: App;
  manifest: { id: string; name: string; version: string } = {
    id: "mock-plugin",
    name: "Mock Plugin",
    version: "0.0.0",
  };
  constructor(app: App, manifest: unknown) {
    this.app = app;
  }
  loadData(): Promise<unknown> {
    return Promise.resolve(null);
  }
  saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }
}

export function setIcon(parent: HTMLElement, icon: string): void {
  parent.setAttr("data-icon", icon);
  parent.addClass("is-icon");
  createElImpl("span", { cls: "svg-icon", parent });
}

// ---------------------------------------------------------------------------
// Notice capture
// ---------------------------------------------------------------------------
export class Notice {
  static __all: string[] = [];
  messageEl: HTMLElement;

  constructor(message: string | DocumentFragment, timeout?: number) {
    void timeout;
    const text = typeof message === "string" ? message : message.textContent ?? "";
    Notice.__all.push(text);
    this.messageEl = createElImpl("div", {
      cls: "notice",
      text,
      parent: document.body,
    });
  }
  static __last(): string {
    return Notice.__all[Notice.__all.length - 1] ?? "";
  }
  static __clear(): void {
    Notice.__all.length = 0;
  }
  hide(): void {
    this.messageEl.remove();
  }
}

// ---------------------------------------------------------------------------
// requestUrl stub (used by ccswitch.ts)
// ---------------------------------------------------------------------------
export interface MockRequestUrlOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}
export interface MockRequestUrlResponse {
  status: number;
  json: unknown;
  text: string;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
}
export type RequestUrlHandler = (
  options: MockRequestUrlOptions,
) => Promise<MockRequestUrlResponse> | MockRequestUrlResponse;

let requestUrlHandler: RequestUrlHandler | null = null;

export function __setRequestUrlHandler(next: RequestUrlHandler | null): void {
  requestUrlHandler = next;
}
export function __clearRequestUrlHandler(): void {
  requestUrlHandler = null;
}

export async function requestUrl(
  options: MockRequestUrlOptions,
): Promise<MockRequestUrlResponse> {
  if (!requestUrlHandler) {
    throw new Error("requestUrl 被调用但没有注册 mock handler");
  }
  return await requestUrlHandler(options);
}

// Minimal App shape used by the components under test.
export interface App {
  vault: {
    adapter: unknown;
    getAbstractFileByPath: (path: string) => unknown;
  };
  workspace: {
    getLeaf: (mode?: string) => { openFile: (file: unknown) => Promise<void> };
  };
  setting: {
    open: () => void;
    openTabById: (id: string) => void;
  };
}

export { dom, window };
