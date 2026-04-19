import { beforeEach, describe, expect, test } from "bun:test";
import {
  h,
  unmount,
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

describe("namespace support", () => {
  test("create element respects namespace", () => {
    const svgURI = "http://www.w3.org/2000/svg";
    const vnode = new VNode("svg", {}, [], null, svgURI);
    const node = render(vnode);
    expect(node.tagName).toBe("svg");
    expect(node.namespaceURI).toBe(svgURI);
  });
  test("different namespaces produces a new element on re-render", () => {
    const leftNode = new VNode("div", {}, [], null, "testing");
    const rightNode = new VNode("div", {}, [], null, "undefined");
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    expect(rootNode.tagName).toBe("div");
    expect(rootNode.namespaceURI).toBe("testing");
    vdomRender(rightNode, container, { document });
    const newRootNode = container.childNodes[0];
    expect(newRootNode.tagName).toBe("div");
    expect(newRootNode.namespaceURI).toBe("undefined");
  });
});
describe("SVG support", () => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  test("creates SVG element with correct namespace", () => {
    const vnode = new VNode("svg", {}, [], null, SVG_NS);
    const node = render(vnode);
    expect(node.tagName).toBe("svg");
    expect(node.namespaceURI).toBe(SVG_NS);
  });
  test("creates nested SVG elements", () => {
    const rect = new VNode("rect", {}, [], null, SVG_NS);
    const circle = new VNode("circle", {}, [], null, SVG_NS);
    const svg = new VNode("svg", {}, [rect, circle], null, SVG_NS);
    const node = render(svg);
    expect(node.tagName).toBe("svg");
    expect(node.namespaceURI).toBe(SVG_NS);
    expect(node.childNodes.length).toBe(2);
    expect(node.childNodes[0].tagName).toBe("rect");
    expect(node.childNodes[0].namespaceURI).toBe(SVG_NS);
    expect(node.childNodes[1].tagName).toBe("circle");
    expect(node.childNodes[1].namespaceURI).toBe(SVG_NS);
  });
  test("replaces HTML element with SVG element", () => {
    const htmlNode = h("div", null, "hello");
    const svgNode = new VNode("svg", {}, [], null, SVG_NS);
    const container = document.createElement("div");
    vdomRender(htmlNode, container, { document });
    const rootNode = container.childNodes[0];
    expect(rootNode.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    vdomRender(svgNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot.tagName).toBe("svg");
    expect(newRoot.namespaceURI).toBe(SVG_NS);
  });
  test("replaces SVG element with HTML element", () => {
    const svgNode = new VNode("svg", {}, [], null, SVG_NS);
    const htmlNode = h("div", null, "hello");
    const container = document.createElement("div");
    vdomRender(svgNode, container, { document });
    const rootNode = container.childNodes[0];
    expect(rootNode.namespaceURI).toBe(SVG_NS);
    vdomRender(htmlNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot.tagName).toBe("DIV");
    expect(newRoot.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
  });
  test("updates SVG children correctly", () => {
    const leftSvg = new VNode(
      "svg",
      {},
      [new VNode("rect", { key: "r1" }, [], null, SVG_NS)],
      null,
      SVG_NS,
    );
    const rightSvg = new VNode(
      "svg",
      {},
      [
        new VNode("rect", { key: "r1" }, [], null, SVG_NS),
        new VNode("circle", { key: "c1" }, [], null, SVG_NS),
      ],
      null,
      SVG_NS,
    );
    const container = document.createElement("div");
    vdomRender(leftSvg, container, { document });
    const rootNode = container.childNodes[0];
    expect(rootNode.childNodes.length).toBe(1);
    vdomRender(rightSvg, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot.childNodes.length).toBe(2);
    expect(newRoot.childNodes[0].tagName).toBe("rect");
    expect(newRoot.childNodes[1].tagName).toBe("circle");
    expect(newRoot.childNodes[1].namespaceURI).toBe(SVG_NS);
  });
});
describe("aria-* and data-* attributes", () => {
  test("data-* attributes are accessible via dataset", () => {
    const vnode = h(
      "div",
      {
        "data-foo": "bar",
        "data-user-id": 123,
        "data-is-active": true,
      },
      [],
    );
    const node = render(vnode);
    expect(node.dataset.foo).toBe("bar");
    expect(node.dataset.userId).toBe("123");
    expect(node.dataset.isActive).toBe("true");
  });
  test("aria-* attributes are set correctly", () => {
    const vnode = h("button", { "aria-disabled": true, "aria-pressed": false }, []);
    const node = render(vnode);
    expect(node.getAttribute("aria-disabled")).toBe("true");
    expect(node.getAttribute("aria-pressed")).toBe("false");
  });
  test("data-* can be added via re-render", () => {
    const leftTree = h("div", null, []);
    const rightTree = h("div", { "data-id": 123 }, []);
    const container = document.createElement("div");
    vdomRender(leftTree, container, { document });
    expect(container.childNodes[0].dataset.id).toBeUndefined();
    vdomRender(rightTree, container, { document });
    expect(container.childNodes[0].dataset.id).toBe("123");
  });
  test("data-* can be removed via re-render", () => {
    const leftTree = h("div", { "data-id": 123 }, []);
    const rightTree = h("div", null, []);
    const container = document.createElement("div");
    vdomRender(leftTree, container, { document });
    expect(container.childNodes[0].dataset.id).toBe("123");
    vdomRender(rightTree, container, { document });
    expect(container.childNodes[0].dataset.id).toBeUndefined();
  });
  test("aria-* can be toggled via re-render", () => {
    const expanded = h("button", { "aria-expanded": true }, []);
    const collapsed = h("button", { "aria-expanded": false }, []);
    const container = document.createElement("div");
    vdomRender(expanded, container, { document });
    let rootNode = container.childNodes[0];
    expect(rootNode.getAttribute("aria-expanded")).toBe("true");
    vdomRender(collapsed, container, { document });
    rootNode = container.childNodes[0];
    expect(rootNode.getAttribute("aria-expanded")).toBe("false");
    vdomRender(expanded, container, { document });
    rootNode = container.childNodes[0];
    expect(rootNode.getAttribute("aria-expanded")).toBe("true");
  });
});
describe("render", () => {
  test("renders vnode into container", () => {
    const container = document.createElement("div");
    const vnode = h("span", null, "hello");
    const result = vdomRender(vnode, container, { document });
    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].tagName).toBe("SPAN");
    expect(result).toBe(container.childNodes[0]);
  });
  test("clears container before rendering", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>old content</p><p>more old</p>";
    expect(container.childNodes.length).toBe(2);
    const vnode = h("span", null, "new content");
    vdomRender(vnode, container, { document });
    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].tagName).toBe("SPAN");
  });
  test("renders nested tree", () => {
    const container = document.createElement("div");
    const vnode = h("div", null, [
      h("ul", null, [h("li", null, "one"), h("li", null, "two")]),
      h("p", null, "text"),
    ]);
    vdomRender(vnode, container, { document });
    expect(container.childNodes.length).toBe(1);
    const root = container.childNodes[0];
    expect(root.tagName).toBe("DIV");
    expect(root.childNodes.length).toBe(2);
    expect(root.childNodes[0].tagName).toBe("UL");
    expect(root.childNodes[1].tagName).toBe("P");
  });
  test("renders VText", () => {
    const container = document.createElement("div");
    const vtext = new VText("hello world");
    vdomRender(vtext, container, { document });
    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].nodeType).toBe(3);
    expect(container.childNodes[0].data).toBe("hello world");
  });
  test("renders VComment", () => {
    const container = document.createElement("div");
    const vcomment = new VComment("my comment");
    vdomRender(vcomment, container, { document });
    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].nodeType).toBe(8);
    expect(container.childNodes[0].data).toBe("my comment");
  });
  test("renders VFragment children directly into container", () => {
    const container = document.createElement("div");
    const fragment = new VFragment([new VText("one"), h("span", null, "two"), new VText("three")]);
    vdomRender(fragment, container, { document });
    // DocumentFragment's children are appended directly to container
    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[0].data).toBe("one");
    expect(container.childNodes[1].tagName).toBe("SPAN");
    expect(container.childNodes[2].data).toBe("three");
  });
  describe("re-render", () => {
    test("re-renders with text change", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, "hello"), container, { document });
      const result = vdomRender(h("div", null, "goodbye"), container, { document });
      expect(container.childNodes.length).toBe(1);
      const root = container.childNodes[0];
      expect(root.tagName).toBe("DIV");
      expect(root.childNodes.length).toBe(1);
      expect(root.childNodes[0].data).toBe("goodbye");
      expect(result).toBe(root);
    });
    test("re-renders with child additions", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, [h("span", null, "one")]), container, { document });
      vdomRender(h("div", null, [h("span", null, "one"), h("span", null, "two")]), container, {
        document,
      });
      const root = container.childNodes[0];
      expect(root.childNodes.length).toBe(2);
      expect(root.childNodes[1].tagName).toBe("SPAN");
    });
    test("re-renders with child removals", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, [h("span", null, "one"), h("span", null, "two")]), container, {
        document,
      });
      vdomRender(h("div", null, [h("span", null, "one")]), container, { document });
      const root = container.childNodes[0];
      expect(root.childNodes.length).toBe(1);
    });
    test("re-renders with root element replacement (div -> span)", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, "content"), container, { document });
      expect(container.childNodes[0].tagName).toBe("DIV");
      const result = vdomRender(h("span", null, "content"), container, { document });
      expect(container.childNodes.length).toBe(1);
      expect(container.childNodes[0].tagName).toBe("SPAN");
      expect(result).toBe(container.childNodes[0]);
    });
    test("re-renders with attribute changes", () => {
      const container = document.createElement("div");
      vdomRender(h("div", { className: "old" }, "text"), container, { document });
      vdomRender(h("div", { className: "new", id: "added" }, "text"), container, {
        document,
      });
      const root = container.childNodes[0];
      expect(root.className).toBe("new");
      expect(root.id).toBe("added");
    });
    test("re-renders VFragment with text change", () => {
      const container = document.createElement("div");
      vdomRender(new VFragment([new VText("a"), new VText("b")]), container, {
        document,
      });
      expect(container.childNodes.length).toBe(2);
      vdomRender(new VFragment([new VText("c"), new VText("d")]), container, {
        document,
      });
      expect(container.childNodes.length).toBe(2);
      expect(container.childNodes[0].data).toBe("c");
      expect(container.childNodes[1].data).toBe("d");
    });
    test("re-renders VFragment with child addition", () => {
      const container = document.createElement("div");
      vdomRender(new VFragment([new VText("a")]), container, { document });
      expect(container.childNodes.length).toBe(1);
      vdomRender(new VFragment([new VText("a"), new VText("b")]), container, {
        document,
      });
      expect(container.childNodes.length).toBe(2);
      expect(container.childNodes[0].data).toBe("a");
      expect(container.childNodes[1].data).toBe("b");
    });
    test("re-renders VFragment with child removal", () => {
      const container = document.createElement("div");
      vdomRender(new VFragment([new VText("a"), new VText("b")]), container, {
        document,
      });
      expect(container.childNodes.length).toBe(2);
      vdomRender(new VFragment([new VText("a")]), container, { document });
      expect(container.childNodes.length).toBe(1);
      expect(container.childNodes[0].data).toBe("a");
    });
    test("re-renders VFragment to VNode transition", () => {
      const container = document.createElement("div");
      vdomRender(new VFragment([new VText("a"), new VText("b")]), container, {
        document,
      });
      expect(container.childNodes.length).toBe(2);
      vdomRender(h("div", null, "content"), container, { document });
      expect(container.childNodes.length).toBe(1);
      expect(container.childNodes[0].tagName).toBe("DIV");
    });
    test("re-renders VNode to VFragment transition", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, "content"), container, { document });
      expect(container.childNodes.length).toBe(1);
      vdomRender(new VFragment([new VText("a"), new VText("b")]), container, {
        document,
      });
      expect(container.childNodes.length).toBe(2);
      expect(container.childNodes[0].data).toBe("a");
      expect(container.childNodes[1].data).toBe("b");
    });
    test("handles multiple VFragment re-renders", () => {
      const container = document.createElement("div");
      vdomRender(new VFragment([new VText("a")]), container, { document });
      expect(container.childNodes.length).toBe(1);
      vdomRender(new VFragment([new VText("b"), new VText("c")]), container, {
        document,
      });
      expect(container.childNodes.length).toBe(2);
      vdomRender(new VFragment([new VText("d"), new VText("e"), new VText("f")]), container, {
        document,
      });
      expect(container.childNodes.length).toBe(3);
      expect(container.childNodes[0].data).toBe("d");
      expect(container.childNodes[1].data).toBe("e");
      expect(container.childNodes[2].data).toBe("f");
    });
    test("re-renders VFragment root with nested VFragment children", () => {
      const container = document.createElement("div");
      // Simulates component pattern: comment marker + VFragment child
      vdomRender(
        new VFragment([
          new VComment("comp-root"),
          new VFragment([new VComment("comp-child"), h("section", null, "v1")]),
        ]),
        container,
        { document },
      );
      expect(container.childNodes.length).toBe(3);
      expect(container.childNodes[0].nodeType).toBe(8); // comment
      expect(container.childNodes[1].nodeType).toBe(8); // comment
      expect(container.childNodes[2].tagName).toBe("SECTION");
      // Re-render with changed content — this was the failing scenario
      vdomRender(
        new VFragment([
          new VComment("comp-root"),
          new VFragment([
            new VComment("comp-child"),
            h("section", null, "v2"),
            h("div", null, "added"),
          ]),
        ]),
        container,
        { document },
      );
      expect(container.childNodes.length).toBe(4);
      expect(container.childNodes[2].textContent).toBe("v2");
      expect(container.childNodes[3].tagName).toBe("DIV");
      expect(container.childNodes[3].textContent).toBe("added");
    });
    test("subsequent re-renders after root replacement work correctly", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, "first"), container, { document });
      vdomRender(h("span", null, "second"), container, { document });
      const result = vdomRender(h("span", null, "third"), container, { document });
      expect(container.childNodes.length).toBe(1);
      const root = container.childNodes[0];
      expect(root.tagName).toBe("SPAN");
      expect(root.childNodes[0].data).toBe("third");
      expect(result).toBe(root);
    });
  });
  describe("dangerouslySetInnerHTML", () => {
    test("sets innerHTML from __html property", () => {
      const container = document.createElement("div");
      const vnode = h("div", { dangerouslySetInnerHTML: { __html: "<b>bold</b>" } });
      vdomRender(vnode, container, { document });
      const root = container.childNodes[0];
      expect(root.innerHTML).toBe("<b>bold</b>");
    });
    test("updates innerHTML on re-render", () => {
      const container = document.createElement("div");
      vdomRender(h("div", { dangerouslySetInnerHTML: { __html: "<em>first</em>" } }), container, {
        document,
      });
      vdomRender(
        h("div", { dangerouslySetInnerHTML: { __html: "<strong>second</strong>" } }),
        container,
        { document },
      );
      expect(container.childNodes[0].innerHTML).toBe("<strong>second</strong>");
    });
    test("clears innerHTML when attribute is removed", () => {
      const container = document.createElement("div");
      vdomRender(h("div", { dangerouslySetInnerHTML: { __html: "<p>content</p>" } }), container, {
        document,
      });
      vdomRender(h("div", null), container, { document });
      expect(container.childNodes[0].innerHTML).toBe("");
    });
    test("handles null __html as empty string", () => {
      const container = document.createElement("div");
      const vnode = h("div", { dangerouslySetInnerHTML: { __html: null } });
      vdomRender(vnode, container, { document });
      expect(container.childNodes[0].innerHTML).toBe("");
    });
    test("switches from children to dangerouslySetInnerHTML", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, [h("span", null, "child")]), container, { document });
      vdomRender(h("div", { dangerouslySetInnerHTML: { __html: "<b>raw</b>" } }), container, {
        document,
      });
      expect(container.childNodes[0].innerHTML).toBe("<b>raw</b>");
    });
    test("switches from dangerouslySetInnerHTML to children", () => {
      const container = document.createElement("div");
      vdomRender(h("div", { dangerouslySetInnerHTML: { __html: "<b>raw</b>" } }), container, {
        document,
      });
      vdomRender(h("div", null, [h("span", null, "child")]), container, { document });
      const root = container.childNodes[0];
      expect(root.childNodes.length).toBe(1);
      expect(root.childNodes[0].tagName).toBe("SPAN");
    });
  });
  describe("unmount", () => {
    test("clears container and cache", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, "hello"), container, { document });
      expect(container.childNodes.length).toBe(1);
      unmount(container);
      expect(container.childNodes.length).toBe(0);
    });
    test("render after unmount does fresh render", () => {
      const container = document.createElement("div");
      vdomRender(h("div", null, "first"), container, { document });
      unmount(container);
      const result = vdomRender(h("span", null, "fresh"), container, { document });
      expect(container.childNodes.length).toBe(1);
      expect(container.childNodes[0].tagName).toBe("SPAN");
      expect(result).toBe(container.childNodes[0]);
    });
  });
});
