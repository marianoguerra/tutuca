import { expect, test } from "bun:test";
import { ANode } from "../src/anode.js";
import { DOMParser, Text, Comment } from "./dom.js";
import { ParseCtxClassSetCollector } from "../src/util/parsectx.js";

function parse(html) {
  const ctx = new ParseCtxClassSetCollector(DOMParser, Text, Comment);
  const r = ANode.parse(html, ctx);
  return [r, ctx];
}

test("collects literal class names from string template", () => {
  const [_r, ctx] = parse(`<div :class="foo bar type-{.type}"></div>`);
  expect(ctx.classes.has("foo")).toBe(true);
  expect(ctx.classes.has("bar")).toBe(true);
});
