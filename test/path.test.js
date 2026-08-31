import { format } from "prettier";
import { describe, expect, test } from "vitest";
import { component, html, path } from "../index.js";
import {
  BindStep,
  DispatchPath,
  EachBindStep,
  EachRenderItStep,
  FieldStep,
  Path,
  SeqAccessStep,
  SeqStep,
} from "../src/path.js";
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
const map = (value = {}) => new Map(Object.entries(value));

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
    const [dpath, events] = DispatchPath.fromNodeAndEventName(
      node,
      "click",
      container,
      Infinity,
      app.comps,
    );
    const path = dpath.toTransactionPath();
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
    const [dpath, events] = DispatchPath.fromNodeAndEventName(
      node,
      "click",
      container,
      Infinity,
      app.comps,
    );
    const path = dpath.toTransactionPath();
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
    const [dpath, events] = DispatchPath.fromNodeAndEventName(
      node,
      "click",
      container,
      Infinity,
      app.comps,
    );
    console.log(await formatHTML(container.innerHTML));
    const path = dpath.toTransactionPath();
    expect(path.steps.length).toBe(3);
    expect(events.length).toBe(1);
    expect(path.lookup(rootValue)).toBe(target);
    cleanup();
  });
});

describe("Path.compact", () => {
  test("drops BindStep and EachBindStep, preserves lookup and setValue", () => {
    const root = map({ a: map({ b: 42 }) });
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
    const root = map({ x: 1 });
    const original = new Path([new BindStep({}), new EachBindStep(null, "k")]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(0);
    expect(original.lookup(root)).toBe(root);
    expect(compact.lookup(root)).toBe(root);
  });

  test("abstracts EachRenderItStep to a SeqStep, preserving lookup/setValue", () => {
    const root = map({ items: map({ k: map({ v: 7 }) }) });
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
    const root = map({ items: map({ k: map({ v: 7 }) }) });
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
      receive: {
        noteClicked(draft, item) {
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
      receive: {
        removeItem(draft, key) {
          draft.items.splice(key, 1);
        },
      },
      intent: {
        removeItem(draft, key, ctx) {
          ctx.forward({ route: ["dyn"] });
        },
      },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
          <button :data-uid=".uid" @on.click="removeItem @key">x</button>
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
    expect(app.state.val.items.length).toBe(2);
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.items.length).toBe(1);
    expect(app.state.val.items[0].uid).toBe("a");
    cleanup();
  });

  test("frame boundary: @key/@value bound by @each are NOT visible inside a render-it child", () => {
    let receivedKey = "<not-set>";
    let receivedValue = "<not-set>";
    const Item = component({
      name: "Item",
      fields: { uid: "" },
      receive: {
        // Handler is on Item (the rendered child). It tries to read @key/@value
        // which the surrounding @each scope binds. The render-it pushes a frame
        // between that scope and the child view, so the lookup must STOP at the
        // frame and return null — NOT walk through to the iteration's binds.
        recordIt(draft, k, v) {
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
      fields: { items: map() },
      receive: {
        noteClicked(draft, k, v) {
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
      items: map({ alpha: Item.make({ uid: "alpha" }), beta: Item.make({ uid: "beta" }) }),
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

describe("@enrich-with binds survive path rebuild", () => {
  // The rebuilt stack must replay the same binds the renderer pushed, including
  // custom @enrich-with binds — otherwise a handler arg reading one resolves to
  // null after dispatch (EachBindStep / ScopeBindStep enterFrame).
  test("@each @enrich-with: handler reads enriched bind after click", () => {
    let received = "<not-called>";
    const List = component({
      name: "List",
      fields: { items: [] },
      receive: {
        noteClicked(draft, label) {
          received = label;
          return this;
        },
      },
      alter: {
        enrichItem(binds, _key, item) {
          binds.label = `L:${item}`;
        },
      },
      view: html`<div>
        <div @each=".items" @enrich-with="enrichItem">
          <button :data-uid="@value" @on.click="noteClicked @label">x</button>
        </div>
      </div>`,
    });
    const root = List.make({ items: ["a", "b"] });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [List],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    expect(received).toBe("L:b");
    cleanup();
  });

  test("@each @enrich-with + @loop-with: iterData-derived bind survives rebuild", () => {
    let received = null;
    const List = component({
      name: "List",
      fields: { items: [] },
      receive: {
        noteClicked(draft, total) {
          received = total;
          return this;
        },
      },
      alter: {
        getIterData(seq) {
          let total = 0;
          for (const item of seq) total += item.length;
          return { iterData: { total } };
        },
        enrichItem(binds, _key, _item, iterData) {
          binds.total = iterData.total;
        },
      },
      view: html`<div>
        <div @each=".items" @enrich-with="enrichItem" @loop-with="getIterData">
          <button :data-uid="@value" @on.click="noteClicked @total">x</button>
        </div>
      </div>`,
    });
    const root = List.make({ items: ["ab", "cde"] }); // total chars = 5
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [List],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="cde"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    expect(received).toBe(5);
    cleanup();
  });

  test("@enrich-with (scope, no @each): handler reads scoped bind after click", () => {
    let received = "<not-called>";
    const Box = component({
      name: "Box",
      fields: { name: "x" },
      receive: {
        noteClicked(draft, greeting) {
          received = greeting;
          return this;
        },
      },
      alter: {
        scopeBinds() {
          return { greeting: `hi ${this.name}` };
        },
      },
      view: html`<div @enrich-with="scopeBinds">
        <button data-uid="b" @on.click="noteClicked @greeting">x</button>
      </div>`,
    });
    const root = Box.make({ name: "bob" });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Box],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    expect(received).toBe("hi bob");
    cleanup();
  });
});

describe("@on.drop bubbles to ancestor components", () => {
  function makeApp() {
    const captured = { type: "<not-called>", self: null };
    const Child = component({
      name: "Child",
      fields: { uid: "" },
      view: html`<div :data-uid=".uid"><span class="inner">drop here</span></div>`,
    });
    const Parent = component({
      name: "Parent",
      fields: { child: Child.make({ uid: "c1" }) },
      receive: {
        onDrop(draft, type) {
          captured.type = type;
          captured.self = this;
          return this;
        },
      },
      view: html`<section @on.drop="onDrop e.type" data-droptarget="x">
        <x render=".child"></x>
      </section>`,
    });
    const ctx = renderToHTMLNode(
      document,
      [Parent, Child],
      null,
      Parent.make(),
      HeadlessParseContext,
    );
    return { ...ctx, captured };
  }

  test("DispatchPath.fromNodeAndEventName finds the ancestor @on.drop and resolves to its value", () => {
    const { container, app, cleanup } = makeApp();
    const inner = container.querySelector(".inner");
    expect(inner).not.toBeNull();
    const [path, handlers] = DispatchPath.fromNodeAndEventName(
      inner,
      "drop",
      container,
      Infinity,
      app.comps,
    );
    expect(handlers).not.toBeNull();
    expect(handlers.length).toBe(1);
    // Parent is the app root, so the path is empty and resolves to the Parent value.
    const txn = path.toTransactionPath();
    expect(txn.steps.length).toBe(0);
    expect(txn.lookup(app.state.val)).toBe(app.state.val);
    cleanup();
  });

  test("non-bubbling event (click) still bails at the leaf component", () => {
    const { container, app, cleanup } = makeApp();
    const inner = container.querySelector(".inner");
    const [path, handlers] = DispatchPath.fromNodeAndEventName(
      inner,
      "click",
      container,
      Infinity,
      app.comps,
    );
    expect(path).toBeNull();
    expect(handlers).toBeNull();
    cleanup();
  });

  test("dispatching a drop event inside a nested component invokes the ancestor handler", () => {
    const { container, app, captured, cleanup } = makeApp();
    const inner = container.querySelector(".inner");
    const Event = container.ownerDocument.defaultView.Event;
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    inner.dispatchEvent(ev);
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(ev.defaultPrevented).toBe(true);
    expect(captured.type).toBe("drop");
    expect(captured.self).toBe(app.state.val);
    cleanup();
  });
});

describe("+prevent / +stop effect modifiers", () => {
  function makeApp() {
    const calls = [];
    const Comp = component({
      name: "EffectMods",
      fields: { n: 0 },
      receive: {
        onClick(draft) {
          calls.push("click");
          return this;
        },
        onKey(draft) {
          calls.push("key");
          return this;
        },
      },
      view: html`<section>
        <button class="btn" @on.click+prevent+stop="onClick">go</button>
        <button class="plain" @on.click="onClick">plain</button>
        <input class="inp" @on.keydown+send+prevent="onKey" />
      </section>`,
    });
    const ctx = renderToHTMLNode(document, [Comp], null, Comp.make(), HeadlessParseContext);
    return { ...ctx, calls };
  }
  function dispatch(node, Ctor, type, init) {
    const ev = new Ctor(type, { bubbles: true, cancelable: true, ...init });
    node.dispatchEvent(ev);
    return ev;
  }

  test("+prevent preventDefaults from the root listener, +stop keeps it inside the app", () => {
    const { container, calls, cleanup } = makeApp();
    const win = container.ownerDocument.defaultView;
    const seenOutside = [];
    const onBody = (e) => seenOutside.push(e.type);
    container.ownerDocument.body.addEventListener("click", onBody);
    // Control: with no modifiers the event is untouched and reaches body.
    const plain = dispatch(container.querySelector(".plain"), win.MouseEvent, "click");
    expect(plain.defaultPrevented).toBe(false);
    expect(seenOutside).toEqual(["click"]);

    const ev = dispatch(container.querySelector(".btn"), win.MouseEvent, "click");
    expect(calls).toEqual(["click", "click"]);
    expect(ev.defaultPrevented).toBe(true);
    expect(seenOutside).toEqual(["click"]); // +stop kept it from reaching body again
    container.ownerDocument.body.removeEventListener("click", onBody);
    cleanup();
  });

  test("a guard that fails also skips the effect", () => {
    const { container, calls, cleanup } = makeApp();
    const win = container.ownerDocument.defaultView;
    const inp = container.querySelector(".inp");

    const other = dispatch(inp, win.KeyboardEvent, "keydown", { key: "a" });
    expect(calls).toEqual([]);
    expect(other.defaultPrevented).toBe(false);

    const enter = dispatch(inp, win.KeyboardEvent, "keydown", { key: "Enter" });
    expect(calls).toEqual(["key"]);
    expect(enter.defaultPrevented).toBe(true);
    cleanup();
  });
});

describe("dragInfo.lookupBind for @each items", () => {
  // A drag that starts inside an `@each` must keep the row's frame-only binds
  // (`key`/`value`) reachable from the drop handler — `compact()` strips them
  // from the dispatch path, so the DragInfo stack is built from a path that
  // retains them.
  test("drop handler resolves the source row's key bind", () => {
    let sourceKey = "<not-called>";
    const Reorder = component({
      name: "Reorder",
      fields: { items: ["a", "b", "c"] },
      receive: {
        onDropOnItem(draft, _targetKey, info) {
          sourceKey = info.lookupBind("key");
          return this;
        },
      },
      view: html`<div>
        <div
          class="row"
          @each=".items"
          draggable="true"
          data-dragtype="x"
          data-droptarget="x"
          @on.drop="onDropOnItem @key e.dragInfo"
        >
          <x text="@value"></x>
        </div>
      </div>`,
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Reorder],
      null,
      Reorder.make(),
      HeadlessParseContext,
    );
    const rows = container.querySelectorAll(".row");
    const Event = container.ownerDocument.defaultView.Event;
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    rows[1].dispatchEvent(dragStart);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    rows[2].dispatchEvent(drop);
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(sourceKey).toBe(1);
    cleanup();
  });
});

describe("a dynamic variable as a located continuation", () => {
  // Workspace (producer of *active = .sheet) -> Panel -> Toolbar (consumer that
  // does `<x render="*active">`) -> Sheet. The Sheet's data physically lives at
  // Workspace.sheet, NOT under Toolbar — so the Toolbar's render site RESUMES
  // there: it pushes `.sheet` as a new continuation frame, and the frames it
  // saved underneath are the visual callers bubbling returns through.
  function workspaceApp() {
    const Sheet = component({
      name: "Sheet",
      fields: { title: "untitled" },
      receive: {
        rename(draft) {
          draft.title = "renamed";
        },
      },
      view: html`<div class="sheet">
        <button class="rename" @on.click="rename">x</button>
      </div>`,
    });
    const Toolbar = component({
      name: "Toolbar",
      fields: {},
      lookup: [{ name: "active", default: ".missing" }],
      view: html`<div class="toolbar"><x render="*active"></x></div>`,
    });
    const Panel = component({
      name: "Panel",
      fields: { toolbar: null },
      view: html`<div class="panel"><x render=".toolbar"></x></div>`,
    });
    const Workspace = component({
      name: "Workspace",
      fields: { sheet: null, panel: null },
      provide: { active: ".sheet" },
      view: html`<div class="workspace"><x render=".panel"></x></div>`,
    });
    const root = Workspace.make({
      sheet: Sheet.make({ title: "untitled" }),
      panel: Panel.make({ toolbar: Toolbar.make() }),
    });
    return renderToHTMLNode(
      document,
      [Workspace, Panel, Toolbar, Sheet],
      null,
      root,
      HeadlessParseContext,
    );
  }

  test("<x render='*dyn'> reconstructs as two frames: the caller, then the resume", () => {
    const { container, app, cleanup } = workspaceApp();
    const button = container.querySelector(".rename");
    expect(button).not.toBeNull();
    const [path] = DispatchPath.fromNodeAndEventName(
      button,
      "click",
      container,
      Infinity,
      app.comps,
    );
    expect(path.frames.length).toBe(2);
    // The caller frame keeps a step per crossed component, so bubbling still
    // visits Panel and Toolbar on the way back out.
    expect(path.frames[0].base.steps.length).toBe(0);
    expect(path.frames[0].items.map((s) => s.field)).toEqual(["panel", "toolbar"]);
    // The active frame is based at the value's own address and descends no further.
    expect(path.frames[1].base.steps.map((s) => s.field)).toEqual(["sheet"]);
    expect(path.frames[1].items.length).toBe(0);
    cleanup();
  });

  test("the transaction path is the active frame: the value's own address", () => {
    const { container, app, cleanup } = workspaceApp();
    const button = container.querySelector(".rename");
    const [path] = DispatchPath.fromNodeAndEventName(
      button,
      "click",
      container,
      Infinity,
      app.comps,
    );
    const txn = path.toTransactionPath();
    // Workspace -> .sheet : the caller frame's Panel/Toolbar steps are not part of it.
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0]).toBeInstanceOf(FieldStep);
    expect(txn.steps[0].field).toBe("sheet");
    expect(txn.lookup(app.state.val)).toBe(app.state.val.sheet);
    cleanup();
  });

  test("clicking inside a dynamically-rendered component mutates the producer's data", () => {
    const { container, app, cleanup } = workspaceApp();
    expect(app.state.val.sheet.title).toBe("untitled");
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.sheet.title).toBe("renamed");
    cleanup();
  });

  test("producer is also the consumer (own provide): it resumes at its own field", () => {
    const Doc = component({
      name: "Doc",
      fields: { title: "untitled" },
      receive: {
        rename(draft) {
          draft.title = "renamed";
        },
      },
      view: html`<button class="rename" @on.click="rename">x</button>`,
    });
    const Solo = component({
      name: "Solo",
      fields: { doc: null },
      provide: { d: ".doc" },
      view: html`<div class="solo"><x render="*d"></x></div>`,
    });
    const root = Solo.make({ doc: Doc.make() });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Solo, Doc],
      null,
      root,
      HeadlessParseContext,
    );
    const [path] = DispatchPath.fromNodeAndEventName(
      container.querySelector(".rename"),
      "click",
      container,
      Infinity,
      app.comps,
    );
    const txn = path.toTransactionPath();
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0].field).toBe("doc");
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.doc.title).toBe("renamed");
    cleanup();
  });

  test("@each='*dyn' with <x render-it> resumes at the producer's keyed item", () => {
    const Row = component({
      name: "Row",
      fields: { label: "" },
      receive: {
        bump(draft) {
          draft.label = `${this.label}!`;
        },
      },
      view: html`<button class="row" :data-row=".label" @on.click="bump">r</button>`,
    });
    const Inner = component({
      name: "Inner",
      fields: {},
      lookup: [{ name: "rows", default: ".missing" }],
      view: html`<div class="inner">
        <div @each="*rows"><x render-it></x></div>
      </div>`,
    });
    const Grid = component({
      name: "Grid",
      fields: { rows: map(), inner: null },
      provide: { rows: ".rows" },
      view: html`<div class="grid"><x render=".inner"></x></div>`,
    });
    const root = Grid.make({
      rows: map({ a: Row.make({ label: "a" }), b: Row.make({ label: "b" }) }),
      inner: Inner.make(),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Grid, Inner, Row],
      null,
      root,
      HeadlessParseContext,
    );
    const [path] = DispatchPath.fromNodeAndEventName(
      container.querySelector('[data-row="b"]'),
      "click",
      container,
      Infinity,
      app.comps,
    );
    const txn = path.toTransactionPath();
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0]).toBeInstanceOf(SeqStep);
    expect(txn.steps[0].field).toBe("rows");
    expect(txn.steps[0].key).toBe("b");
    container.querySelector('[data-row="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.rows.get("b").label).toBe("b!");
    expect(app.state.val.rows.get("a").label).toBe("a");
    cleanup();
  });

  // The frame algebra on its own, without a render behind it.
  test("toTransactionPath reads the active frame alone", () => {
    const p = DispatchPath.ofSteps([new FieldStep("panel"), new FieldStep("toolbar")]).pushFrame(
      new Path([new FieldStep("sheet")]),
    );
    expect(p.toTransactionPath().steps.map((s) => s.field)).toEqual(["sheet"]);
    // Descending inside the resumed component extends the ACTIVE frame.
    const deeper = p.pushItem(new SeqStep("rows", "b"));
    const steps = deeper.toTransactionPath().steps;
    expect(steps.map((s) => s.field)).toEqual(["sheet", "rows"]);
    expect(steps[1].key).toBe("b");
  });

  test("popStep drains the active frame, then returns to the visual caller", () => {
    const p = DispatchPath.ofSteps([new FieldStep("panel"), new FieldStep("toolbar")])
      .pushFrame(new Path([new FieldStep("sheet")]))
      .pushItem(new FieldStep("body"));
    const inFrame = p.popStep(); // still inside the resumed component
    expect(inFrame.toTransactionPath().steps.map((s) => s.field)).toEqual(["sheet"]);
    const back = inFrame.popStep(); // top of the frame: back to the caller
    expect(back.toTransactionPath().steps.map((s) => s.field)).toEqual(["panel", "toolbar"]);
    expect(
      back
        .popStep()
        .toTransactionPath()
        .steps.map((s) => s.field),
    ).toEqual(["panel"]);
    expect(back.popStep().popStep().canPop()).toBe(false);
  });

  test("compact drops frame-only steps inside every frame independently", () => {
    const p = DispatchPath.ofSteps([new BindStep({}), new FieldStep("panel")]).pushFrame(
      new Path([new FieldStep("sheet")]),
    );
    const c = p.pushItem(new EachBindStep(null, "k")).compact();
    expect(c.frames[0].items.map((s) => s.field)).toEqual(["panel"]);
    expect(c.frames[1].items.length).toBe(0);
    expect(c.frames[1].base.steps.map((s) => s.field)).toEqual(["sheet"]);
  });

  test("an intent walk visits the intermediate components, then the producer", () => {
    const visited = [];
    const Sheet = component({
      name: "Sheet",
      fields: { title: "untitled" },
      receive: {
        ping(draft, ctx) {
          ctx.intent("ping", [], { route: ["dyn"] });
          return this;
        },
      },
      view: html`<button class="ping" @on.click="ping">x</button>`,
    });
    const mkIntentObserver = (name) => ({
      ping() {
        visited.push(name);
        return this;
      },
    });
    const Toolbar = component({
      name: "Toolbar",
      fields: {},
      intent: mkIntentObserver("Toolbar"),
      lookup: [{ name: "active", default: ".missing" }],
      view: html`<div class="toolbar"><x render="*active"></x></div>`,
    });
    const Panel = component({
      name: "Panel",
      fields: { toolbar: null },
      intent: mkIntentObserver("Panel"),
      view: html`<div class="panel"><x render=".toolbar"></x></div>`,
    });
    const Workspace = component({
      name: "Workspace",
      fields: { sheet: null, panel: null },
      intent: mkIntentObserver("Workspace"),
      provide: { active: ".sheet" },
      view: html`<div class="workspace"><x render=".panel"></x></div>`,
    });
    const root = Workspace.make({
      sheet: Sheet.make(),
      panel: Panel.make({ toolbar: Toolbar.make() }),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Workspace, Panel, Toolbar, Sheet],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector(".ping").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    // The dispatch path keeps every crossed component, so the walk visits the
    // intermediate Toolbar and Panel before reaching the producer Workspace. None of
    // them replies, so each is an OBSERVER and the walk goes on past it.
    expect(visited).toEqual(["Toolbar", "Panel", "Workspace"]);
    cleanup();
  });

  test("a seq-access dynamic (.a[.b]) resumes at the producer's live-keyed item", () => {
    const Sheet = component({
      name: "Sheet",
      fields: { title: "untitled" },
      receive: {
        rename(draft) {
          draft.title = "renamed";
        },
      },
      view: html`<button class="rename" @on.click="rename">x</button>`,
    });
    const Toolbar = component({
      name: "Toolbar",
      fields: {},
      lookup: [{ name: "active", default: ".missing" }],
      view: html`<div class="toolbar"><x render="*active"></x></div>`,
    });
    const Workspace = component({
      name: "Workspace",
      fields: { sheets: map(), selId: "", toolbar: null },
      provide: { active: ".sheets[.selId]" },
      view: html`<div class="workspace"><x render=".toolbar"></x></div>`,
    });
    const root = Workspace.make({
      sheets: map({ a: Sheet.make({ title: "a" }), b: Sheet.make({ title: "b" }) }),
      selId: "b",
      toolbar: Toolbar.make(),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Workspace, Toolbar, Sheet],
      null,
      root,
      HeadlessParseContext,
    );
    const [path] = DispatchPath.fromNodeAndEventName(
      container.querySelector(".rename"),
      "click",
      container,
      Infinity,
      app.comps,
    );
    const txn = path.toTransactionPath();
    // The active frame is the producer's `.sheets[.selId]` seq-access itself.
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0].seqField).toBe("sheets");
    expect(txn.steps[0].keyField).toBe("selId");
    expect(txn.lookup(app.state.val)).toBe(app.state.val.sheets.get("b"));
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.sheets.get("b").title).toBe("renamed");
    expect(app.state.val.sheets.get("a").title).toBe("a");
    cleanup();
  });

  test("pinKeys freezes a SeqAccessStep's key into a literal SeqStep", () => {
    const root = map({ sheets: map({ a: 1, b: 2 }), selId: "b" });
    const path = new Path([new SeqAccessStep("sheets", "selId")]);
    const pinned = path.pinKeys(root);
    expect(pinned).not.toBe(path);
    expect(pinned.steps[0]).toBeInstanceOf(SeqStep);
    expect(pinned.steps[0].field).toBe("sheets");
    expect(pinned.steps[0].key).toBe("b");
    // Frozen: a later key change no longer moves where the pinned path resolves.
    expect(pinned.lookup(root.set("selId", "a"))).toBe(2);
  });

  test("pinKeys returns the same Path when there is nothing to pin", () => {
    const root = map({ a: map({ b: 1 }) });
    const path = new Path([new FieldStep("a"), new FieldStep("b")]);
    expect(path.pinKeys(root)).toBe(path);
  });

  test("two components rendering the same *items sequence do not alias in the cache", () => {
    const Entry = component({
      name: "Entry",
      fields: { name: "" },
      view: html`<span class="entry" @text=".name"></span>`,
    });
    const Child = component({
      name: "Child",
      fields: {},
      lookup: [{ name: "items", default: ".missing" }],
      view: html`<div class="child">
        <div @each="*items" class="child-row"><x render-it></x></div>
      </div>`,
    });
    const Owner = component({
      name: "Owner",
      fields: { items: map(), child: null, picked: "" },
      receive: {
        pick(draft, k) {
          draft.picked = k;
        },
      },
      provide: { items: ".items" },
      view: html`<div class="owner">
        <div @each="*items" class="owner-row">
          <x render-it></x>
          <button class="pick" :data-k="@key" @on.click="pick @key">pick</button>
        </div>
        <x render=".child"></x>
      </div>`,
    });
    const root = Owner.make({
      items: map({ a: Entry.make({ name: "A" }), b: Entry.make({ name: "B" }) }),
      child: Child.make(),
    });
    // Render with the DOM cache ON (the bug only surfaces with caching): the
    // owner and child both iterate the *same* `*items` values, and per-view node
    // ids collide, so the child's @each used to alias the owner's rows.
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Owner, Child, Entry],
      null,
      root,
      HeadlessParseContext,
      { noCache: false },
    );
    expect(container.querySelectorAll(".owner > .owner-row").length).toBe(2);
    expect(container.querySelectorAll(".child .child-row").length).toBe(2);
    // The child list must NOT inherit the owner's select buttons.
    expect(container.querySelectorAll(".child .pick").length).toBe(0);
    // Reconstructing an event path from a child entry must not crash.
    const childEntry = container.querySelector(".child .entry");
    expect(() =>
      DispatchPath.fromNodeAndEventName(childEntry, "click", container, Infinity, app.comps, false),
    ).not.toThrow();
    // The owner's own select button still works.
    container.querySelector('.owner > .owner-row .pick[data-k="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.picked).toBe("b");
    cleanup();
  });

  // A `Doc` with one message, reused by the tests below.
  const mkDoc = () =>
    component({
      name: "Doc",
      fields: { title: "untitled" },
      receive: {
        rename(draft) {
          draft.title = "renamed";
        },
      },
      view: html`<button class="rename" @on.click="rename">x</button>`,
    });

  // The producer is found in the LIVE RENDER ANCESTRY, not by searching the
  // registration scope, so two components may publish one name and the nearer
  // rendered one shadows the outer one — the way any scope does.
  test("a nested provider shadows an outer one of the same name", () => {
    const Doc = mkDoc();
    const Leaf = component({
      name: "Leaf",
      fields: {},
      lookup: ["sel"],
      view: html`<div class="leaf"><x render="*sel"></x></div>`,
    });
    const Inner = component({
      name: "Inner",
      fields: { b: null, leaf: null },
      provide: { sel: ".b" },
      view: html`<div class="inner"><x render=".leaf"></x></div>`,
    });
    const Outer = component({
      name: "Outer",
      fields: { a: null, inner: null },
      provide: { sel: ".a" },
      view: html`<div class="outer"><x render=".inner"></x></div>`,
    });
    const root = Outer.make({
      a: Doc.make({ title: "outer" }),
      inner: Inner.make({ b: Doc.make({ title: "inner" }), leaf: Leaf.make() }),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Outer, Inner, Leaf, Doc],
      null,
      root,
      HeadlessParseContext,
    );
    const [path] = DispatchPath.fromNodeAndEventName(
      container.querySelector(".rename"),
      "click",
      container,
      Infinity,
      app.comps,
    );
    // The frame is based at the NEARER provider's value, absolute from the root.
    expect(path.toTransactionPath().steps.map((st) => st.field)).toEqual(["inner", "b"]);
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.inner.b.title).toBe("renamed");
    expect(app.state.val.a.title).toBe("outer"); // the outer provider was shadowed
    cleanup();
  });

  // The `lex` leg of a value lookup: a name registered on the scope as an absolute
  // path from the state root. Nothing above the consumer publishes it, and no
  // wrapper component exists solely to.
  test("a lexically registered path resumes with no provider above it", () => {
    const Doc = mkDoc();
    const Body = component({
      name: "Body",
      fields: {},
      lookup: ["session"],
      view: html`<div class="body"><x render="*session"></x></div>`,
    });
    const Root = component({
      name: "Root",
      fields: { session: null, body: null },
      view: html`<div class="root"><x render=".body"></x></div>`,
    });
    const root = Root.make({ session: Doc.make(), body: Body.make() });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Root, Body, Doc],
      null,
      root,
      HeadlessParseContext,
      { noCache: true, paths: { session: path().field("session") } },
    );
    const [dispatched] = DispatchPath.fromNodeAndEventName(
      container.querySelector(".rename"),
      "click",
      container,
      Infinity,
      app.comps,
    );
    expect(dispatched.toTransactionPath().steps.map((st) => st.field)).toEqual(["session"]);
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.session.title).toBe("renamed");
    cleanup();
  });

  // The route is `dyn lex`: a provider that actually rendered above the consumer
  // answers before a path registered under the same name.
  test("a rendered provider wins over a registered path of the same name", () => {
    const Doc = mkDoc();
    const Body = component({
      name: "Body",
      fields: {},
      lookup: ["session"],
      view: html`<div class="body"><x render="*session"></x></div>`,
    });
    const Root = component({
      name: "Root",
      fields: { session: null, live: null, body: null },
      provide: { session: ".live" },
      view: html`<div class="root"><x render=".body"></x></div>`,
    });
    const root = Root.make({
      session: Doc.make({ title: "lexical" }),
      live: Doc.make({ title: "dynamic" }),
      body: Body.make(),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Root, Body, Doc],
      null,
      root,
      HeadlessParseContext,
      { noCache: true, paths: { session: path().field("session") } },
    );
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.live.title).toBe("renamed");
    expect(app.state.val.session.title).toBe("lexical");
    cleanup();
  });

  // A provider inside an iterated component publishes the ITEM's address, so the
  // base has to carry the loop key: `@each` moves the render position, and a
  // provide is located from wherever its publisher actually rendered.
  test("a provider inside an iterated component resumes at the keyed item", () => {
    const Doc = mkDoc();
    const Slot = component({
      name: "Slot",
      fields: {},
      lookup: ["sel"],
      view: html`<div class="slot"><x render="*sel"></x></div>`,
    });
    const Cell = component({
      name: "Cell",
      fields: { doc: null, slot: null },
      provide: { sel: ".doc" },
      view: html`<div class="cell"><x render=".slot"></x></div>`,
    });
    const Grid = component({
      name: "Grid",
      fields: { cells: [] },
      view: html`<div class="grid" @each=".cells"><x render-it></x></div>`,
    });
    const mkCell = (title) => Cell.make({ doc: Doc.make({ title }), slot: Slot.make() });
    const root = Grid.make({ cells: [mkCell("one"), mkCell("two")] });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Grid, Cell, Slot, Doc],
      null,
      root,
      HeadlessParseContext,
    );
    const buttons = container.querySelectorAll(".rename");
    expect(buttons.length).toBe(2);
    const [dispatched] = DispatchPath.fromNodeAndEventName(
      buttons[1],
      "click",
      container,
      Infinity,
      app.comps,
    );
    expect(dispatched.toTransactionPath().toKeys()).toEqual([
      { field: "cells", key: 1 },
      { field: "doc" },
    ]);
    buttons[1].click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.cells[1].doc.title).toBe("renamed");
    expect(app.state.val.cells[0].doc.title).toBe("one");
    cleanup();
  });

  // A resumed site bakes its base into the DOM it renders, so two consumers
  // resuming the SAME value at different addresses must not share a cache entry —
  // otherwise the second would edit the first one's data.
  test("the same value resumed at two addresses does not alias in the cache", () => {
    const Doc = mkDoc();
    const Slot = component({
      name: "Slot",
      fields: {},
      lookup: ["sel"],
      view: html`<div class="slot"><x render="*sel"></x></div>`,
    });
    const mkHolder = (name) =>
      component({
        name,
        fields: { doc: null, slot: null },
        provide: { sel: ".doc" },
        view: html`<div class="${name}"><x render=".slot"></x></div>`,
      });
    const Left = mkHolder("Left");
    const Right = mkHolder("Right");
    const Wrap = component({
      name: "Wrap",
      fields: { p: null, q: null },
      view: html`<div class="wrap"><x render=".p"></x><x render=".q"></x></div>`,
    });
    // ONE Doc value in two places: identical by reference, so the cache can only
    // tell the two render sites apart by where they are.
    const doc = Doc.make({ title: "shared" });
    const root = Wrap.make({
      p: Left.make({ doc, slot: Slot.make() }),
      q: Right.make({ doc, slot: Slot.make() }),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Wrap, Left, Right, Slot, Doc],
      null,
      root,
      HeadlessParseContext,
      { noCache: false },
    );
    const buttons = container.querySelectorAll(".rename");
    expect(buttons.length).toBe(2);
    buttons[1].click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.q.doc.title).toBe("renamed");
    expect(app.state.val.p.doc.title).toBe("shared");
    cleanup();
  });
});

