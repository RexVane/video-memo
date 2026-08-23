/**
 * Shared helpers for the DOM-level plugin UI tests.
 */
import { Notice } from "./mocks/obsidian";

export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").trim();
}

/** Find a .setting-item whose name matches exactly. */
export function settingItem(
  container: HTMLElement,
  name: string,
): HTMLElement | null {
  for (const item of Array.from(
    container.querySelectorAll<HTMLElement>(".setting-item"),
  )) {
    const itemName = item.querySelector(".setting-item-name");
    if (textOf(itemName) === name) return item;
  }
  return null;
}

/** All .setting-item names in order. */
export function settingNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".setting-item-name")).map(
    (el) => textOf(el),
  );
}

export function firstTextInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="text"], input.text-input',
  );
  if (!input) throw new Error("no text input found in container");
  return input;
}

/** Set an input's value and fire the input event the component listens to. */
export function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Set a select's value and fire the change event. */
export function selectInto(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Set a checkbox and fire the change event. */
export function toggleInto(checkbox: HTMLInputElement, value: boolean): void {
  checkbox.checked = value;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Find a button inside an element by its exact text. */
export function buttonByText(
  container: HTMLElement,
  text: string,
): HTMLButtonElement {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  );
  const match = buttons.find((b) => textOf(b) === text);
  if (!match) throw new Error(`no button with text "${text}"`);
  return match;
}

/** Click a button/element, bubbling like a real user click. */
export function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

export function notices(): string[] {
  return [...Notice.__all];
}

export function lastNotice(): string {
  return Notice.__last();
}

export function clearNotices(): void {
  Notice.__clear();
}

export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
