import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { Path } from "../src/path.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext } from "./dom.js";
import {
  getComponents,
  JsonArray,
  JsonBool,
  JsonNull,
  JsonNumber,
  JsonObject,
  JsonObjectKeyVal,
  JsonString,
} from "./json.js";
import { format } from "prettier";

const { document } = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>")
  .window;
globalThis.document = document;

const TARGET = "target-bool";
const SELECTOR = `[data-test-id="${TARGET}"]`;
async function formatHTML(html) {
  return await format(html, { parser: "html" });
}

const renderNode = (rootState) =>
  renderToHTMLNode(document, getComponents(), null, rootState, HeadlessParseContext);

describe("Path - find JsonBool by uid", () => {
  test("flat boolean", () => {
    const target = JsonBool.make({ uid: TARGET, value: true });
    const { container, app, cleanup } = renderNode(target);
    const node = container.querySelector(SELECTOR);
    expect(node).not.toBeNull();
    const [path, events] = Path.fromNodeAndEventName(
      node,
      "click",
      container,
      Infinity,
      app.comps,
    );
    expect(path.steps.length).toBe(0);
    expect(events.length).toBe(1);
    expect(path.lookup(target)).toBe(target);
    cleanup();
  });

  test("boolean inside JsonObject with siblings", () => {
    const target = JsonBool.make({ uid: TARGET, value: true });
    const rootValue = JsonObject.make({
      uid: "obj",
      items: [
        JsonObjectKeyVal.make({
          uid: "kv-str",
          key: "name",
          value: JsonString.make({ uid: "str-1", value: "hello" }),
        }),
        JsonObjectKeyVal.make({
          uid: "kv-bool",
          key: "flag",
          value: target,
        }),
        JsonObjectKeyVal.make({
          uid: "kv-num",
          key: "count",
          value: JsonNumber.make({ uid: "num-1" }),
        }),
      ],
    });
    const { container, app, cleanup } = renderNode(rootValue);
    const node = container.querySelector(SELECTOR);
    expect(node).not.toBeNull();
    const [path, events] = Path.fromNodeAndEventName(
      node,
      "click",
      container,
      Infinity,
      app.comps,
    );
    console.log(path.steps);
    expect(path.steps.length).toBe(2);
    expect(events.length).toBe(1);
    expect(path.lookup(rootValue)).toBe(target);
    cleanup();
  });

  test("boolean inside array inside object with siblings", async () => {
    const target = JsonBool.make({ uid: TARGET, value: true });
    const rootValue = JsonObject.make({
      uid: "obj",
      items: [
        JsonObjectKeyVal.make({
          uid: "kv-arr",
          key: "mixed",
          value: JsonArray.make({
            uid: "arr",
            items: [
              JsonNull.make({ uid: "null-1" }),
              target,
              JsonString.make({ uid: "str-2", value: "world" }),
            ],
          }),
        }),
        JsonObjectKeyVal.make({
          uid: "kv-num",
          key: "sibling",
          value: JsonNumber.make({ uid: "num-2" }),
        }),
      ],
    });
    const { container, app, cleanup } = renderNode(rootValue);
    const node = container.querySelector(SELECTOR);
    expect(node).not.toBeNull();
    const [path, events] = Path.fromNodeAndEventName(
      node,
      "click",
      container,
      Infinity,
      app.comps,
    );
    console.log(await formatHTML(container.innerHTML));
    console.log(path.steps);
    expect(path.steps.length).toBe(3);
    expect(events.length).toBe(1);
    expect(path.lookup(rootValue)).toBe(target);
    cleanup();
  });
});
