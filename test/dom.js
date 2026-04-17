import { expect } from "bun:test";
import { JSDOM } from "jsdom";
import { ANode, ParseContext, TextNode } from "../src/anode.js";
import { fieldsByTypeName } from "../src/oo.js";

const { window } = new JSDOM("");
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
  const dom = new JSDOM(html);
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

export function expectFieldRegistered(typeName, FieldClass) {
  expect(fieldsByTypeName[typeName]).toBe(FieldClass);
}

// For primitive defaults use `toBe`; for immutable collections pass an
// `equals` fn (e.g. List.isList) and a size (usually 0 for empty).
export function expectFieldDefault(FieldClass, fieldName, value) {
  const f = new FieldClass(fieldName);
  expect(f.defaultValue).toBe(value);
}
