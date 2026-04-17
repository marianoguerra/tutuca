import { beforeEach, describe, expect, test } from "bun:test";
import {
  h,
  VComment,
  VFragment,
  VNode,
  VText,
  render as vdomRender,
} from "../src/vdom.js";
import { setupJsdom } from "./dom.js";

let document;
beforeEach(() => {
  document = setupJsdom();
});

function render(vnode) {
  return vnode.toDom({ document });
}

describe("VirtualNode", () => {
  test("VNode is a class", () => {
    expect(typeof VNode).toBe("function");
  });
  test("VText is a class", () => {
    expect(typeof VText).toBe("function");
  });
  test("VNode has correct nodeType", () => {
    const node = new VNode("DIV", {}, []);
    expect(node.nodeType).toBe(1);
  });
  test("VText has correct nodeType", () => {
    const node = new VText("hello");
    expect(node.nodeType).toBe(3);
  });
});
describe("isEqualTo", () => {
  describe("VText", () => {
    test("equal text nodes are equal", () => {
      const a = new VText("hello");
      const b = new VText("hello");
      expect(a.isEqualTo(b)).toBe(true);
      expect(b.isEqualTo(a)).toBe(true);
    });
    test("different text nodes are not equal", () => {
      const a = new VText("hello");
      const b = new VText("world");
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("VText is not equal to VComment", () => {
      const a = new VText("hello");
      const b = new VComment("hello");
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("VText is not equal to null/undefined", () => {
      const a = new VText("hello");
      expect(a.isEqualTo(null)).toBe(false);
      expect(a.isEqualTo(undefined)).toBe(false);
    });
  });
  describe("VComment", () => {
    test("equal comments are equal", () => {
      const a = new VComment("comment");
      const b = new VComment("comment");
      expect(a.isEqualTo(b)).toBe(true);
    });
    test("different comments are not equal", () => {
      const a = new VComment("one");
      const b = new VComment("two");
      expect(a.isEqualTo(b)).toBe(false);
    });
  });
  describe("VFragment", () => {
    test("empty fragments are equal", () => {
      const a = new VFragment([]);
      const b = new VFragment([]);
      expect(a.isEqualTo(b)).toBe(true);
    });
    test("fragments with equal children are equal", () => {
      const a = new VFragment([new VText("hello"), new VText("world")]);
      const b = new VFragment([new VText("hello"), new VText("world")]);
      expect(a.isEqualTo(b)).toBe(true);
    });
    test("fragments with different children are not equal", () => {
      const a = new VFragment([new VText("hello")]);
      const b = new VFragment([new VText("world")]);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("fragments with different child count are not equal", () => {
      const a = new VFragment([new VText("hello")]);
      const b = new VFragment([new VText("hello"), new VText("world")]);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("flattens nested VFragment children", () => {
      const inner = new VFragment([new VText("a"), new VText("b")]);
      const outer = new VFragment([new VText("x"), inner, new VText("y")]);
      expect(outer.childs.length).toBe(4);
      expect(outer.childs[0].text).toBe("x");
      expect(outer.childs[1].text).toBe("a");
      expect(outer.childs[2].text).toBe("b");
      expect(outer.childs[3].text).toBe("y");
    });
  });
  describe("VNode", () => {
    test("flattens VFragment children via h()", () => {
      const frag = new VFragment([new VText("a"), new VText("b")]);
      const node = h("div", null, [new VText("x"), frag, new VText("y")]);
      expect(node.childs.length).toBe(4);
      expect(node.childs[0].text).toBe("x");
      expect(node.childs[1].text).toBe("a");
      expect(node.childs[2].text).toBe("b");
      expect(node.childs[3].text).toBe("y");
    });
    test("equal simple nodes are equal", () => {
      const a = h("div", null, []);
      const b = h("div", null, []);
      expect(a.isEqualTo(b)).toBe(true);
    });
    test("different tags are not equal", () => {
      const a = h("div", null, []);
      const b = h("span", null, []);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("same tag with same attrs are equal", () => {
      const a = h("div", { className: "foo", id: "bar" }, []);
      const b = h("div", { className: "foo", id: "bar" }, []);
      expect(a.isEqualTo(b)).toBe(true);
    });
    test("same tag with different attrs are not equal", () => {
      const a = h("div", { className: "foo" }, []);
      const b = h("div", { className: "bar" }, []);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("same tag with different attr count are not equal", () => {
      const a = h("div", { className: "foo" }, []);
      const b = h("div", { className: "foo", id: "bar" }, []);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("nodes with same children are equal", () => {
      const a = h("div", null, [h("span", null, "hello"), h("span", null, "world")]);
      const b = h("div", null, [h("span", null, "hello"), h("span", null, "world")]);
      expect(a.isEqualTo(b)).toBe(true);
    });
    test("nodes with different children are not equal", () => {
      const a = h("div", null, [h("span", null, "hello")]);
      const b = h("div", null, [h("span", null, "world")]);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("nodes with different child count are not equal", () => {
      const a = h("div", null, [h("span", null, [])]);
      const b = h("div", null, [h("span", null, []), h("span", null, [])]);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("nodes with different keys are not equal", () => {
      const a = h("div", { key: "a" }, []);
      const b = h("div", { key: "b" }, []);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("nodes with same keys are equal", () => {
      const a = h("div", { key: "a" }, []);
      const b = h("div", { key: "a" }, []);
      expect(a.isEqualTo(b)).toBe(true);
    });
    test("nodes with different namespaces are not equal", () => {
      const svgNS = "http://www.w3.org/2000/svg";
      const a = new VNode("svg", {}, [], undefined, svgNS);
      const b = new VNode("svg", {}, [], undefined, null);
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("VNode is not equal to VText", () => {
      const a = h("div", null, []);
      const b = new VText("div");
      expect(a.isEqualTo(b)).toBe(false);
    });
    test("deeply nested equal trees are equal", () => {
      const a = h("div", null, [
        h("ul", null, [h("li", null, "one"), h("li", null, "two")]),
        h("p", null, "text"),
      ]);
      const b = h("div", null, [
        h("ul", null, [h("li", null, "one"), h("li", null, "two")]),
        h("p", null, "text"),
      ]);
      expect(a.isEqualTo(b)).toBe(true);
    });
    test("deeply nested different trees are not equal", () => {
      const a = h("div", null, [h("ul", null, [h("li", null, "one"), h("li", null, "two")])]);
      const b = h("div", null, [h("ul", null, [h("li", null, "one"), h("li", null, "THREE")])]);
      expect(a.isEqualTo(b)).toBe(false);
    });
  });
  describe("diff uses isEqualTo", () => {
    test("equal trees produce no DOM changes on re-render", () => {
      const a = h("div", null, [h("span", null, "hello"), h("span", null, "world")]);
      const b = h("div", null, [h("span", null, "hello"), h("span", null, "world")]);
      const container = document.createElement("div");
      vdomRender(a, container, { document });
      const firstChild = container.childNodes[0];
      vdomRender(b, container, { document });
      // Same DOM node should be reused
      expect(container.childNodes[0]).toBe(firstChild);
    });
    test("structurally equal but different instances preserve DOM reference", () => {
      const a = h("div", { className: "test" }, [h("p", null, "content")]);
      const b = h("div", { className: "test" }, [h("p", null, "content")]);
      expect(a).not.toBe(b); // Different instances
      expect(a.isEqualTo(b)).toBe(true); // But equal
      const container = document.createElement("div");
      vdomRender(a, container, { document });
      const firstChild = container.childNodes[0];
      vdomRender(b, container, { document });
      expect(container.childNodes[0]).toBe(firstChild);
    });
  });
});
describe("h (hyperscript)", () => {
  test("h is a function", () => {
    expect(typeof h).toBe("function");
  });
  test("creates element with tag name", () => {
    const node = h("span", null, []);
    expect(node.tag).toBe("SPAN");
  });
  test("third argument can be child or children", () => {
    const node1 = h("div", { a: "b" }, "test");
    const node2 = h("div", { a: "b" }, ["test"]);
    const node3 = h("div", { a: "b" }, h("p", null, "testing"));
    const node4 = h("div", { a: "b" }, [h("p", null, "testing")]);
    expect(node1.attrs.a).toBe("b");
    expect(node1.childs.length).toBe(1);
    expect(node2.attrs.a).toBe("b");
    expect(node2.childs.length).toBe(1);
    expect(node3.attrs.a).toBe("b");
    expect(node3.childs.length).toBe(1);
    expect(node4.attrs.a).toBe("b");
    expect(node4.childs.length).toBe(1);
  });
  test("className property is applied", () => {
    const node = h("div", { className: "pretty" }, []);
    expect(node.tag).toBe("DIV");
    expect(node.attrs.className).toBe("pretty");
  });
  test("id property is applied", () => {
    const node = h("div", { id: "important" }, []);
    expect(node.tag).toBe("DIV");
    expect(node.attrs.id).toBe("important");
  });
  test("class prop is converted to className", () => {
    const node = h("div", { class: "foo" }, []);
    expect(node.attrs.className).toBe("foo");
    expect(node.attrs.class).toBeUndefined();
  });
  test("for prop is converted to htmlFor", () => {
    const node = h("label", { for: "input-id" }, []);
    expect(node.attrs.htmlFor).toBe("input-id");
    expect(node.attrs.for).toBeUndefined();
  });
  test("data-* props are kept as stringified top-level attrs", () => {
    const node = h("div", { "data-foo": "bar", "data-user-id": 123 }, []);
    expect(node.attrs["data-foo"]).toBe("bar");
    expect(node.attrs["data-user-id"]).toBe("123");
  });
  test("aria-* props are kept as stringified top-level attrs", () => {
    const node = h("div", { "aria-label": "Close", "aria-hidden": true }, []);
    expect(node.attrs["aria-label"]).toBe("Close");
    expect(node.attrs["aria-hidden"]).toBe("true");
  });
  test("data-* and aria-* with false are stringified, not removed", () => {
    const node = h("div", { "data-active": false, "aria-expanded": false }, []);
    expect(node.attrs["data-active"]).toBe("false");
    expect(node.attrs["aria-expanded"]).toBe("false");
  });
  test("creates element with empty props and empty children array", () => {
    const node = h("div", {}, []);
    expect(node).toBeInstanceOf(VNode);
    expect(node.tag).toBe("DIV");
    expect(node.childs).toEqual([]);
    expect(Object.keys(node.attrs)).toEqual([]);
  });
  test("flattens nested empty array", () => {
    const node = h("div", {}, [[]]);
    expect(node).toBeInstanceOf(VNode);
    expect(node.tag).toBe("DIV");
    expect(node.childs).toEqual([]);
  });
  test("flattens nested arrays with children", () => {
    const node = h("div", {}, [["a", "b"], "c", [h("span", null, []), ["d", h("p", null, [])]]]);
    expect(node).toBeInstanceOf(VNode);
    expect(node.childs.length).toBe(6);
    expect(node.childs[0].text).toBe("a");
    expect(node.childs[1].text).toBe("b");
    expect(node.childs[2].text).toBe("c");
    expect(node.childs[3].tag).toBe("SPAN");
    expect(node.childs[4].text).toBe("d");
    expect(node.childs[5].tag).toBe("P");
  });
  test("handles deeply nested arrays", () => {
    const node = h("div", {}, [[[["deep"]]]]);
    expect(node.childs.length).toBe(1);
    expect(node.childs[0].text).toBe("deep");
  });
  test("converts number 0 to VText", () => {
    const node = h("div", {}, [0]);
    expect(node.childs.length).toBe(1);
    expect(node.childs[0]).toBeInstanceOf(VText);
    expect(node.childs[0].text).toBe("0");
  });
  test("converts other numbers to VText", () => {
    const node = h("div", {}, [42, -1, 3.14]);
    expect(node.childs.length).toBe(3);
    expect(node.childs[0].text).toBe("42");
    expect(node.childs[1].text).toBe("-1");
    expect(node.childs[2].text).toBe("3.14");
  });
  test("converts booleans to VText", () => {
    const node = h("div", {}, [true, false]);
    expect(node.childs.length).toBe(2);
    expect(node.childs[0].text).toBe("true");
    expect(node.childs[1].text).toBe("false");
  });
  test("handles mixed primitive children", () => {
    const node = h("div", {}, ["text", 0, true, h("span", null, [])]);
    expect(node.childs.length).toBe(4);
    expect(node.childs[0].text).toBe("text");
    expect(node.childs[1].text).toBe("0");
    expect(node.childs[2].text).toBe("true");
    expect(node.childs[3].tag).toBe("SPAN");
  });
  test("flattens non-Array iterables like Set", () => {
    const set = new Set(["a", "b", "c"]);
    const node = h("div", {}, set);
    expect(node.childs.length).toBe(3);
    expect(node.childs[0].text).toBe("a");
    expect(node.childs[1].text).toBe("b");
    expect(node.childs[2].text).toBe("c");
  });
  test("flattens generator iterables", () => {
    function* items() {
      yield "x";
      yield h("span", null, []);
      yield "y";
    }
    const node = h("div", {}, items());
    expect(node.childs.length).toBe(3);
    expect(node.childs[0].text).toBe("x");
    expect(node.childs[1].tag).toBe("SPAN");
    expect(node.childs[2].text).toBe("y");
  });
  test("flattens Map.values() iterable", () => {
    const map = new Map([
      ["k1", "first"],
      ["k2", "second"],
    ]);
    const node = h("div", {}, map.values());
    expect(node.childs.length).toBe(2);
    expect(node.childs[0].text).toBe("first");
    expect(node.childs[1].text).toBe("second");
  });
  test("treats strings as leaf values, not iterables", () => {
    const node = h("div", {}, ["hello"]);
    expect(node.childs.length).toBe(1);
    expect(node.childs[0].text).toBe("hello");
  });
});
describe("toDom", () => {
  test("renders text node", () => {
    const vdom = h("span", null, "hello");
    const dom = render(vdom);
    expect(dom.tagName).toBe("SPAN");
    expect(dom.childNodes.length).toBe(1);
    expect(dom.childNodes[0].data).toBe("hello");
  });
  test("renders div", () => {
    const vdom = h("div", null, []);
    const dom = render(vdom);
    expect(dom.tagName).toBe("DIV");
    expect(dom.childNodes.length).toBe(0);
  });
  test("node id is applied correctly", () => {
    const vdom = h("div", { id: "important" }, []);
    const dom = render(vdom);
    expect(dom.id).toBe("important");
    expect(dom.tagName).toBe("DIV");
  });
  test("node class name is applied correctly", () => {
    const vdom = h("div", { className: "pretty" }, []);
    const dom = render(vdom);
    expect(dom.className).toBe("pretty");
    expect(dom.tagName).toBe("DIV");
  });
  test("class prop sets DOM className", () => {
    const vdom = h("div", { class: "foo" }, []);
    const dom = render(vdom);
    expect(dom.className).toBe("foo");
  });
  test("data-* props set DOM dataset", () => {
    const vdom = h("div", { "data-foo": "bar", "data-user-id": 123 }, []);
    const dom = render(vdom);
    expect(dom.dataset.foo).toBe("bar");
    expect(dom.dataset.userId).toBe("123");
  });
  test("aria-* props set DOM attributes", () => {
    const vdom = h("button", { "aria-label": "Close", "aria-pressed": false }, []);
    const dom = render(vdom);
    expect(dom.getAttribute("aria-label")).toBe("Close");
    expect(dom.getAttribute("aria-pressed")).toBe("false");
  });
  test("children are added", () => {
    const vdom = h("div", null, [
      h("div", null, ["just testing", "multiple", h("b", null, "nodes")]),
      "hello",
      h("span", null, "test"),
    ]);
    const dom = render(vdom);
    expect(dom.childNodes.length).toBe(3);
    const nodes = dom.childNodes;
    expect(nodes[0].tagName).toBe("DIV");
    expect(nodes[1].data).toBe("hello");
    expect(nodes[2].tagName).toBe("SPAN");
    const subNodes0 = nodes[0].childNodes;
    expect(subNodes0.length).toBe(3);
    expect(subNodes0[0].data).toBe("just testing");
    expect(subNodes0[1].data).toBe("multiple");
    expect(subNodes0[2].tagName).toBe("B");
  });
  test("null children are ignored", () => {
    const vdom = h("div", { id: "important", className: "pretty" }, [null]);
    const dom = render(vdom);
    expect(dom.id).toBe("important");
    expect(dom.className).toBe("pretty");
    expect(dom.childNodes.length).toBe(0);
  });
});