describe("passthrough component (bare <x render> as the whole view)", () => {
  // A component whose view is just `<x render=".child">` produces no DOM
  // element of its own to carry `data-cid`; its boundary is recorded only in
  // the `Comp` meta comment. Path reconstruction must still cross it.
  function passthroughApp(parentView) {
    const Child = component({
      name: "Child",
      fields: { title: "untitled" },
      receive: {
        rename(draft) {
          draft.title = "renamed";
        },
      },
      view: html`<button class="rename" @on.click="rename">x</button>`,
    });
    const Parent = component({
      name: "Parent",
      fields: { child: null },
      view: parentView,
    });
    const root = Parent.make({ child: Child.make() });
    return renderToHTMLNode(document, [Parent, Child], null, root, HeadlessParseContext);
  }

  test("reconstructs the path through a bare-render parent", () => {
    const { container, app, cleanup } = passthroughApp(html`<x render=".child"></x>`);
    const [path] = DispatchPath.fromNodeAndEventName(
      container.querySelector(".rename"),
      "click",
      container,
      Infinity,
      app.comps,
    );
    const txn = path.toTransactionPath();
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0]).toBeInstanceOf(FieldStep);
    expect(txn.steps[0].field).toBe("child");
    cleanup();
  });

  test("dispatch mutates the child through a bare-render parent", () => {
    const { container, app, cleanup } = passthroughApp(html`<x render=".child"></x>`);
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.child.title).toBe("renamed");
    cleanup();
  });

  test("still works when the parent wraps the child in an element", () => {
    const { container, app, cleanup } = passthroughApp(
      html`<div class="wrap"><x render=".child"></x></div>`,
    );
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.child.title).toBe("renamed");
    cleanup();
  });
});

