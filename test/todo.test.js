import { describe, expect, test } from "bun:test";
import { renderToHTML } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";
import { getComponents, getExamples, getMacros } from "./todo.js";

const document = setupJsdom();

const render = (rootState) =>
  renderToHTML(document, getComponents(), getMacros(), rootState, HeadlessParseContext);

describe("Todo App", () => {
  for (const example of getExamples()) {
    test(example.title, () => {
      expect(render(example.value)).toMatchSnapshot();
    });
  }
});
