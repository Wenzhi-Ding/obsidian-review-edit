/**
 * Obsidian 运行时把 createEl/createDiv/createSpan 注册为全局函数，jsdom 环境没有。
 * 源码里走这些函数构建 DOM 的路径（DiffNav、装饰 widget）在测试中会执行到，
 * 这里提供只覆盖用到的选项子集（cls/text）的最小实现。
 */
type ElOpts = { cls?: string; text?: string } | string | undefined;

function applyOpts(el: HTMLElement, o: ElOpts): void {
  if (!o) return;
  if (typeof o === 'string') {
    el.className = o;
    return;
  }
  if (o.cls) el.className = o.cls;
  if (o.text !== undefined) el.textContent = o.text;
}

function createElShim<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  o?: ElOpts,
  callback?: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
  // shim 本体必须用原生 API：走全局 createEl 会递归回自身
  // eslint-disable-next-line obsidianmd/prefer-create-el
  const el = document.createElement(tag);
  applyOpts(el, o);
  callback?.(el);
  return el;
}

const g = globalThis as unknown as Record<string, unknown>;

if (!g.createEl) g.createEl = createElShim;
if (!g.createDiv) g.createDiv = (o?: ElOpts, cb?: (el: HTMLDivElement) => void) => createElShim('div', o, cb);
if (!g.createSpan) g.createSpan = (o?: ElOpts, cb?: (el: HTMLSpanElement) => void) => createElShim('span', o, cb);