describe("@show-hidden items in a render-each list (path rebuild regression)", () => {
  // Reproduces a null-pointer crash in resolvePathStep. A `render-each` whose
  // item component's root carries `@show` renders *null* for a hidden item, but
  // the renderer still emits that item's `§Each§`+`§Comp§` meta comments (only
  // the DOM is null, not the metas). Those dangling metas sit immediately before
  // the next *visible* item, so walking up from a click crosses the hidden
  // item's `Comp` boundary a second time; resolvePathStep then looks up the
  // render-each's node id inside the (node-less) item component, where
  // getNodeForId returns null and `null.toPathStep` throws:
  //   TypeError: ... (evaluating 'ctx.resolveNode().toPathStep')
  // Both `@show @on.click` and `@on.click @show` orderings hit it identically,
  // so the attribute order does NOT change the result.
  const makeItem = (itemView) =>
    component({
      name: "Item",
      fields: { uid: "", visible: true },
      receive: {
        tap(draft) {
          draft.uid = `${this.uid}!`;
        },
      },
      view: itemView,
    });
  const List = component({
    name: "List",
    fields: { items: [] },
    view: html`<ul>
      <x render-each=".items"></x>
    </ul>`,
  });
  // items: array of [uid, visible]
  function appWith(itemView, items) {
    const Item = makeItem(itemView);
    const root = List.make({
      items: items.map(([uid, visible]) => Item.make({ uid, visible })),
    });
    return renderToHTMLNode(document, [List, Item], null, root, HeadlessParseContext);
  }

  const SHOW_THEN_CLICK = html`<button @show=".visible" @on.click="tap" :data-uid=".uid">
    x
  </button>`;
  const CLICK_THEN_SHOW = html`<button @on.click="tap" @show=".visible" :data-uid=".uid">
    x
  </button>`;

  test("reconstructs the path for a visible item preceded by a hidden one", () => {
    const { container, app, cleanup } = appWith(SHOW_THEN_CLICK, [
      ["a", false],
      ["b", true],
    ]);
    const node = container.querySelector('[data-uid="b"]');
    expect(node).not.toBeNull();
    // The dangling `§Each§`/`§Comp§` metas of the hidden "a" precede "b".
    let result;
    expect(() => {
      result = DispatchPath.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
    }).not.toThrow();
    const [path, handlers] = result;
    expect(handlers).not.toBeNull();
    // The path must resolve to item "b" (the second render-each entry), not the
    // hidden "a" whose dangling metas come first.
    expect(path.toTransactionPath().lookup(app.state.val)).toBe(app.state.val.items[1]);
    cleanup();
  });

  test("attribute order does not change the result (@on.click before @show)", () => {
    const { container, app, cleanup } = appWith(CLICK_THEN_SHOW, [
      ["a", false],
      ["b", true],
    ]);
    const node = container.querySelector('[data-uid="b"]');
    let result;
    expect(() => {
      result = DispatchPath.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
    }).not.toThrow();
    const [path, handlers] = result;
    expect(handlers).not.toBeNull();
    expect(path.toTransactionPath().lookup(app.state.val)).toBe(app.state.val.items[1]);
    cleanup();
  });

  test("survives multiple consecutive hidden items before the clicked one", () => {
    const { container, app, cleanup } = appWith(SHOW_THEN_CLICK, [
      ["a", false],
      ["b", false],
      ["c", true],
    ]);
    const node = container.querySelector('[data-uid="c"]');
    let path;
    expect(() => {
      [path] = DispatchPath.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
    }).not.toThrow();
    expect(path.toTransactionPath().lookup(app.state.val)).toBe(app.state.val.items[2]);
    cleanup();
  });

  test("clicking the visible item dispatches to its handler (end-to-end)", () => {
    // The crash happens inside the delegated DOM listener, where the host
    // swallows it — so the click() call itself does not surface the error, the
    // handler simply never runs. The user-visible symptom is a dead click.
    const { container, app, cleanup } = appWith(SHOW_THEN_CLICK, [
      ["a", false],
      ["b", true],
    ]);
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    // Only the clicked, visible item should be mutated.
    expect(app.state.val.items[1].uid).toBe("b!");
    expect(app.state.val.items[0].uid).toBe("a");
    cleanup();
  });
});

