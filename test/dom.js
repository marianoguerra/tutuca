import { JSDOM, VirtualConsole } from "jsdom";
import { ANode, ParseContext, TextNode } from "../src/anode.js";
import { render } from "../src/vdom.js";

const renderStates = new WeakMap();
export function vdomRender(vnode, container, options) {
  const prev = renderStates.get(container);
  // Container emptied externally (e.g. unmount); drop stale state.
  const usable = prev && container.firstChild ? prev : undefined;
  const next = render(vnode, container, options, usable);
  renderStates.set(container, next);
  return next.dom;
}

// rrweb-cssom (jsdom's CSS parser) doesn't support CSS Nesting, which we emit
// via components.js when wrapping per-view rules. Swallow just that message;
// forward everything else to the host console.
function makeVirtualConsole() {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (!/Could not parse CSS stylesheet/.test(e?.message ?? "")) console.error(e);
  });
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    vc.on(level, (...args) => console[level](...args));
  }
  return vc;
}

const { window } = new JSDOM("", { virtualConsole: makeVirtualConsole() });
const { DOMParser, Text, Comment } = window;

export const mpx = () => new ParseContext(DOMParser, Text, Comment);

export class HeadlessParseContext extends ParseContext {
  constructor() {
    super(DOMParser, Text, Comment);
  }
}

export function parse(html) {
  const px = mpx();
  const r = ANode.parse(html, px);

  return [r, px];
}

export const isTextNode = (node) => node instanceof TextNode;
export const isTextNodeWithText = (node, text) => node instanceof TextNode && node.val === text;

export { Comment, DOMParser, Text };

// Install a fresh JSDOM document on globalThis and return it. The vdom
// renderer reads `globalThis.document` when no explicit document is passed.
export function setupJsdom(html = "<!DOCTYPE html><html><head></head><body></body></html>") {
  const dom = new JSDOM(html, { virtualConsole: makeVirtualConsole() });
  globalThis.document = dom.window.document;
  return dom.window.document;
}

// Structural equality between two DOM nodes (tag, attrs, children, text).
// Used by the vdom patch tests to compare morphed DOM against a fresh render.
export function assertEqualDom(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === 3 || a.nodeType === 8) return a.data === b.data;
  if (a.nodeType === 1) {
    if (a.tagName !== b.tagName) return false;
    if (a.attributes.length !== b.attributes.length) return false;
    for (let i = 0; i < a.attributes.length; i++) {
      const attr = a.attributes[i];
      if (b.getAttribute(attr.name) !== attr.value) return false;
    }
    if (a.childNodes.length !== b.childNodes.length) return false;
    for (let i = 0; i < a.childNodes.length; i++) {
      if (!assertEqualDom(a.childNodes[i], b.childNodes[i])) return false;
    }
  }
  return true;
}

export function childNodesArray(node) {
  const arr = [];
  for (let i = 0; i < node.childNodes.length; i++) arr.push(node.childNodes[i]);
  return arr;
}
