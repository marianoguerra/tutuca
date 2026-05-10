import { describe, expect, test } from "bun:test";
import { format } from "prettier";
import { component, html, IMap } from "../index.js";
import { BindStep, EachBindStep, EachRenderItStep, FieldStep, Path, SeqStep } from "../src/path.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";
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

const document = setupJsdom();

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
    const [path, events] = Path.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
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
    const [path, events] = Path.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
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
    const [path, events] = Path.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
    console.log(await formatHTML(container.innerHTML));
    console.log(path.steps);
    expect(path.steps.length).toBe(3);
    expect(events.length).toBe(1);
    expect(path.lookup(rootValue)).toBe(target);
    cleanup();
  });
});

describe("Path.compact", () => {
  test("drops BindStep and EachBindStep, preserves lookup and setValue", () => {
    const root = IMap({ a: IMap({ b: 42 }) });
    const original = new Path([
      new BindStep({}),
      new FieldStep("a"),
      new EachBindStep(null, "k"),
      new FieldStep("b"),
    ]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(2);
    expect(compact.steps[0]).toBeInstanceOf(FieldStep);
    expect(compact.steps[1]).toBeInstanceOf(FieldStep);

    expect(original.lookup(root)).toBe(42);
    expect(compact.lookup(root)).toBe(42);

    const updated = original.setValue(root, 100);
    const updatedCompact = compact.setValue(root, 100);
    expect(updated.get("a").get("b")).toBe(100);
    expect(updatedCompact.get("a").get("b")).toBe(100);
  });

  test("path of only frame-only steps compacts to empty path", () => {
    const root = IMap({ x: 1 });
    const original = new Path([new BindStep({}), new EachBindStep(null, "k")]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(0);
    expect(original.lookup(root)).toBe(root);
    expect(compact.lookup(root)).toBe(root);
  });

  test("abstracts EachRenderItStep to a SeqStep, preserving lookup/setValue", () => {
    const root = IMap({ items: IMap({ k: IMap({ v: 7 }) }) });
    const original = new Path([new EachRenderItStep("items", "k"), new FieldStep("v")]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(2);
    expect(compact.steps[0]).toBeInstanceOf(SeqStep);
    expect(compact.steps[0]).not.toBeInstanceOf(EachRenderItStep);
    expect(compact.steps[0].field).toBe("items");
    expect(compact.steps[0].key).toBe("k");

    expect(original.lookup(root)).toBe(7);
    expect(compact.lookup(root)).toBe(7);

    const updated = original.setValue(root, 99);
    const updatedCompact = compact.setValue(root, 99);
    expect(updated.get("items").get("k").get("v")).toBe(99);
    expect(updatedCompact.get("items").get("k").get("v")).toBe(99);
  });

  test("preserves SeqStep (traverses through field+key)", () => {
    const root = IMap({ items: IMap({ k: IMap({ v: 7 }) }) });
    const original = new Path([new BindStep({}), new SeqStep("items", "k"), new FieldStep("v")]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(2);
    expect(original.lookup(root)).toBe(7);
    expect(compact.lookup(root)).toBe(7);
  });
});

describe("@value inside @each click handler", () => {
  test("button beside <x render-it> with @value arg — list", () => {
    let received = "<not-called>";
    const Item = component({ name: "Item", fields: { uid: "" } });
    const List = component({
      name: "List",
      fields: { items: [] },
      input: {
        noteClicked(item) {
          received = item;
          return this;
        },
      },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
          <button :data-uid=".uid" @on.click="noteClicked @value">x</button>
        </div>
      </div>`,
    });
    const root = List.make({ items: [Item.make({ uid: "a" }), Item.make({ uid: "b" })] });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [List, Item],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    expect(received).not.toBe("<not-called>");
    expect(received?.uid).toBe("b");
    cleanup();
  });

  test("remove-item handler in @each updates root state (todo regression)", () => {
    const Item = component({ name: "Item", fields: { uid: "" } });
    const List = component({
      name: "List",
      fields: { items: [] },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
          <button :data-uid=".uid" @on.click=".removeInItemsAt @key">x</button>
        </div>
      </div>`,
    });
    const root = List.make({ items: [Item.make({ uid: "a" }), Item.make({ uid: "b" })] });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [List, Item],
      null,
      root,
      HeadlessParseContext,
    );
    expect(app.state.val.items.size).toBe(2);
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.items.size).toBe(1);
    expect(app.state.val.items.get(0).uid).toBe("a");
    cleanup();
  });

  test("frame boundary: @key/@value bound by @each are NOT visible inside a render-it child", () => {
    let receivedKey = "<not-set>";
    let receivedValue = "<not-set>";
    const Item = component({
      name: "Item",
      fields: { uid: "" },
      input: {
        // Handler is on Item (the rendered child). It tries to read @key/@value
        // which the surrounding @each scope binds. The render-it pushes a frame
        // between that scope and the child view, so the lookup must STOP at the
        // frame and return null — NOT walk through to the iteration's binds.
        recordIt(k, v) {
          receivedKey = k;
          receivedValue = v;
          return this;
        },
      },
      view: html`<button :data-uid=".uid" @on.click="recordIt @key @value">x</button>`,
    });
    const List = component({
      name: "List",
      fields: { items: [] },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
        </div>
      </div>`,
    });
    const root = List.make({ items: [Item.make({ uid: "a" }), Item.make({ uid: "b" })] });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [List, Item],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    // Frame boundary held: lookup hit the empty frame pushed by RenderItNode and
    // returned null instead of falling through to the iteration scope below it.
    expect(receivedKey).toBeNull();
    expect(receivedValue).toBeNull();
    cleanup();
  });

  test("button beside <x render-it> with @key + @value args — map", () => {
    let receivedKey = null;
    let receivedValue = null;
    const Item = component({ name: "Item", fields: { uid: "" } });
    const Bag = component({
      name: "Bag",
      fields: { items: IMap() },
      input: {
        noteClicked(k, v) {
          receivedKey = k;
          receivedValue = v;
          return this;
        },
      },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
          <button :data-uid=".uid" @on.click="noteClicked @key @value">x</button>
        </div>
      </div>`,
    });
    const root = Bag.make({
      items: IMap({ alpha: Item.make({ uid: "alpha" }), beta: Item.make({ uid: "beta" }) }),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Bag, Item],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="beta"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    expect(receivedKey).toBe("beta");
    expect(receivedValue?.uid).toBe("beta");
    cleanup();
  });
});
