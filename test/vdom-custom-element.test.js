import { beforeEach, describe, expect, test } from "bun:test";
import { h } from "../src/vdom.js";
import { setupJsdom, vdomRender } from "./dom.js";

let document;
beforeEach(() => {
  document = setupJsdom();
});

function defineSetterElement(window, tagName) {
  const calls = [];
  class SetterElement extends window.HTMLElement {
    set items(v) {
      calls.push(v);
      this._items = v;
    }
    get items() {
      return this._items;
    }
    set config(v) {
      calls.push(v);
      this._config = v;
    }
    get config() {
      return this._config;
    }
  }
  window.customElements.define(tagName, SetterElement);
  return calls;
}

describe("custom element property setters", () => {
  test("array prop invokes setter with the actual array on initial render", () => {
    const window = document.defaultView;
    const calls = defineSetterElement(window, "x-array-thing");

    const tree = h("x-array-thing", { items: [1, 2, 3] }, []);
    const container = document.createElement("div");
    vdomRender(tree, container, { document });

    const el = container.firstChild;
    expect(calls).toHaveLength(1);
    expect(Array.isArray(calls[0])).toBe(true);
    expect(calls[0]).toEqual([1, 2, 3]);
    expect(Array.isArray(el.items)).toBe(true);
    expect(el.items).toEqual([1, 2, 3]);
  });

  test("array prop update re-invokes setter with new array", () => {
    const window = document.defaultView;
    const calls = defineSetterElement(window, "x-array-update");

    const container = document.createElement("div");
    vdomRender(h("x-array-update", { items: [1, 2] }, []), container, { document });
    vdomRender(h("x-array-update", { items: [9, 8, 7] }, []), container, { document });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([9, 8, 7]);
    expect(Array.isArray(container.firstChild.items)).toBe(true);
    expect(container.firstChild.items).toEqual([9, 8, 7]);
  });

  test("object prop invokes setter with the actual object", () => {
    const window = document.defaultView;
    const calls = defineSetterElement(window, "x-object-thing");

    const cfg = { a: 1, b: { nested: true } };
    vdomRender(h("x-object-thing", { config: cfg }, []), document.createElement("div"), {
      document,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(cfg);
  });

  test("object prop update assigns the new object reference, not key-by-key mutation", () => {
    const window = document.defaultView;
    const calls = defineSetterElement(window, "x-object-update");

    const container = document.createElement("div");
    const first = { a: 1 };
    const second = { b: 2 };
    vdomRender(h("x-object-update", { config: first }, []), container, { document });
    vdomRender(h("x-object-update", { config: second }, []), container, { document });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(second);
    expect(container.firstChild.config).toBe(second);
    expect(first).toEqual({ a: 1 });
  });
});
