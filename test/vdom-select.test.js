import { beforeEach, describe, expect, test } from "bun:test";
import { h, render as vdomRender } from "../src/vdom.js";
import { setupJsdom } from "./dom.js";

let document;
beforeEach(() => {
  document = setupJsdom();
});

function render(vnode) {
  return vnode.toDom({ document });
}

const opt = (value, text = value) => h("option", { value }, text);

describe("select value → matching option selected", () => {
  test("initial render selects the matching option", () => {
    const node = render(h("select", { value: "b" }, [opt("a"), opt("b"), opt("c")]));
    expect(node.value).toBe("b");
    expect(node.selectedIndex).toBe(1);
    expect(node.children[1].selected).toBe(true);
  });

  test("initial render with no matching option does not throw and selects none", () => {
    const node = render(h("select", { value: "z" }, [opt("a"), opt("b"), opt("c")]));
    expect(node.children[0].getAttribute("selected")).toBeNull();
    expect(node.children[1].getAttribute("selected")).toBeNull();
    expect(node.children[2].getAttribute("selected")).toBeNull();
    expect(node.selectedIndex).toBe(-1);
    expect(node.value).toBe("");
  });

  test("morph: changing value from 'a' to 'c' updates selection and preserves DOM node", () => {
    const container = document.createElement("div");
    vdomRender(h("select", { value: "a" }, [opt("a"), opt("b"), opt("c")]), container, {
      document,
    });
    const first = container.firstChild;
    expect(first.selectedIndex).toBe(0);
    vdomRender(h("select", { value: "c" }, [opt("a"), opt("b"), opt("c")]), container, {
      document,
    });
    const second = container.firstChild;
    expect(second).toBe(first);
    expect(second.selectedIndex).toBe(2);
    expect(second.value).toBe("c");
  });

  test("morph reapplies value when a newly-appended option matches the existing value", () => {
    const container = document.createElement("div");
    vdomRender(h("select", { value: "c" }, [opt("a"), opt("b")]), container, { document });
    const sel = container.firstChild;
    expect(sel.value).not.toBe("c");
    vdomRender(h("select", { value: "c" }, [opt("a"), opt("b"), opt("c")]), container, {
      document,
    });
    expect(container.firstChild).toBe(sel);
    expect(sel.value).toBe("c");
    expect(sel.selectedIndex).toBe(2);
  });

  test("morph: removing the selected option", () => {
    const container = document.createElement("div");
    vdomRender(h("select", { value: "b" }, [opt("a"), opt("b"), opt("c")]), container, {
      document,
    });
    const sel = container.firstChild;
    expect(sel.value).toBe("b");
    vdomRender(h("select", { value: "b" }, [opt("a"), opt("c")]), container, { document });
    expect(container.firstChild).toBe(sel);
    expect(sel.value).toBe("");
    expect(sel.selectedIndex).toBe(-1);
  });

  test("morph reorders options while value stays the same", () => {
    const container = document.createElement("div");
    vdomRender(h("select", { value: "b" }, [opt("a"), opt("b"), opt("c")]), container, {
      document,
    });
    const sel = container.firstChild;
    expect(sel.selectedIndex).toBe(1);
    vdomRender(h("select", { value: "b" }, [opt("c"), opt("b"), opt("a")]), container, {
      document,
    });
    expect(sel.value).toBe("b");
    expect(sel.selectedIndex).toBe(1);
  });

  test("no `selected` attribute is written on the matching option", () => {
    const node = render(h("select", { value: "b" }, [opt("a"), opt("b"), opt("c")]));
    expect(node.children[1].selected).toBe(true);
    expect(node.children[1].getAttribute("selected")).toBeNull();
    expect(node.children[1].hasAttribute("selected")).toBe(false);
  });

  test("non-select elements with a value prop are unaffected", () => {
    const node = render(h("input", { value: "x" }));
    expect(node.value).toBe("x");
  });
});
