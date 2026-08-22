import { describe, expect, test } from "vitest";
import { component, html } from "../index.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { EventMemberVal } from "../src/value.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();

// Fire a real DOM `input` event at the element and drain the transactor, so
// the handler runs through the same InputEvent dispatch as in the browser.
// Constructors come from the jsdom window: a Node-global Event is not an
// instance of the window's own Event interface.
function fireInput(app, el, value) {
  const win = el.ownerDocument.defaultView;
  el.value = value;
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
  while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
}

describe("e.<member> handler args dispatch through InputEvent", () => {
  test("e.value reaches the receive handler like the implicit value name", () => {
    let received = "<not-called>";
    const Comp = component({
      name: "Comp",
      fields: { str: "" },
      receive: {
        setStr(draft, v) {
          received = v;
          draft.str = v;
        },
      },
      view: html`<input @on.input="setStr e.value" />`,
    });
    const root = Comp.make({ str: "" });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Comp],
      null,
      root,
      HeadlessParseContext,
    );
    fireInput(app, container.querySelector("input"), "hello");
    expect(received).toBe("hello");
    expect(app.state.val.str).toBe("hello");
    cleanup();
  });

  test("e.key reads the DOM event property", () => {
    let received = "<not-called>";
    const Comp = component({
      name: "Comp",
      fields: {},
      receive: {
        onKey(draft, k) {
          received = k;
        },
      },
      view: html`<input @on.keydown="onKey e.key" />`,
    });
    const root = Comp.make({});
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Comp],
      null,
      root,
      HeadlessParseContext,
    );
    const input = container.querySelector("input");
    const win = input.ownerDocument.defaultView;
    input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(received).toBe("Escape");
    cleanup();
  });

  test("checkbox inputs normalize e.value to checked", () => {
    let received = "<not-called>";
    const Comp = component({
      name: "Comp",
      fields: { on: false },
      receive: {
        setOn(draft, v) {
          received = v;
          draft.on = v;
        },
      },
      view: html`<input type="checkbox" @on.change="setOn e.value" />`,
    });
    const root = Comp.make({ on: false });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Comp],
      null,
      root,
      HeadlessParseContext,
    );
    const box = container.querySelector("input");
    box.checked = true;
    const win = box.ownerDocument.defaultView;
    box.dispatchEvent(new win.Event("change", { bubbles: true }));
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(received).toBe(true);
    cleanup();
  });

  test("one-level e.valueAsInt resolves through the conveniences table", () => {
    let received = "<not-called>";
    const Comp = component({
      name: "Comp",
      fields: { n: 0 },
      receive: {
        setN(draft, n) {
          received = n;
          draft.n = n;
        },
      },
      view: html`<input type="number" @on.input="setN e.valueAsInt" />`,
    });
    const root = Comp.make({ n: 0 });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Comp],
      null,
      root,
      HeadlessParseContext,
    );
    fireInput(app, container.querySelector("input"), "42");
    expect(received).toBe(42);
    expect(app.state.val.n).toBe(42);
    cleanup();
  });

  test("nested e.target.dataset.<key> reads through real dispatch", () => {
    let received = "<not-called>";
    const Comp = component({
      name: "Comp",
      fields: { slot: "" },
      receive: {
        pickFrom(draft, slot) {
          received = slot;
          draft.slot = slot;
        },
      },
      view: html`<button data-slot="left" @on.click="pickFrom e.target.dataset.slot">go</button>`,
    });
    const root = Comp.make({ slot: "" });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Comp],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector("button").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(received).toBe("left");
    expect(app.state.val.slot).toBe("left");
    cleanup();
  });

  test("e.<member> outside an event transaction evaluates to null", () => {
    // A view can only carry e.member in @on args, so this guards the eval
    // fallback directly rather than through a template.
    expect(new EventMemberVal(["value"]).eval({ lookupEvent: () => null })).toBeNull();
  });
});
