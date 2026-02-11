import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToHTML } from "../src/util/render.js";
import { HeadlessParseContext } from "./dom.js";
import { getComponents, getExamples, getMacros } from "./todo.js";

// separate JSDOM for DOM rendering (vdom needs a real document)
const { document } = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>")
  .window;
// app.js injectCss uses global document
globalThis.document = document;

const render = (rootState) =>
  renderToHTML(document, getComponents(), getMacros(), rootState, HeadlessParseContext);

describe("Todo App", () => {
  for (const example of getExamples()) {
    test(example.title, () => {
      expect(render(example.value)).toMatchSnapshot();
    });
  }
});
