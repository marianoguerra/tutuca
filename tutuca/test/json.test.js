import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToHTML } from "../src/util/render.js";
import { HeadlessParseContext } from "./dom.js";
import { getComponents, getExamples } from "./json.js";

const { document } = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window;
globalThis.document = document;

const render = (rootState) =>
  renderToHTML(document, getComponents(), null, rootState, HeadlessParseContext);

describe("Json Editor", () => {
  for (const example of getExamples()) {
    test(example.title, () => {
      expect(render(example.value)).toMatchSnapshot();
    });
  }
});
