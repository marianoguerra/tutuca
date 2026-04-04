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

test("collects classes from string templates in both @then and @else", () => {
  const [_r, ctx] = parse(
    `<p @if.class=".isOpen" @then="head open type-{.type}" @else="head closed type-{.type}"></p>`,
  );
  expect(ctx.classes.has("head")).toBe(true);
  expect(ctx.classes.has("open")).toBe(true);
  expect(ctx.classes.has("closed")).toBe(true);
  expect(ctx.classes.has("type-")).toBe(true);
});

test("collects classes from string template in @then and literal @else", () => {
  const [_r, ctx] = parse(
    `<p @if.class=".isOpen" @then="head open type-{.type}" @else="'head closed'"></p>`,
  );
  expect(ctx.classes.has("head")).toBe(true);
  expect(ctx.classes.has("open")).toBe(true);
  expect(ctx.classes.has("type-")).toBe(true);
  expect(ctx.classes.has("closed")).toBe(true);
});

test("collects classes from literal @then and string template in @else", () => {
  const [_r, ctx] = parse(
    `<p @if.class=".isOpen" @then="'head open'" @else="head closed type-{.type}"></p>`,
  );
  expect(ctx.classes.has("head")).toBe(true);
  expect(ctx.classes.has("open")).toBe(true);
  expect(ctx.classes.has("closed")).toBe(true);
  expect(ctx.classes.has("type-")).toBe(true);
});