describe("render-each is @each + <x render-it>: @key/@value semantics", () => {
  // render-each is sugar for @each + <x render-it>, so it inherits the frame
  // boundary: @key/@value bound by the iteration live in the surrounding scope
  // and are NOT visible inside the item component's own view (the render-it
  // pushes a clean frame). This pins that render output and event-path
  // reconstruction AGREE — the asymmetry the unification removes.
  test("item view reading @key/@value inside the child resolves to null (frame barrier)", () => {
    let receivedKey = "<not-set>";
    let receivedValue = "<not-set>";
    const Item = component({
      name: "REItem",
      fields: { uid: "" },
      receive: {
        recordIt(draft, k, v) {
          receivedKey = k;
          receivedValue = v;
          return this;
        },
      },
      view: html`<button :data-uid=".uid" @on.click="recordIt @key @value">x</button>`,
    });
    const List = component({
      name: "REList",
      fields: { items: [] },
      view: html`<ul>
        <x render-each=".items"></x>
      </ul>`,
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
    // Same result render-side and rebuild-side: the frame barrier held.
    expect(receivedKey).toBeNull();
    expect(receivedValue).toBeNull();
    cleanup();
  });

  test("clicking a render-each item dispatches to that item (reconstruction is keyed)", () => {
    const Item = component({
      name: "REItem2",
      fields: { uid: "" },
      receive: {
        tap(draft) {
          draft.uid = `${this.uid}!`;
        },
      },
      view: html`<button :data-uid=".uid" @on.click="tap">x</button>`,
    });
    const List = component({
      name: "REList2",
      fields: { items: [] },
      view: html`<ul>
        <x render-each=".items"></x>
      </ul>`,
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
    expect(app.state.val.items[1].uid).toBe("b!");
    expect(app.state.val.items[0].uid).toBe("a");
    cleanup();
  });
});
