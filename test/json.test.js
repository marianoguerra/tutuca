import { describe, expect, test } from "bun:test";
import { renderToHTML } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";
import { getComponents, getExamples } from "./json.js";

const document = setupJsdom();

const render = (rootState) =>
  renderToHTML(document, getComponents(), null, rootState, HeadlessParseContext);

describe("Json Editor", () => {
  for (const example of getExamples().items) {
    test(example.title, () => {
      expect(render(example.value)).toMatchSnapshot();
    });
  }
});
