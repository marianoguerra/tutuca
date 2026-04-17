import { beforeEach, describe, expect, test } from "bun:test";
import { h, VComment, VNode, VText, render as vdomRender } from "../src/vdom.js";
import { assertEqualDom, childNodesArray, setupJsdom } from "./dom.js";

let document;
beforeEach(() => {
  document = setupJsdom();
});

function render(vnode) {
  return vnode.toDom({ document });
}

function assertPatchProduces(oldVNode, newVNode) {
  const c1 = document.createElement("div");
  const c2 = document.createElement("div");
  vdomRender(oldVNode, c1, { document });
  vdomRender(newVNode, c1, { document });
  vdomRender(newVNode, c2, { document });
  expect(assertEqualDom(c1.childNodes[0], c2.childNodes[0])).toBe(true);
}

function nodesFromArray(array) {
  const children = [];
  for (let i = 0; i < array.length; i++) {
    const key = array[i];
    let properties;
    if (key != null) {
      properties = { key: key, id: String(key) };
    } else {
      properties = { id: `no-key-${i}` };
    }
    children.push(h("div", properties, properties.id));
  }
  return h("div", null, children);
}

describe("diff and patch", () => {
  test("textnode update test", () => {
    assertPatchProduces(h("div", null, "hello"), h("div", null, "goodbye"));
  });
  test("textnode replace test", () => {
    assertPatchProduces(h("div", null, "hello"), h("div", null, [h("span", null, "goodbye")]));
  });
  test("textnode insert test", () => {
    assertPatchProduces(h("div", null, "hello"), h("span", null, ["hello", "again"]));
  });
  test("textnode remove", () => {
    assertPatchProduces(h("span", null, ["hello", "again"]), h("div", null, "hello"));
  });
  test("dom node update test", () => {
    assertPatchProduces(
      h("div", { className: "hello" }, "hello"),
      h("div", { className: "goodbye" }, "goodbye"),
    );
  });
  test("dom node replace test", () => {
    assertPatchProduces(h("div", null, "hello"), h("span", null, "goodbye"));
  });
  test("dom node insert", () => {
    assertPatchProduces(
      h("div", null, [h("span", null, "hello")]),
      h("div", null, [h("span", null, "hello"), h("span", null, "again")]),
    );
  });
  test("dom node remove", () => {
    assertPatchProduces(
      h("div", null, [h("span", null, "hello"), h("span", null, "again")]),
      h("div", null, [h("span", null, "hello")]),
    );
  });
  test("Allow empty textnode", () => {
    const empty = h("span", null, "");
    const rootNode = render(empty);
    expect(rootNode.childNodes.length).toBe(1);
    expect(rootNode.childNodes[0].data).toBe("");
  });
  test("Can replace vnode with vtext", () => {
    const leftNode = h("div", null, h("div", null, []));
    const rightNode = h("div", null, "text");
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    expect(rootNode.childNodes.length).toBe(1);
    expect(rootNode.childNodes[0].nodeType).toBe(1);
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot).toBe(rootNode);
    expect(newRoot.childNodes.length).toBe(1);
    expect(newRoot.childNodes[0].nodeType).toBe(3);
  });
});
describe("keyed reordering", () => {
  test("keys get reordered", () => {
    const leftNode = nodesFromArray(["1", "2", "3", "4", "test", "6", "good", "7"]);
    const rightNode = nodesFromArray(["7", "4", "3", "2", "6", "test", "good", "1"]);
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    const childNodes = childNodesArray(rootNode);
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot).toBe(rootNode);
    expect(newRoot.childNodes.length).toBe(8);
    // Check DOM reference preservation
    expect(newRoot.childNodes[7]).toBe(childNodes[0]);
    expect(newRoot.childNodes[3]).toBe(childNodes[1]);
    expect(newRoot.childNodes[2]).toBe(childNodes[2]);
    expect(newRoot.childNodes[1]).toBe(childNodes[3]);
    expect(newRoot.childNodes[5]).toBe(childNodes[4]);
    expect(newRoot.childNodes[4]).toBe(childNodes[5]);
    expect(newRoot.childNodes[6]).toBe(childNodes[6]);
    expect(newRoot.childNodes[0]).toBe(childNodes[7]);
  });
  test("mix keys without keys", () => {
    const leftNode = h("div", null, [
      h("div", { key: 1 }, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
    ]);
    const rightNode = h("div", null, [
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", null, []),
      h("div", { key: 1 }, []),
    ]);
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    const childNodes = childNodesArray(rootNode);
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot).toBe(rootNode);
    expect(newRoot.childNodes.length).toBe(8);
    expect(newRoot.childNodes[0]).toBe(childNodes[1]);
    expect(newRoot.childNodes[7]).toBe(childNodes[0]);
  });
  test("avoid unnecessary reordering", () => {
    const leftNode = h("div", null, [
      h("div", null, []),
      h("div", { key: 1 }, []),
      h("div", null, []),
    ]);
    const rightNode = h("div", null, [
      h("div", null, []),
      h("div", { key: 1 }, []),
      h("div", null, []),
    ]);
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    const childNodes = childNodesArray(rootNode);
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot).toBe(rootNode);
    expect(newRoot.childNodes[0]).toBe(childNodes[0]);
    expect(newRoot.childNodes[1]).toBe(childNodes[1]);
    expect(newRoot.childNodes[2]).toBe(childNodes[2]);
  });
  test("delete key at the start", () => {
    const leftNode = h("div", null, [
      h("div", { key: "a" }, "a"),
      h("div", { key: "b" }, "b"),
      h("div", { key: "c" }, "c"),
    ]);
    const rightNode = h("div", null, [h("div", { key: "b" }, "b"), h("div", { key: "c" }, "c")]);
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    const childNodes = childNodesArray(rootNode);
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot).toBe(rootNode);
    expect(newRoot.childNodes.length).toBe(2);
    expect(newRoot.childNodes[0]).toBe(childNodes[1]);
    expect(newRoot.childNodes[1]).toBe(childNodes[2]);
  });
  test("add key to start", () => {
    const leftNode = h("div", null, [h("div", { key: "b" }, "b"), h("div", { key: "c" }, "c")]);
    const rightNode = h("div", null, [
      h("div", { key: "a" }, "a"),
      h("div", { key: "b" }, "b"),
      h("div", { key: "c" }, "c"),
    ]);
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    const childNodes = childNodesArray(rootNode);
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot).toBe(rootNode);
    expect(newRoot.childNodes.length).toBe(3);
    expect(newRoot.childNodes[1]).toBe(childNodes[0]);
    expect(newRoot.childNodes[2]).toBe(childNodes[1]);
  });
  test("delete key at the end", () => {
    const leftNode = h("div", null, [
      h("div", { key: "a" }, "a"),
      h("div", { key: "b" }, "b"),
      h("div", { key: "c" }, "c"),
    ]);
    const rightNode = h("div", null, [h("div", { key: "a" }, "a"), h("div", { key: "b" }, "b")]);
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    const childNodes = childNodesArray(rootNode);
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot).toBe(rootNode);
    expect(newRoot.childNodes.length).toBe(2);
    expect(newRoot.childNodes[0]).toBe(childNodes[0]);
    expect(newRoot.childNodes[1]).toBe(childNodes[1]);
  });
  test("add key to end", () => {
    const leftNode = h("div", null, [h("div", { key: "a" }, "a"), h("div", { key: "b" }, "b")]);
    const rightNode = h("div", null, [
      h("div", { key: "a" }, "a"),
      h("div", { key: "b" }, "b"),
      h("div", { key: "c" }, "c"),
    ]);
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    const childNodes = childNodesArray(rootNode);
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(newRoot).toBe(rootNode);
    expect(newRoot.childNodes.length).toBe(3);
    expect(newRoot.childNodes[0]).toBe(childNodes[0]);
    expect(newRoot.childNodes[1]).toBe(childNodes[1]);
  });
});
describe("style patching", () => {
  test("style patches correctly", () => {
    const leftNode = h(
      "div",
      {
        style: "border: 1px solid #000",
      },
      [],
    );
    const rightNode = h(
      "div",
      {
        style: "padding: 5px",
      },
      [],
    );
    const container = document.createElement("div");
    vdomRender(leftNode, container, { document });
    const rootNode = container.childNodes[0];
    vdomRender(rightNode, container, { document });
    const newRoot = container.childNodes[0];
    expect(rootNode).toBe(newRoot);
    expect(newRoot.style.padding).toBe("5px");
    expect(newRoot.style.border).toBe("");
  });
});
describe("duplicate key behavior", () => {
  test("duplicate keys produce correct DOM (last key wins in map)", () => {
    const leftTree = h("div", null, [
      h("div", { key: "a" }, "first"),
      h("div", { key: "b" }, "second"),
    ]);
    const rightTree = h("div", null, [
      h("div", { key: "a" }, "first"),
      h("div", { key: "a" }, "duplicate"), // duplicate key
    ]);
    assertPatchProduces(leftTree, rightTree);
  });
  test("new keyed node during reorder produces correct DOM", () => {
    const leftTree = h("div", null, [h("div", { key: "a" }, "A"), h("div", { key: "b" }, "B")]);
    const rightTree = h("div", null, [
      h("div", { key: "b" }, "B"),
      h("div", { key: "a" }, "A"),
      h("div", { key: "c" }, "C"),
    ]);
    assertPatchProduces(leftTree, rightTree);
  });
  test("adding keyed node without reorder produces correct DOM", () => {
    const leftTree = h("div", null, [h("div", { key: "a" }, "A"), h("div", { key: "b" }, "B")]);
    const rightTree = h("div", null, [
      h("div", { key: "a" }, "A"),
      h("div", { key: "b" }, "B"),
      h("div", { key: "c" }, "C"),
    ]);
    assertPatchProduces(leftTree, rightTree);
  });
  test("adding non-keyed node during reorder produces correct DOM", () => {
    const leftTree = h("div", null, [h("div", { key: "a" }, "A"), h("div", { key: "b" }, "B")]);
    const rightTree = h("div", null, [
      h("div", { key: "b" }, "B"),
      h("div", { key: "a" }, "A"),
      h("div", null, "no key"),
    ]);
    assertPatchProduces(leftTree, rightTree);
  });
});
describe("algorithm corner cases", () => {
  // =========================================================================
  // Keyed Reconciliation
  // =========================================================================
  describe("keyed reconciliation", () => {
    test("delete key in the middle", () => {
      const leftNode = h("div", null, [
        h("div", { key: "a" }, "a"),
        h("div", { key: "b" }, "b"),
        h("div", { key: "c" }, "c"),
      ]);
      const rightNode = h("div", null, [h("div", { key: "a" }, "a"), h("div", { key: "c" }, "c")]);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      const rootNode = container.childNodes[0];
      const childNodes = childNodesArray(rootNode);
      vdomRender(rightNode, container, { document });
      const newRoot = container.childNodes[0];
      expect(newRoot).toBe(rootNode);
      expect(newRoot.childNodes.length).toBe(2);
      expect(newRoot.childNodes[0]).toBe(childNodes[0]); // a preserved
      expect(newRoot.childNodes[1]).toBe(childNodes[2]); // c preserved, b removed
    });
    test("complete key replacement", () => {
      const leftNode = h("div", null, [
        h("div", { key: "a" }, "a"),
        h("div", { key: "b" }, "b"),
        h("div", { key: "c" }, "c"),
      ]);
      const rightNode = h("div", null, [
        h("div", { key: "d" }, "d"),
        h("div", { key: "e" }, "e"),
        h("div", { key: "f" }, "f"),
      ]);
      assertPatchProduces(leftNode, rightNode);
    });
    test("keyed reorder with simultaneous content changes", () => {
      const leftNode = h("div", null, [
        h("div", { key: "a" }, "X"),
        h("div", { key: "b" }, "Y"),
        h("div", { key: "c" }, "Z"),
      ]);
      const rightNode = h("div", null, [
        h("div", { key: "c" }, "Z2"),
        h("div", { key: "a" }, "X2"),
        h("div", { key: "b" }, "Y2"),
      ]);
      assertPatchProduces(leftNode, rightNode);
    });
    test("empty to keyed children", () => {
      const leftNode = h("div", null, []);
      const rightNode = h("div", null, [h("div", { key: "a" }, "a"), h("div", { key: "b" }, "b")]);
      assertPatchProduces(leftNode, rightNode);
    });
    test("keyed children to empty", () => {
      const leftNode = h("div", null, [h("div", { key: "a" }, "a"), h("div", { key: "b" }, "b")]);
      const rightNode = h("div", null, []);
      assertPatchProduces(leftNode, rightNode);
    });
    test("one-sided duplicate keys — duplicates only in new children", () => {
      const leftNode = h("div", null, [h("div", { key: "a" }, "a"), h("div", { key: "b" }, "b")]);
      const rightNode = h("div", null, [
        h("div", { key: "a" }, "a"),
        h("div", { key: "a" }, "a-dup"),
        h("div", { key: "b" }, "b"),
      ]);
      assertPatchProduces(leftNode, rightNode);
    });
    test("one-sided duplicate keys — duplicates only in old children", () => {
      const leftNode = h("div", null, [
        h("div", { key: "a" }, "a"),
        h("div", { key: "a" }, "a-dup"),
        h("div", { key: "b" }, "b"),
      ]);
      const rightNode = h("div", null, [h("div", { key: "a" }, "a"), h("div", { key: "b" }, "b")]);
      assertPatchProduces(leftNode, rightNode);
    });
  });
  // =========================================================================
  // Type-Crossing Patches
  // =========================================================================
  describe("type-crossing patches", () => {
    test("VText to VComment swap", () => {
      const leftNode = h("div", null, [new VText("hello")]);
      const rightNode = h("div", null, [new VComment("hello")]);
      assertPatchProduces(leftNode, rightNode);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const root = container.childNodes[0];
      expect(root.childNodes[0].nodeType).toBe(8);
      expect(root.childNodes[0].data).toBe("hello");
    });
    test("VComment to VText swap", () => {
      const leftNode = h("div", null, [new VComment("hello")]);
      const rightNode = h("div", null, [new VText("hello")]);
      assertPatchProduces(leftNode, rightNode);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const root = container.childNodes[0];
      expect(root.childNodes[0].nodeType).toBe(3);
      expect(root.childNodes[0].data).toBe("hello");
    });
    test("VComment to VNode swap", () => {
      const leftNode = h("div", null, [new VComment("old")]);
      const rightNode = h("div", null, [h("span", null, "new")]);
      assertPatchProduces(leftNode, rightNode);
    });
    test("VNode to VComment swap", () => {
      const leftNode = h("div", null, [h("span", null, "old")]);
      const rightNode = h("div", null, [new VComment("new")]);
      assertPatchProduces(leftNode, rightNode);
    });
  });
  // =========================================================================
  // Index Calculation
  // =========================================================================
  describe("index calculation", () => {
    test("unkeyed children with deep VNode subtrees", () => {
      const leftNode = h("div", null, [
        h("div", null, [h("span", null, [h("b", null, "deep")])]),
        h("div", null, "leaf"),
        h("div", null, [h("p", null, "shallow")]),
      ]);
      const rightNode = h("div", null, [
        h("div", null, [h("span", null, [h("b", null, "DEEP")])]),
        h("div", null, "LEAF"),
        h("div", null, [h("p", null, "SHALLOW")]),
      ]);
      assertPatchProduces(leftNode, rightNode);
    });
    test("mixed VText/VComment/VNode children — render verification", () => {
      const leftNode = h("div", null, [
        new VText("text1"),
        h("div", null, [h("span", null, "inner")]),
        new VComment("comment1"),
        h("p", null, "leaf"),
      ]);
      const rightNode = h("div", null, [
        new VText("TEXT1"),
        h("div", null, [h("span", null, "INNER")]),
        new VComment("COMMENT1"),
        h("p", null, "LEAF"),
      ]);
      assertPatchProduces(leftNode, rightNode);
    });
  });
  // =========================================================================
  // diffProps
  // =========================================================================
  describe("diffProps corner cases", () => {
    test("partial style diff — only some style properties change", () => {
      const leftNode = h("div", { style: "color: red; font-size: 12px; margin: 10px" }, []);
      const rightNode = h("div", { style: "color: red; font-size: 16px; margin: 10px" }, []);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const newRoot = container.childNodes[0];
      expect(newRoot.style.fontSize).toBe("16px");
      expect(newRoot.style.color).toBe("red");
      expect(newRoot.style.margin).toBe("10px");
    });
    test("isEqualTo with different attr keys", () => {
      const a = h("div", { foo: "1" }, []);
      const b = h("div", { bar: "1" }, []);
      expect(a.isEqualTo(b)).toBe(false);
      // Re-render should produce different result
      assertPatchProduces(a, b);
    });
  });
  // =========================================================================
  // VComment CRUD as children
  // =========================================================================
  describe("VComment CRUD as children", () => {
    test("add VComment child", () => {
      const leftNode = h("div", null, [h("span", null, "x")]);
      const rightNode = h("div", null, [h("span", null, "x"), new VComment("new")]);
      assertPatchProduces(leftNode, rightNode);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const root = container.childNodes[0];
      expect(root.childNodes.length).toBe(2);
      expect(root.childNodes[1].nodeType).toBe(8);
      expect(root.childNodes[1].data).toBe("new");
    });
    test("edit VComment text", () => {
      const leftNode = h("div", null, [new VComment("old")]);
      const rightNode = h("div", null, [new VComment("new")]);
      assertPatchProduces(leftNode, rightNode);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const root = container.childNodes[0];
      expect(root.childNodes[0].nodeType).toBe(8);
      expect(root.childNodes[0].data).toBe("new");
    });
    test("remove VComment child", () => {
      const leftNode = h("div", null, [h("span", null, "x"), new VComment("bye")]);
      const rightNode = h("div", null, [h("span", null, "x")]);
      assertPatchProduces(leftNode, rightNode);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const root = container.childNodes[0];
      expect(root.childNodes.length).toBe(1);
      expect(root.childNodes[0].tagName).toBe("SPAN");
    });
    test("keep VComment unchanged — same DOM reference", () => {
      const leftNode = h("div", null, [new VComment("same"), h("span", null, "old")]);
      const rightNode = h("div", null, [new VComment("same"), h("span", null, "new")]);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      const root = container.childNodes[0];
      const commentRef = root.childNodes[0];
      vdomRender(rightNode, container, { document });
      const newRoot = container.childNodes[0];
      // Comment node should be the exact same DOM reference
      expect(newRoot.childNodes[0]).toBe(commentRef);
      expect(newRoot.childNodes[0].data).toBe("same");
    });
  });
  // =========================================================================
  // Key change and removal
  // =========================================================================
  describe("key change and removal", () => {
    test("change key — same tag but different key replaces element", () => {
      const leftNode = h("div", null, [h("div", { key: "a" }, "text")]);
      const rightNode = h("div", null, [h("div", { key: "b" }, "text")]);
      assertPatchProduces(leftNode, rightNode);
    });
    test("remove key — keyed to unkeyed replaces element", () => {
      const leftNode = h("div", null, [h("div", { key: "a" }, "text")]);
      const rightNode = h("div", null, [h("div", null, "text")]);
      assertPatchProduces(leftNode, rightNode);
    });
  });
  // =========================================================================
  // Style add/remove
  // =========================================================================
  describe("style add and remove", () => {
    test("add style from none", () => {
      const leftNode = h("div", {}, []);
      const rightNode = h("div", { style: "color: red" }, []);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const newRoot = container.childNodes[0];
      expect(newRoot.style.color).toBe("red");
    });
    test("remove all styles", () => {
      const leftNode = h("div", { style: "color: red; margin: 5px" }, []);
      const rightNode = h("div", {}, []);
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const newRoot = container.childNodes[0];
      expect(newRoot.style.color).toBe("");
      expect(newRoot.style.margin).toBe("");
    });
  });
  // =========================================================================
  // Multiple Patches & VComment in Lists
  // =========================================================================
  describe("multiple patches and VComment in lists", () => {
    test("props change + children reorder on same element", () => {
      const leftNode = h("div", { className: "old" }, [
        h("div", { key: "a" }, "a"),
        h("div", { key: "b" }, "b"),
        h("div", { key: "c" }, "c"),
      ]);
      const rightNode = h("div", { className: "new" }, [
        h("div", { key: "c" }, "c"),
        h("div", { key: "a" }, "a"),
        h("div", { key: "b" }, "b"),
      ]);
      assertPatchProduces(leftNode, rightNode);
      // Verify props were applied
      const container = document.createElement("div");
      vdomRender(leftNode, container, { document });
      vdomRender(rightNode, container, { document });
      const root = container.childNodes[0];
      expect(root.className).toBe("new");
    });
    test("VComment siblings mixed with keyed VNode children", () => {
      const leftNode = h("div", null, [
        new VComment("separator"),
        h("div", { key: "a" }, "a"),
        new VComment("middle"),
        h("div", { key: "b" }, "b"),
      ]);
      const rightNode = h("div", null, [
        new VComment("separator"),
        h("div", { key: "b" }, "b"),
        new VComment("middle"),
        h("div", { key: "a" }, "a"),
      ]);
      assertPatchProduces(leftNode, rightNode);
    });
  });
});
