import { beforeEach, describe, expect, it } from "bun:test";
import fc from "fast-check";
import { JSDOM } from "jsdom";
import { DuplicatedKeysWarning, h, unmount, VBase, VComment, VFragment, VNode, VText, render as vdomRender, } from "../src/vdom.js";
import { applyMutation, collectPaths, createRng, generateMutation, generateTree, } from "./vdom-genutil.js";
// Setup jsdom for DOM operations
let document;
beforeEach(() => {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    document = dom.window.document;
    globalThis.document = document;
});
// Helper to render with our document (basic toDom, for comparison purposes)
function render(vnode) {
    return vnode.toDom({ document });
}
// Helper to check DOM equality
function assertEqualDom(a, b) {
    if (a.nodeType !== b.nodeType)
        return false;
    // Text nodes
    if (a.nodeType === 3) {
        return a.data === b.data;
    }
    // Comment nodes
    if (a.nodeType === 8) {
        return a.data === b.data;
    }
    // Element nodes
    if (a.nodeType === 1) {
        const aElem = a;
        const bElem = b;
        if (aElem.tagName !== bElem.tagName)
            return false;
        if (aElem.attributes.length !== bElem.attributes.length)
            return false;
        for (let i = 0; i < aElem.attributes.length; i++) {
            const attr = aElem.attributes[i];
            if (bElem.getAttribute(attr.name) !== attr.value)
                return false;
        }
        if (aElem.childNodes.length !== bElem.childNodes.length)
            return false;
        for (let i = 0; i < aElem.childNodes.length; i++) {
            if (!assertEqualDom(aElem.childNodes[i], bElem.childNodes[i])) {
                return false;
            }
        }
    }
    return true;
}
// Helper to create nodes from array of keys
function nodesFromArray(array) {
    const children = [];
    for (let i = 0; i < array.length; i++) {
        const key = array[i];
        let properties;
        if (key != null) {
            properties = { key: key, id: String(key) };
        }
        else {
            properties = { id: `no-key-${i}` };
        }
        children.push(h("div", properties, properties.id));
    }
    return h("div", null, children);
}
// Helper to get child nodes as array
function childNodesArray(node) {
    const arr = [];
    for (let i = 0; i < node.childNodes.length; i++) {
        arr.push(node.childNodes[i]);
    }
    return arr;
}
// Helper: render old -> re-render new -> assert equals fresh render of new
function assertPatchProduces(oldVNode, newVNode) {
    const c1 = document.createElement("div");
    const c2 = document.createElement("div");
    vdomRender(oldVNode, c1, { document });
    vdomRender(newVNode, c1, { document }); // re-render with morphing
    vdomRender(newVNode, c2, { document }); // fresh render
    // Compare the child content
    expect(assertEqualDom(c1.childNodes[0], c2.childNodes[0])).toBe(true);
}
describe("VirtualNode", () => {
    it("VNode is a class", () => {
        expect(typeof VNode).toBe("function");
    });
    it("VText is a class", () => {
        expect(typeof VText).toBe("function");
    });
    it("VNode has correct nodeType", () => {
        const node = new VNode("DIV", {}, []);
        expect(node.nodeType).toBe(1);
    });
    it("VText has correct nodeType", () => {
        const node = new VText("hello");
        expect(node.nodeType).toBe(3);
    });
});
describe("isEqualTo", () => {
    describe("VText", () => {
        it("equal text nodes are equal", () => {
            const a = new VText("hello");
            const b = new VText("hello");
            expect(a.isEqualTo(b)).toBe(true);
            expect(b.isEqualTo(a)).toBe(true);
        });
        it("different text nodes are not equal", () => {
            const a = new VText("hello");
            const b = new VText("world");
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("VText is not equal to VComment", () => {
            const a = new VText("hello");
            const b = new VComment("hello");
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("VText is not equal to null/undefined", () => {
            const a = new VText("hello");
            expect(a.isEqualTo(null)).toBe(false);
            expect(a.isEqualTo(undefined)).toBe(false);
        });
    });
    describe("VComment", () => {
        it("equal comments are equal", () => {
            const a = new VComment("comment");
            const b = new VComment("comment");
            expect(a.isEqualTo(b)).toBe(true);
        });
        it("different comments are not equal", () => {
            const a = new VComment("one");
            const b = new VComment("two");
            expect(a.isEqualTo(b)).toBe(false);
        });
    });
    describe("VFragment", () => {
        it("empty fragments are equal", () => {
            const a = new VFragment([]);
            const b = new VFragment([]);
            expect(a.isEqualTo(b)).toBe(true);
        });
        it("fragments with equal children are equal", () => {
            const a = new VFragment([new VText("hello"), new VText("world")]);
            const b = new VFragment([new VText("hello"), new VText("world")]);
            expect(a.isEqualTo(b)).toBe(true);
        });
        it("fragments with different children are not equal", () => {
            const a = new VFragment([new VText("hello")]);
            const b = new VFragment([new VText("world")]);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("fragments with different child count are not equal", () => {
            const a = new VFragment([new VText("hello")]);
            const b = new VFragment([new VText("hello"), new VText("world")]);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("flattens nested VFragment children", () => {
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
        it("flattens VFragment children via h()", () => {
            const frag = new VFragment([new VText("a"), new VText("b")]);
            const node = h("div", null, [new VText("x"), frag, new VText("y")]);
            expect(node.childs.length).toBe(4);
            expect(node.childs[0].text).toBe("x");
            expect(node.childs[1].text).toBe("a");
            expect(node.childs[2].text).toBe("b");
            expect(node.childs[3].text).toBe("y");
        });
        it("equal simple nodes are equal", () => {
            const a = h("div", null, []);
            const b = h("div", null, []);
            expect(a.isEqualTo(b)).toBe(true);
        });
        it("different tags are not equal", () => {
            const a = h("div", null, []);
            const b = h("span", null, []);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("same tag with same attrs are equal", () => {
            const a = h("div", { className: "foo", id: "bar" }, []);
            const b = h("div", { className: "foo", id: "bar" }, []);
            expect(a.isEqualTo(b)).toBe(true);
        });
        it("same tag with different attrs are not equal", () => {
            const a = h("div", { className: "foo" }, []);
            const b = h("div", { className: "bar" }, []);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("same tag with different attr count are not equal", () => {
            const a = h("div", { className: "foo" }, []);
            const b = h("div", { className: "foo", id: "bar" }, []);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("nodes with same children are equal", () => {
            const a = h("div", null, [h("span", null, "hello"), h("span", null, "world")]);
            const b = h("div", null, [h("span", null, "hello"), h("span", null, "world")]);
            expect(a.isEqualTo(b)).toBe(true);
        });
        it("nodes with different children are not equal", () => {
            const a = h("div", null, [h("span", null, "hello")]);
            const b = h("div", null, [h("span", null, "world")]);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("nodes with different child count are not equal", () => {
            const a = h("div", null, [h("span", null, [])]);
            const b = h("div", null, [h("span", null, []), h("span", null, [])]);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("nodes with different keys are not equal", () => {
            const a = h("div", { key: "a" }, []);
            const b = h("div", { key: "b" }, []);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("nodes with same keys are equal", () => {
            const a = h("div", { key: "a" }, []);
            const b = h("div", { key: "a" }, []);
            expect(a.isEqualTo(b)).toBe(true);
        });
        it("nodes with different namespaces are not equal", () => {
            const svgNS = "http://www.w3.org/2000/svg";
            const a = new VNode("svg", {}, [], undefined, svgNS);
            const b = new VNode("svg", {}, [], undefined, null);
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("VNode is not equal to VText", () => {
            const a = h("div", null, []);
            const b = new VText("div");
            expect(a.isEqualTo(b)).toBe(false);
        });
        it("deeply nested equal trees are equal", () => {
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
        it("deeply nested different trees are not equal", () => {
            const a = h("div", null, [
                h("ul", null, [h("li", null, "one"), h("li", null, "two")]),
            ]);
            const b = h("div", null, [
                h("ul", null, [h("li", null, "one"), h("li", null, "THREE")]),
            ]);
            expect(a.isEqualTo(b)).toBe(false);
        });
    });
    describe("diff uses isEqualTo", () => {
        it("equal trees produce no DOM changes on re-render", () => {
            const a = h("div", null, [h("span", null, "hello"), h("span", null, "world")]);
            const b = h("div", null, [h("span", null, "hello"), h("span", null, "world")]);
            const container = document.createElement("div");
            vdomRender(a, container, { document });
            const firstChild = container.childNodes[0];
            vdomRender(b, container, { document });
            // Same DOM node should be reused
            expect(container.childNodes[0]).toBe(firstChild);
        });
        it("structurally equal but different instances preserve DOM reference", () => {
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
    it("h is a function", () => {
        expect(typeof h).toBe("function");
    });
    it("creates element with tag name", () => {
        const node = h("span", null, []);
        expect(node.tag).toBe("SPAN");
    });
    it("third argument can be child or children", () => {
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
    it("className property is applied", () => {
        const node = h("div", { className: "pretty" }, []);
        expect(node.tag).toBe("DIV");
        expect(node.attrs.className).toBe("pretty");
    });
    it("id property is applied", () => {
        const node = h("div", { id: "important" }, []);
        expect(node.tag).toBe("DIV");
        expect(node.attrs.id).toBe("important");
    });
    it("class prop is converted to className", () => {
        const node = h("div", { class: "foo" }, []);
        expect(node.attrs.className).toBe("foo");
        expect(node.attrs.class).toBeUndefined();
    });
    it("for prop is converted to htmlFor", () => {
        const node = h("label", { for: "input-id" }, []);
        expect(node.attrs.htmlFor).toBe("input-id");
        expect(node.attrs.for).toBeUndefined();
    });
    it("data-* props are kept as stringified top-level attrs", () => {
        const node = h("div", { "data-foo": "bar", "data-user-id": 123 }, []);
        expect(node.attrs["data-foo"]).toBe("bar");
        expect(node.attrs["data-user-id"]).toBe("123");
    });
    it("aria-* props are kept as stringified top-level attrs", () => {
        const node = h("div", { "aria-label": "Close", "aria-hidden": true }, []);
        expect(node.attrs["aria-label"]).toBe("Close");
        expect(node.attrs["aria-hidden"]).toBe("true");
    });
    it("data-* and aria-* with false are stringified, not removed", () => {
        const node = h("div", { "data-active": false, "aria-expanded": false }, []);
        expect(node.attrs["data-active"]).toBe("false");
        expect(node.attrs["aria-expanded"]).toBe("false");
    });
    it("creates element with empty props and empty children array", () => {
        const node = h("div", {}, []);
        expect(node).toBeInstanceOf(VNode);
        expect(node.tag).toBe("DIV");
        expect(node.childs).toEqual([]);
        expect(Object.keys(node.attrs)).toEqual([]);
    });
    it("flattens nested empty array", () => {
        const node = h("div", {}, [[]]);
        expect(node).toBeInstanceOf(VNode);
        expect(node.tag).toBe("DIV");
        expect(node.childs).toEqual([]);
    });
    it("flattens nested arrays with children", () => {
        const node = h("div", {}, [
            ["a", "b"],
            "c",
            [h("span", null, []), ["d", h("p", null, [])]],
        ]);
        expect(node).toBeInstanceOf(VNode);
        expect(node.childs.length).toBe(6);
        expect(node.childs[0].text).toBe("a");
        expect(node.childs[1].text).toBe("b");
        expect(node.childs[2].text).toBe("c");
        expect(node.childs[3].tag).toBe("SPAN");
        expect(node.childs[4].text).toBe("d");
        expect(node.childs[5].tag).toBe("P");
    });
    it("handles deeply nested arrays", () => {
        const node = h("div", {}, [[[["deep"]]]]);
        expect(node.childs.length).toBe(1);
        expect(node.childs[0].text).toBe("deep");
    });
    it("converts number 0 to VText", () => {
        const node = h("div", {}, [0]);
        expect(node.childs.length).toBe(1);
        expect(node.childs[0]).toBeInstanceOf(VText);
        expect(node.childs[0].text).toBe("0");
    });
    it("converts other numbers to VText", () => {
        const node = h("div", {}, [42, -1, 3.14]);
        expect(node.childs.length).toBe(3);
        expect(node.childs[0].text).toBe("42");
        expect(node.childs[1].text).toBe("-1");
        expect(node.childs[2].text).toBe("3.14");
    });
    it("converts booleans to VText", () => {
        const node = h("div", {}, [true, false]);
        expect(node.childs.length).toBe(2);
        expect(node.childs[0].text).toBe("true");
        expect(node.childs[1].text).toBe("false");
    });
    it("handles mixed primitive children", () => {
        const node = h("div", {}, ["text", 0, true, h("span", null, [])]);
        expect(node.childs.length).toBe(4);
        expect(node.childs[0].text).toBe("text");
        expect(node.childs[1].text).toBe("0");
        expect(node.childs[2].text).toBe("true");
        expect(node.childs[3].tag).toBe("SPAN");
    });
    it("flattens non-Array iterables like Set", () => {
        const set = new Set(["a", "b", "c"]);
        const node = h("div", {}, set);
        expect(node.childs.length).toBe(3);
        expect(node.childs[0].text).toBe("a");
        expect(node.childs[1].text).toBe("b");
        expect(node.childs[2].text).toBe("c");
    });
    it("flattens generator iterables", () => {
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
    it("flattens Map.values() iterable", () => {
        const map = new Map([
            ["k1", "first"],
            ["k2", "second"],
        ]);
        const node = h("div", {}, map.values());
        expect(node.childs.length).toBe(2);
        expect(node.childs[0].text).toBe("first");
        expect(node.childs[1].text).toBe("second");
    });
    it("treats strings as leaf values, not iterables", () => {
        const node = h("div", {}, ["hello"]);
        expect(node.childs.length).toBe(1);
        expect(node.childs[0].text).toBe("hello");
    });
});
describe("toDom", () => {
    it("renders text node", () => {
        const vdom = h("span", null, "hello");
        const dom = render(vdom);
        expect(dom.tagName).toBe("SPAN");
        expect(dom.childNodes.length).toBe(1);
        expect(dom.childNodes[0].data).toBe("hello");
    });
    it("renders div", () => {
        const vdom = h("div", null, []);
        const dom = render(vdom);
        expect(dom.tagName).toBe("DIV");
        expect(dom.childNodes.length).toBe(0);
    });
    it("node id is applied correctly", () => {
        const vdom = h("div", { id: "important" }, []);
        const dom = render(vdom);
        expect(dom.id).toBe("important");
        expect(dom.tagName).toBe("DIV");
    });
    it("node class name is applied correctly", () => {
        const vdom = h("div", { className: "pretty" }, []);
        const dom = render(vdom);
        expect(dom.className).toBe("pretty");
        expect(dom.tagName).toBe("DIV");
    });
    it("class prop sets DOM className", () => {
        const vdom = h("div", { class: "foo" }, []);
        const dom = render(vdom);
        expect(dom.className).toBe("foo");
    });
    it("data-* props set DOM dataset", () => {
        const vdom = h("div", { "data-foo": "bar", "data-user-id": 123 }, []);
        const dom = render(vdom);
        expect(dom.dataset.foo).toBe("bar");
        expect(dom.dataset.userId).toBe("123");
    });
    it("aria-* props set DOM attributes", () => {
        const vdom = h("button", { "aria-label": "Close", "aria-pressed": false }, []);
        const dom = render(vdom);
        expect(dom.getAttribute("aria-label")).toBe("Close");
        expect(dom.getAttribute("aria-pressed")).toBe("false");
    });
    it("children are added", () => {
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
    it("null children are ignored", () => {
        const vdom = h("div", { id: "important", className: "pretty" }, [
            null,
        ]);
        const dom = render(vdom);
        expect(dom.id).toBe("important");
        expect(dom.className).toBe("pretty");
        expect(dom.childNodes.length).toBe(0);
    });
});
describe("diff and patch", () => {
    it("textnode update test", () => {
        assertPatchProduces(h("div", null, "hello"), h("div", null, "goodbye"));
    });
    it("textnode replace test", () => {
        assertPatchProduces(h("div", null, "hello"), h("div", null, [h("span", null, "goodbye")]));
    });
    it("textnode insert test", () => {
        assertPatchProduces(h("div", null, "hello"), h("span", null, ["hello", "again"]));
    });
    it("textnode remove", () => {
        assertPatchProduces(h("span", null, ["hello", "again"]), h("div", null, "hello"));
    });
    it("dom node update test", () => {
        assertPatchProduces(h("div", { className: "hello" }, "hello"), h("div", { className: "goodbye" }, "goodbye"));
    });
    it("dom node replace test", () => {
        assertPatchProduces(h("div", null, "hello"), h("span", null, "goodbye"));
    });
    it("dom node insert", () => {
        assertPatchProduces(h("div", null, [h("span", null, "hello")]), h("div", null, [h("span", null, "hello"), h("span", null, "again")]));
    });
    it("dom node remove", () => {
        assertPatchProduces(h("div", null, [h("span", null, "hello"), h("span", null, "again")]), h("div", null, [h("span", null, "hello")]));
    });
    it("Allow empty textnode", () => {
        const empty = h("span", null, "");
        const rootNode = render(empty);
        expect(rootNode.childNodes.length).toBe(1);
        expect(rootNode.childNodes[0].data).toBe("");
    });
    it("Can replace vnode with vtext", () => {
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
    it("keys get reordered", () => {
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
    it("mix keys without keys", () => {
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
    it("avoid unnecessary reordering", () => {
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
    it("delete key at the start", () => {
        const leftNode = h("div", null, [
            h("div", { key: "a" }, "a"),
            h("div", { key: "b" }, "b"),
            h("div", { key: "c" }, "c"),
        ]);
        const rightNode = h("div", null, [
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
        expect(newRoot.childNodes.length).toBe(2);
        expect(newRoot.childNodes[0]).toBe(childNodes[1]);
        expect(newRoot.childNodes[1]).toBe(childNodes[2]);
    });
    it("add key to start", () => {
        const leftNode = h("div", null, [
            h("div", { key: "b" }, "b"),
            h("div", { key: "c" }, "c"),
        ]);
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
    it("delete key at the end", () => {
        const leftNode = h("div", null, [
            h("div", { key: "a" }, "a"),
            h("div", { key: "b" }, "b"),
            h("div", { key: "c" }, "c"),
        ]);
        const rightNode = h("div", null, [
            h("div", { key: "a" }, "a"),
            h("div", { key: "b" }, "b"),
        ]);
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
    it("add key to end", () => {
        const leftNode = h("div", null, [
            h("div", { key: "a" }, "a"),
            h("div", { key: "b" }, "b"),
        ]);
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
    it("style patches correctly", () => {
        const leftNode = h("div", {
            style: "border: 1px solid #000",
        }, []);
        const rightNode = h("div", {
            style: "padding: 5px",
        }, []);
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
describe("property-based tests", () => {
    // Arbitrary for generating valid tag names
    const tagNameArb = fc.constantFrom("div", "span", "p", "section", "article");
    // Arbitrary for generating simple text content
    const textArb = fc.string({ minLength: 0, maxLength: 20 });
    it("render then re-render produces equivalent DOM", () => {
        fc.assert(fc.property(tagNameArb, textArb, textArb, (tag, text1, text2) => {
            const vdom1 = h(tag, null, text1);
            const vdom2 = h(tag, null, text2);
            const c1 = document.createElement("div");
            const c2 = document.createElement("div");
            vdomRender(vdom1, c1, { document });
            vdomRender(vdom2, c1, { document });
            vdomRender(vdom2, c2, { document });
            return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        }), { numRuns: 100 });
    });
    it("identical trees preserve DOM reference", () => {
        fc.assert(fc.property(tagNameArb, textArb, (tag, text) => {
            const vdom1 = h(tag, null, text);
            const vdom2 = h(tag, null, text);
            const container = document.createElement("div");
            vdomRender(vdom1, container, { document });
            const ref = container.childNodes[0];
            vdomRender(vdom2, container, { document });
            return container.childNodes[0] === ref;
        }), { numRuns: 100 });
    });
    it("keyed children maintain identity after reorder", () => {
        fc.assert(fc.property(fc.array(fc.string({ minLength: 1, maxLength: 5 }), {
            minLength: 2,
            maxLength: 8,
        }), (keys) => {
            // Ensure unique keys
            const uniqueKeys = [...new Set(keys)];
            if (uniqueKeys.length < 2)
                return true;
            const leftNode = h("div", null, uniqueKeys.map((k) => h("div", { key: k, id: k }, k)));
            // Shuffle keys
            const shuffledKeys = [...uniqueKeys].sort(() => Math.random() - 0.5);
            const rightNode = h("div", null, shuffledKeys.map((k) => h("div", { key: k, id: k }, k)));
            const container = document.createElement("div");
            vdomRender(leftNode, container, { document });
            vdomRender(rightNode, container, { document });
            const newRoot = container.childNodes[0];
            // Check that all children are in correct order
            for (let i = 0; i < shuffledKeys.length; i++) {
                const child = newRoot.childNodes[i];
                if (child.id !== shuffledKeys[i])
                    return false;
            }
            return true;
        }), { numRuns: 50 });
    });
    it("adding and removing children works correctly", () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }), (count1, count2) => {
            const children1 = Array.from({ length: count1 }, (_, i) => h("span", { key: `k${i}` }, `child${i}`));
            const children2 = Array.from({ length: count2 }, (_, i) => h("span", { key: `k${i}` }, `child${i}`));
            const leftNode = h("div", null, children1);
            const rightNode = h("div", null, children2);
            const c1 = document.createElement("div");
            const c2 = document.createElement("div");
            vdomRender(leftNode, c1, { document });
            vdomRender(rightNode, c1, { document });
            vdomRender(rightNode, c2, { document });
            return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        }), { numRuns: 50 });
    });
});
describe("namespace support", () => {
    it("create element respects namespace", () => {
        const svgURI = "http://www.w3.org/2000/svg";
        const vnode = new VNode("svg", {}, [], null, svgURI);
        const node = render(vnode);
        expect(node.tagName).toBe("svg");
        expect(node.namespaceURI).toBe(svgURI);
    });
    it("different namespaces produces a new element on re-render", () => {
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
    it("creates SVG element with correct namespace", () => {
        const vnode = new VNode("svg", {}, [], null, SVG_NS);
        const node = render(vnode);
        expect(node.tagName).toBe("svg");
        expect(node.namespaceURI).toBe(SVG_NS);
    });
    it("creates nested SVG elements", () => {
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
    it("replaces HTML element with SVG element", () => {
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
    it("replaces SVG element with HTML element", () => {
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
    it("updates SVG children correctly", () => {
        const leftSvg = new VNode("svg", {}, [new VNode("rect", { key: "r1" }, [], null, SVG_NS)], null, SVG_NS);
        const rightSvg = new VNode("svg", {}, [
            new VNode("rect", { key: "r1" }, [], null, SVG_NS),
            new VNode("circle", { key: "c1" }, [], null, SVG_NS),
        ], null, SVG_NS);
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
    it("data-* attributes are accessible via dataset", () => {
        const vnode = h("div", {
            "data-foo": "bar",
            "data-user-id": 123,
            "data-is-active": true,
        }, []);
        const node = render(vnode);
        expect(node.dataset.foo).toBe("bar");
        expect(node.dataset.userId).toBe("123");
        expect(node.dataset.isActive).toBe("true");
    });
    it("aria-* attributes are set correctly", () => {
        const vnode = h("button", { "aria-disabled": true, "aria-pressed": false }, []);
        const node = render(vnode);
        expect(node.getAttribute("aria-disabled")).toBe("true");
        expect(node.getAttribute("aria-pressed")).toBe("false");
    });
    it("data-* can be added via re-render", () => {
        const leftTree = h("div", null, []);
        const rightTree = h("div", { "data-id": 123 }, []);
        const container = document.createElement("div");
        vdomRender(leftTree, container, { document });
        expect(container.childNodes[0].dataset.id).toBeUndefined();
        vdomRender(rightTree, container, { document });
        expect(container.childNodes[0].dataset.id).toBe("123");
    });
    it("data-* can be removed via re-render", () => {
        const leftTree = h("div", { "data-id": 123 }, []);
        const rightTree = h("div", null, []);
        const container = document.createElement("div");
        vdomRender(leftTree, container, { document });
        expect(container.childNodes[0].dataset.id).toBe("123");
        vdomRender(rightTree, container, { document });
        expect(container.childNodes[0].dataset.id).toBeUndefined();
    });
    it("aria-* can be toggled via re-render", () => {
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
// =============================================================================
// Duplicate Key Diagnostics (static tests)
// =============================================================================
describe("duplicate key diagnostics", () => {
    it("warns on duplicate keys", () => {
        // Two children with the same key
        const leftTree = h("div", null, [
            h("div", { key: "a" }, "first"),
            h("div", { key: "b" }, "second"),
        ]);
        const rightTree = h("div", null, [
            h("div", { key: "a" }, "first"),
            h("div", { key: "a" }, "duplicate"), // duplicate key
        ]);
        const container = document.createElement("div");
        const warnings = [];
        vdomRender(leftTree, container, { document });
        vdomRender(rightTree, container, {
            document,
            onWarning: (w) => warnings.push(w),
        });
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0]).toBeInstanceOf(DuplicatedKeysWarning);
        expect(warnings[0].type).toBe("DuplicatedKeys");
    });
    it("new keyed node during reorder produces correct DOM", () => {
        // Original: two keyed nodes
        const leftTree = h("div", null, [
            h("div", { key: "a" }, "A"),
            h("div", { key: "b" }, "B"),
        ]);
        // New: reorder existing + add new keyed node
        const rightTree = h("div", null, [
            h("div", { key: "b" }, "B"), // moved from position 1 to 0
            h("div", { key: "a" }, "A"), // moved from position 0 to 1
            h("div", { key: "c" }, "C"), // new keyed node during reorder
        ]);
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        const warnings = [];
        vdomRender(leftTree, c1, { document });
        vdomRender(rightTree, c1, {
            document,
            onWarning: (w) => warnings.push(w),
        });
        vdomRender(rightTree, c2, { document });
        // No warnings — new keyed nodes during reorder are handled correctly
        expect(warnings.length).toBe(0);
        // DOM should match a fresh render
        expect(c1.innerHTML).toBe(c2.innerHTML);
    });
    it("no warning when adding keyed node without reorder", () => {
        // Original: two keyed nodes
        const leftTree = h("div", null, [
            h("div", { key: "a" }, "A"),
            h("div", { key: "b" }, "B"),
        ]);
        // New: same order + add new keyed node (no reorder needed)
        const rightTree = h("div", null, [
            h("div", { key: "a" }, "A"),
            h("div", { key: "b" }, "B"),
            h("div", { key: "c" }, "C"), // new keyed node, but no reordering
        ]);
        const container = document.createElement("div");
        const warnings = [];
        vdomRender(leftTree, container, { document });
        vdomRender(rightTree, container, {
            document,
            onWarning: (w) => warnings.push(w),
        });
        // No warnings because there's no reordering happening
        expect(warnings.length).toBe(0);
    });
    it("no warning when adding non-keyed node during reorder", () => {
        // Original: two keyed nodes
        const leftTree = h("div", null, [
            h("div", { key: "a" }, "A"),
            h("div", { key: "b" }, "B"),
        ]);
        // New: reorder + add non-keyed node
        const rightTree = h("div", null, [
            h("div", { key: "b" }, "B"),
            h("div", { key: "a" }, "A"),
            h("div", null, "no key"), // non-keyed, should be fine
        ]);
        const container = document.createElement("div");
        const warnings = [];
        vdomRender(leftTree, container, { document });
        vdomRender(rightTree, container, {
            document,
            onWarning: (w) => warnings.push(w),
        });
        // No warnings — non-keyed nodes during reorder are fine
        expect(warnings.length).toBe(0);
    });
});
// =============================================================================
// Advanced Property-Based Tests: Random Trees + Mutations
// =============================================================================
describe("property-based: random trees and mutations", () => {
    // ---------------------------------------------------------------------------
    // Arbitraries for generating VNode trees
    // ---------------------------------------------------------------------------
    const tagArb = fc.constantFrom("div", "span", "p", "section", "ul", "li", "article");
    const textArb = fc.string({ minLength: 0, maxLength: 15 });
    const keyArb = fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
        nil: undefined,
    });
    // Generate a VText node
    const vtextArb = textArb.map((text) => new VText(text));
    // Generate a VComment node
    const vcommentArb = textArb.map((text) => new VComment(text));
    // Generate a leaf VNode (no children)
    const leafVNodeArb = fc
        .tuple(tagArb, keyArb, textArb)
        .map(([tag, key, text]) => {
        const props = key !== undefined ? { key } : null;
        return h(tag, props, text);
    });
    // Generate a VFragment child (flattened at construction time by h())
    const vfragmentChildArb = fc
        .array(fc.oneof(vtextArb, vcommentArb, leafVNodeArb), {
        minLength: 1,
        maxLength: 3,
    })
        .map((childs) => new VFragment(childs));
    // Recursive arbitrary for VNode trees (including VComment and VFragment children)
    // VFragment children are flattened at construction time by h(), so the resulting
    // trees are structurally flat — but this exercises the flattening code path.
    const vnodeTreeArb = fc.letrec((tie) => ({
        // Leaf nodes: VText, VComment, or leaf VNode
        leaf: fc.oneof(vtextArb, vcommentArb, leafVNodeArb),
        // Full tree node
        tree: fc.oneof({ depthSize: "small", withCrossShrink: true }, leafVNodeArb, fc
            .tuple(tagArb, keyArb, fc.array(fc.oneof(tie("tree"), vtextArb, vcommentArb, vfragmentChildArb), {
            minLength: 0,
            maxLength: 4,
        }))
            .map(([tag, key, children]) => {
            const props = key !== undefined ? { key } : null;
            return h(tag, props, children);
        })),
    })).tree;
    // Helper to apply mutation without requiring rng (uses Math.random for shuffle)
    function applyMutationLocal(root, mutation) {
        const rng = () => Math.random();
        return applyMutation(root, mutation, rng);
    }
    // Arbitrary for mutations given a tree
    function mutationArb(tree) {
        const paths = collectPaths(tree);
        const pathArb = fc.constantFrom(...paths);
        return fc.oneof(
        // Change text
        fc.tuple(pathArb, textArb).map(([path, newText]) => ({
            type: "changeText",
            path,
            newText,
        })), 
        // Change tag
        fc.tuple(pathArb, tagArb).map(([path, newTag]) => ({
            type: "changeTag",
            path,
            newTag,
        })), 
        // Add child
        fc
            .tuple(pathArb, fc.oneof(leafVNodeArb, vtextArb, vcommentArb), fc.nat({ max: 10 }))
            .map(([path, child, index]) => ({
            type: "addChild",
            path,
            child,
            index,
        })), 
        // Remove child
        fc.tuple(pathArb, fc.nat({ max: 10 })).map(([path, index]) => ({
            type: "removeChild",
            path,
            index,
        })), 
        // Replace child
        fc
            .tuple(pathArb, fc.nat({ max: 10 }), fc.oneof(leafVNodeArb, vtextArb, vcommentArb))
            .map(([path, index, newChild]) => ({
            type: "replaceChild",
            path,
            index,
            newChild,
        })), 
        // Shuffle children
        pathArb.map((path) => ({
            type: "shuffleChildren",
            path,
        })), 
        // Change attribute
        fc
            .tuple(pathArb, fc.constantFrom("className", "id", "title", "data-test"), fc.option(fc.string({ minLength: 1, maxLength: 10 }), {
            nil: undefined,
        }))
            .map(([path, attr, value]) => ({
            type: "changeAttr",
            path,
            attr,
            value,
        })));
    }
    // ---------------------------------------------------------------------------
    // Tests
    // ---------------------------------------------------------------------------
    it("render+re-render on random tree produces equivalent DOM", () => {
        fc.assert(fc.property(vnodeTreeArb, vnodeTreeArb, (tree1, tree2) => {
            const c1 = document.createElement("div");
            const c2 = document.createElement("div");
            vdomRender(tree1, c1, { document });
            vdomRender(tree2, c1, { document });
            vdomRender(tree2, c2, { document });
            return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        }), { numRuns: 100 });
    });
    it("single mutation: render+re-render produces correct result", () => {
        fc.assert(fc.property(vnodeTreeArb.chain((tree) => fc.tuple(fc.constant(tree), mutationArb(tree))), ([originalTree, mutation]) => {
            const mutatedTree = applyMutationLocal(originalTree, mutation);
            const c1 = document.createElement("div");
            const c2 = document.createElement("div");
            vdomRender(originalTree, c1, { document });
            vdomRender(mutatedTree, c1, { document });
            vdomRender(mutatedTree, c2, { document });
            return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        }), { numRuns: 200 });
    });
    it("multiple mutations: render+re-render produces correct result", () => {
        fc.assert(fc.property(vnodeTreeArb.chain((tree) => fc.tuple(fc.constant(tree), fc.array(mutationArb(tree), { minLength: 1, maxLength: 5 }))), ([originalTree, mutations]) => {
            // Apply all mutations sequentially
            let mutatedTree = originalTree;
            for (const mutation of mutations) {
                mutatedTree = applyMutationLocal(mutatedTree, mutation);
            }
            const c1 = document.createElement("div");
            const c2 = document.createElement("div");
            vdomRender(originalTree, c1, { document });
            vdomRender(mutatedTree, c1, { document });
            vdomRender(mutatedTree, c2, { document });
            return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        }), { numRuns: 100 });
    });
    it("incremental re-rendering: applying step by step", () => {
        fc.assert(fc.property(vnodeTreeArb.chain((tree) => fc.tuple(fc.constant(tree), fc.array(mutationArb(tree), { minLength: 2, maxLength: 4 }))), ([originalTree, mutations]) => {
            let currentTree = originalTree;
            const container = document.createElement("div");
            vdomRender(currentTree, container, { document });
            // Apply mutations one at a time
            for (const mutation of mutations) {
                const nextTree = applyMutationLocal(currentTree, mutation);
                vdomRender(nextTree, container, { document });
                const expected = document.createElement("div");
                vdomRender(nextTree, expected, { document });
                if (!assertEqualDom(container.childNodes[0], expected.childNodes[0])) {
                    return false;
                }
                currentTree = nextTree;
            }
            return true;
        }), { numRuns: 50 });
    });
    it("keyed children: random insertions and deletions", () => {
        // Generate list of unique keys
        const uniqueKeysArb = fc
            .array(fc.string({ minLength: 1, maxLength: 5 }), {
            minLength: 3,
            maxLength: 10,
        })
            .map((keys) => [...new Set(keys)])
            .filter((keys) => keys.length >= 3);
        fc.assert(fc.property(uniqueKeysArb, fc.integer({ min: 0, max: 100 }), (keys, seed) => {
            // Create initial tree with keyed children
            const initialChildren = keys.map((k) => h("div", { key: k, id: k }, k));
            const initialTree = h("div", null, initialChildren);
            // Create mutations: shuffle, remove some, add new ones
            const rng = createRng(seed);
            const shuffled = [...keys].sort(() => rng() - 0.5);
            const kept = shuffled.slice(0, Math.max(1, Math.floor(shuffled.length * 0.7)));
            const newKeys = [`new-${seed}-1`, `new-${seed}-2`];
            const finalKeys = [...kept, ...newKeys].sort(() => rng() - 0.5);
            const finalChildren = finalKeys.map((k) => h("div", { key: k, id: k }, k));
            const finalTree = h("div", null, finalChildren);
            const c1 = document.createElement("div");
            const c2 = document.createElement("div");
            vdomRender(initialTree, c1, { document });
            vdomRender(finalTree, c1, { document });
            vdomRender(finalTree, c2, { document });
            // Verify structure
            if (!assertEqualDom(c1.childNodes[0], c2.childNodes[0])) {
                return false;
            }
            // Verify key order
            const newRoot = c1.childNodes[0];
            for (let i = 0; i < finalKeys.length; i++) {
                const child = newRoot.childNodes[i];
                if (child.id !== finalKeys[i]) {
                    return false;
                }
            }
            return true;
        }), { numRuns: 100 });
    });
    it("VFragment root: render + re-render produces correct DOM", () => {
        fc.assert(fc.property(vnodeTreeArb, vnodeTreeArb, (tree1, tree2) => {
            const container1 = document.createElement("div");
            const container2 = document.createElement("div");
            // Wrap children in VFragment roots
            const frag1 = new VFragment(tree1.childs);
            const frag2 = new VFragment(tree2.childs);
            // Render then re-render
            vdomRender(frag1, container1, { document });
            vdomRender(frag2, container1, { document });
            // Fresh render for comparison
            vdomRender(frag2, container2, { document });
            return container1.innerHTML === container2.innerHTML;
        }), { numRuns: 100 });
    });
    it("VFragment root: incremental re-renders produce correct DOM", () => {
        fc.assert(fc.property(vnodeTreeArb.chain((tree) => fc.tuple(fc.constant(tree), fc.array(mutationArb(tree), { minLength: 2, maxLength: 4 }))), ([originalTree, mutations]) => {
            const container = document.createElement("div");
            let currentTree = originalTree;
            vdomRender(new VFragment(currentTree.childs), container, { document });
            for (const mutation of mutations) {
                const nextTree = applyMutationLocal(currentTree, mutation);
                vdomRender(new VFragment(nextTree.childs), container, { document });
                const expected = document.createElement("div");
                vdomRender(new VFragment(nextTree.childs), expected, { document });
                if (container.innerHTML !== expected.innerHTML)
                    return false;
                currentTree = nextTree;
            }
            return true;
        }), { numRuns: 50 });
    });
    it("stress test: deeply nested mutations", () => {
        // Generate deeper trees (including VComment)
        const deepTreeArb = fc.letrec((tie) => ({
            leaf: fc.oneof(vtextArb, vcommentArb, leafVNodeArb),
            tree: fc.oneof({ depthSize: "medium" }, leafVNodeArb, fc
                .tuple(tagArb, keyArb, fc.array(fc.oneof(tie("tree"), vtextArb, vcommentArb), { minLength: 1, maxLength: 3 }))
                .map(([tag, key, children]) => {
                const props = key !== undefined ? { key } : null;
                return h(tag, props, children);
            })),
        })).tree;
        fc.assert(fc.property(deepTreeArb, deepTreeArb, (tree1, tree2) => {
            const c1 = document.createElement("div");
            const c2 = document.createElement("div");
            vdomRender(tree1, c1, { document });
            vdomRender(tree2, c1, { document });
            vdomRender(tree2, c2, { document });
            return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        }), { numRuns: 50 });
    });
});
// =============================================================================
// Seed-based tests (reproduce playground failures)
// =============================================================================
describe("seed-based regression tests", () => {
    /**
     * Test a specific seed from the playground.
     * This reproduces the exact behavior of the playground's generate() function.
     */
    function testSeed(seed, mutationCount = 3) {
        const rng = createRng(seed);
        // Generate original tree (same as playground)
        const originalTree = generateTree(rng);
        // Generate mutations (same as playground)
        const mutations = [];
        for (let i = 0; i < mutationCount; i++) {
            mutations.push(generateMutation(rng, originalTree));
        }
        // Apply all mutations (same as playground)
        let mutatedTree = originalTree;
        const mutationRng = createRng(seed + 1000);
        for (const mutation of mutations) {
            mutatedTree = applyMutation(mutatedTree, mutation, mutationRng);
        }
        // Render original, then re-render mutated
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        const warnings = [];
        vdomRender(originalTree, c1, { document });
        vdomRender(mutatedTree, c1, {
            document,
            onWarning: (w) => warnings.push(w),
        });
        vdomRender(mutatedTree, c2, { document });
        // Compare
        const isMatch = assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        return {
            isMatch,
            originalTree,
            mutatedTree,
            mutations,
            warnings,
        };
    }
    it("seed 1591 - duplicate keys produces warning", () => {
        const result = testSeed(1591, 3);
        // This seed generates a tree with duplicate keys.
        // The warning system should detect and report this.
        expect(result.warnings.length).toBeGreaterThan(0);
        // Check that the warning is a DuplicatedKeysWarning
        const warning = result.warnings[0];
        expect(warning).toBeInstanceOf(DuplicatedKeysWarning);
        expect(warning.type).toBe("DuplicatedKeys");
        // Duplicate keys use positional fallback — DOM should still match
        expect(result.isMatch).toBe(true);
    });
    it("seed 161406 - render+re-render produces correct result or warns", () => {
        const result = testSeed(161406, 3);
        // Either the result matches, or warnings explain the mismatch
        if (!result.isMatch) {
            expect(result.warnings.length).toBeGreaterThan(0);
        }
    });
    it("seed -1033623610 - duplicate keys with removeChild mutation", () => {
        // Counterexample from property test:
        // Original tree: DIV with 3 children:
        //   - DIV with key="key" (empty)
        //   - DIV without key, with text child ""
        //   - SECTION with key="key" (duplicate!), with text child ""
        // Mutation: removeChild at path [2], index 0 (remove text from SECTION)
        const originalTree = new VNode("DIV", {}, [
            new VNode("DIV", {}, [], "key", null),
            new VNode("DIV", {}, [new VText("")], undefined, null),
            new VNode("SECTION", {}, [new VText("")], "key", null), // duplicate key
        ]);
        // After mutation: remove child at index 0 from the SECTION (path [2])
        const mutatedTree = new VNode("DIV", {}, [
            new VNode("DIV", {}, [], "key", null),
            new VNode("DIV", {}, [new VText("")], undefined, null),
            new VNode("SECTION", {}, [], "key", null), // text removed, still duplicate key
        ]);
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        const warnings = [];
        vdomRender(originalTree, c1, { document });
        vdomRender(mutatedTree, c1, {
            document,
            onWarning: (w) => warnings.push(w),
        });
        vdomRender(mutatedTree, c2, { document });
        // This has duplicate keys, so we expect a warning
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0]).toBeInstanceOf(DuplicatedKeysWarning);
        // With the fix, duplicate keys are treated as unkeyed (positional matching)
        // so patching should still produce the correct result
        expect(assertEqualDom(c1.childNodes[0], c2.childNodes[0])).toBe(true);
    });
    it("mixed unique and duplicate keys", () => {
        // Some unique keys, some duplicate keys
        const originalTree = new VNode("DIV", {}, [
            new VNode("DIV", {}, [], "unique", null),
            new VNode("DIV", {}, [], "dup", null),
            new VNode("SECTION", {}, [new VText("text")], "dup", null), // duplicate
        ]);
        const mutatedTree = new VNode("DIV", {}, [
            new VNode("DIV", {}, [], "unique", null),
            new VNode("DIV", {}, [], "dup", null),
            new VNode("SECTION", {}, [], "dup", null), // text removed
        ]);
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        const warnings = [];
        vdomRender(originalTree, c1, { document });
        vdomRender(mutatedTree, c1, {
            document,
            onWarning: (w) => warnings.push(w),
        });
        vdomRender(mutatedTree, c2, { document });
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0]).toBeInstanceOf(DuplicatedKeysWarning);
        expect(assertEqualDom(c1.childNodes[0], c2.childNodes[0])).toBe(true);
    });
    it("duplicate keys with unique key reorder", () => {
        // Unique key moves, duplicate keys should match positionally
        const originalTree = new VNode("DIV", {}, [
            new VNode("A", {}, [], "unique", null),
            new VNode("B", {}, [new VText("b1")], "dup", null),
            new VNode("C", {}, [new VText("c1")], "dup", null),
        ]);
        const mutatedTree = new VNode("DIV", {}, [
            new VNode("B", {}, [new VText("b2")], "dup", null), // text changed
            new VNode("C", {}, [new VText("c2")], "dup", null), // text changed
            new VNode("A", {}, [], "unique", null), // moved to end
        ]);
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        const warnings = [];
        vdomRender(originalTree, c1, { document });
        vdomRender(mutatedTree, c1, {
            document,
            onWarning: (w) => warnings.push(w),
        });
        vdomRender(mutatedTree, c2, { document });
        expect(warnings.length).toBeGreaterThan(0);
        expect(assertEqualDom(c1.childNodes[0], c2.childNodes[0])).toBe(true);
    });
});
// =============================================================================
// Algorithm Corner Cases
// =============================================================================
describe("algorithm corner cases", () => {
    // =========================================================================
    // Keyed Reconciliation
    // =========================================================================
    describe("keyed reconciliation", () => {
        it("delete key in the middle", () => {
            const leftNode = h("div", null, [
                h("div", { key: "a" }, "a"),
                h("div", { key: "b" }, "b"),
                h("div", { key: "c" }, "c"),
            ]);
            const rightNode = h("div", null, [
                h("div", { key: "a" }, "a"),
                h("div", { key: "c" }, "c"),
            ]);
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
        it("complete key replacement", () => {
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
        it("keyed reorder with simultaneous content changes", () => {
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
        it("empty to keyed children", () => {
            const leftNode = h("div", null, []);
            const rightNode = h("div", null, [
                h("div", { key: "a" }, "a"),
                h("div", { key: "b" }, "b"),
            ]);
            assertPatchProduces(leftNode, rightNode);
        });
        it("keyed children to empty", () => {
            const leftNode = h("div", null, [
                h("div", { key: "a" }, "a"),
                h("div", { key: "b" }, "b"),
            ]);
            const rightNode = h("div", null, []);
            assertPatchProduces(leftNode, rightNode);
        });
        it("one-sided duplicate keys — duplicates only in new children", () => {
            const leftNode = h("div", null, [
                h("div", { key: "a" }, "a"),
                h("div", { key: "b" }, "b"),
            ]);
            const rightNode = h("div", null, [
                h("div", { key: "a" }, "a"),
                h("div", { key: "a" }, "a-dup"),
                h("div", { key: "b" }, "b"),
            ]);
            const container = document.createElement("div");
            const warnings = [];
            vdomRender(leftNode, container, { document });
            vdomRender(rightNode, container, {
                document,
                onWarning: (w) => warnings.push(w),
            });
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0]).toBeInstanceOf(DuplicatedKeysWarning);
            assertPatchProduces(leftNode, rightNode);
        });
        it("one-sided duplicate keys — duplicates only in old children", () => {
            const leftNode = h("div", null, [
                h("div", { key: "a" }, "a"),
                h("div", { key: "a" }, "a-dup"),
                h("div", { key: "b" }, "b"),
            ]);
            const rightNode = h("div", null, [
                h("div", { key: "a" }, "a"),
                h("div", { key: "b" }, "b"),
            ]);
            const container = document.createElement("div");
            const warnings = [];
            vdomRender(leftNode, container, { document });
            vdomRender(rightNode, container, {
                document,
                onWarning: (w) => warnings.push(w),
            });
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0]).toBeInstanceOf(DuplicatedKeysWarning);
            assertPatchProduces(leftNode, rightNode);
        });
    });
    // =========================================================================
    // Type-Crossing Patches
    // =========================================================================
    describe("type-crossing patches", () => {
        it("VText to VComment swap", () => {
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
        it("VComment to VText swap", () => {
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
        it("VComment to VNode swap", () => {
            const leftNode = h("div", null, [new VComment("old")]);
            const rightNode = h("div", null, [h("span", null, "new")]);
            assertPatchProduces(leftNode, rightNode);
        });
        it("VNode to VComment swap", () => {
            const leftNode = h("div", null, [h("span", null, "old")]);
            const rightNode = h("div", null, [new VComment("new")]);
            assertPatchProduces(leftNode, rightNode);
        });
    });
    // =========================================================================
    // Index Calculation
    // =========================================================================
    describe("index calculation", () => {
        it("unkeyed children with deep VNode subtrees", () => {
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
        it("mixed VText/VComment/VNode children — render verification", () => {
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
        it("partial style diff — only some style properties change", () => {
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
        it("isEqualTo with same attrCount but different attr keys", () => {
            const a = h("div", { foo: "1" }, []);
            const b = h("div", { bar: "1" }, []);
            expect(a.attrCount).toBe(b.attrCount);
            expect(a.isEqualTo(b)).toBe(false);
            // Re-render should produce different result
            assertPatchProduces(a, b);
        });
    });
    // =========================================================================
    // VComment CRUD as children
    // =========================================================================
    describe("VComment CRUD as children", () => {
        it("add VComment child", () => {
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
        it("edit VComment text", () => {
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
        it("remove VComment child", () => {
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
        it("keep VComment unchanged — same DOM reference", () => {
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
        it("change key — same tag but different key replaces element", () => {
            const leftNode = h("div", null, [h("div", { key: "a" }, "text")]);
            const rightNode = h("div", null, [h("div", { key: "b" }, "text")]);
            assertPatchProduces(leftNode, rightNode);
        });
        it("remove key — keyed to unkeyed replaces element", () => {
            const leftNode = h("div", null, [h("div", { key: "a" }, "text")]);
            const rightNode = h("div", null, [h("div", null, "text")]);
            assertPatchProduces(leftNode, rightNode);
        });
    });
    // =========================================================================
    // Style add/remove
    // =========================================================================
    describe("style add and remove", () => {
        it("add style from none", () => {
            const leftNode = h("div", {}, []);
            const rightNode = h("div", { style: "color: red" }, []);
            const container = document.createElement("div");
            vdomRender(leftNode, container, { document });
            vdomRender(rightNode, container, { document });
            const newRoot = container.childNodes[0];
            expect(newRoot.style.color).toBe("red");
        });
        it("remove all styles", () => {
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
        it("props change + children reorder on same element", () => {
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
        it("VComment siblings mixed with keyed VNode children", () => {
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
// =============================================================================
// render function tests
// =============================================================================
describe("render", () => {
    it("renders vnode into container", () => {
        const container = document.createElement("div");
        const vnode = h("span", null, "hello");
        const result = vdomRender(vnode, container, { document });
        expect(container.childNodes.length).toBe(1);
        expect(container.childNodes[0].tagName).toBe("SPAN");
        expect(result).toBe(container.childNodes[0]);
    });
    it("clears container before rendering", () => {
        const container = document.createElement("div");
        container.innerHTML = "<p>old content</p><p>more old</p>";
        expect(container.childNodes.length).toBe(2);
        const vnode = h("span", null, "new content");
        vdomRender(vnode, container, { document });
        expect(container.childNodes.length).toBe(1);
        expect(container.childNodes[0].tagName).toBe("SPAN");
    });
    it("renders nested tree", () => {
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
    it("renders VText", () => {
        const container = document.createElement("div");
        const vtext = new VText("hello world");
        vdomRender(vtext, container, { document });
        expect(container.childNodes.length).toBe(1);
        expect(container.childNodes[0].nodeType).toBe(3);
        expect(container.childNodes[0].data).toBe("hello world");
    });
    it("renders VComment", () => {
        const container = document.createElement("div");
        const vcomment = new VComment("my comment");
        vdomRender(vcomment, container, { document });
        expect(container.childNodes.length).toBe(1);
        expect(container.childNodes[0].nodeType).toBe(8);
        expect(container.childNodes[0].data).toBe("my comment");
    });
    it("renders VFragment children directly into container", () => {
        const container = document.createElement("div");
        const fragment = new VFragment([
            new VText("one"),
            h("span", null, "two"),
            new VText("three"),
        ]);
        vdomRender(fragment, container, { document });
        // DocumentFragment's children are appended directly to container
        expect(container.childNodes.length).toBe(3);
        expect(container.childNodes[0].data).toBe("one");
        expect(container.childNodes[1].tagName).toBe("SPAN");
        expect(container.childNodes[2].data).toBe("three");
    });
    it("returns null for empty VBase", () => {
        const container = document.createElement("div");
        const base = new VBase();
        const result = vdomRender(base, container, { document });
        expect(result).toBeNull();
        expect(container.childNodes.length).toBe(0);
    });
    describe("re-render", () => {
        it("re-renders with text change", () => {
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
        it("re-renders with child additions", () => {
            const container = document.createElement("div");
            vdomRender(h("div", null, [h("span", null, "one")]), container, { document });
            vdomRender(h("div", null, [h("span", null, "one"), h("span", null, "two")]), container, { document });
            const root = container.childNodes[0];
            expect(root.childNodes.length).toBe(2);
            expect(root.childNodes[1].tagName).toBe("SPAN");
        });
        it("re-renders with child removals", () => {
            const container = document.createElement("div");
            vdomRender(h("div", null, [h("span", null, "one"), h("span", null, "two")]), container, { document });
            vdomRender(h("div", null, [h("span", null, "one")]), container, { document });
            const root = container.childNodes[0];
            expect(root.childNodes.length).toBe(1);
        });
        it("re-renders with root element replacement (div -> span)", () => {
            const container = document.createElement("div");
            vdomRender(h("div", null, "content"), container, { document });
            expect(container.childNodes[0].tagName).toBe("DIV");
            const result = vdomRender(h("span", null, "content"), container, { document });
            expect(container.childNodes.length).toBe(1);
            expect(container.childNodes[0].tagName).toBe("SPAN");
            expect(result).toBe(container.childNodes[0]);
        });
        it("re-renders with attribute changes", () => {
            const container = document.createElement("div");
            vdomRender(h("div", { className: "old" }, "text"), container, { document });
            vdomRender(h("div", { className: "new", id: "added" }, "text"), container, {
                document,
            });
            const root = container.childNodes[0];
            expect(root.className).toBe("new");
            expect(root.id).toBe("added");
        });
        it("re-renders VFragment with text change", () => {
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
        it("re-renders VFragment with child addition", () => {
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
        it("re-renders VFragment with child removal", () => {
            const container = document.createElement("div");
            vdomRender(new VFragment([new VText("a"), new VText("b")]), container, {
                document,
            });
            expect(container.childNodes.length).toBe(2);
            vdomRender(new VFragment([new VText("a")]), container, { document });
            expect(container.childNodes.length).toBe(1);
            expect(container.childNodes[0].data).toBe("a");
        });
        it("re-renders VFragment to VNode transition", () => {
            const container = document.createElement("div");
            vdomRender(new VFragment([new VText("a"), new VText("b")]), container, {
                document,
            });
            expect(container.childNodes.length).toBe(2);
            vdomRender(h("div", null, "content"), container, { document });
            expect(container.childNodes.length).toBe(1);
            expect(container.childNodes[0].tagName).toBe("DIV");
        });
        it("re-renders VNode to VFragment transition", () => {
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
        it("handles multiple VFragment re-renders", () => {
            const container = document.createElement("div");
            vdomRender(new VFragment([new VText("a")]), container, { document });
            expect(container.childNodes.length).toBe(1);
            vdomRender(new VFragment([new VText("b"), new VText("c")]), container, {
                document,
            });
            expect(container.childNodes.length).toBe(2);
            vdomRender(new VFragment([new VText("d"), new VText("e"), new VText("f")]), container, { document });
            expect(container.childNodes.length).toBe(3);
            expect(container.childNodes[0].data).toBe("d");
            expect(container.childNodes[1].data).toBe("e");
            expect(container.childNodes[2].data).toBe("f");
        });
        it("re-renders VFragment root with nested VFragment children", () => {
            const container = document.createElement("div");
            // Simulates component pattern: comment marker + VFragment child
            vdomRender(new VFragment([
                new VComment("comp-root"),
                new VFragment([new VComment("comp-child"), h("section", null, "v1")]),
            ]), container, { document });
            expect(container.childNodes.length).toBe(3);
            expect(container.childNodes[0].nodeType).toBe(8); // comment
            expect(container.childNodes[1].nodeType).toBe(8); // comment
            expect(container.childNodes[2].tagName).toBe("SECTION");
            // Re-render with changed content — this was the failing scenario
            vdomRender(new VFragment([
                new VComment("comp-root"),
                new VFragment([
                    new VComment("comp-child"),
                    h("section", null, "v2"),
                    h("div", null, "added"),
                ]),
            ]), container, { document });
            expect(container.childNodes.length).toBe(4);
            expect(container.childNodes[2].textContent).toBe("v2");
            expect(container.childNodes[3].tagName).toBe("DIV");
            expect(container.childNodes[3].textContent).toBe("added");
        });
        it("subsequent re-renders after root replacement work correctly", () => {
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
    describe("unmount", () => {
        it("clears container and cache", () => {
            const container = document.createElement("div");
            vdomRender(h("div", null, "hello"), container, { document });
            expect(container.childNodes.length).toBe(1);
            unmount(container);
            expect(container.childNodes.length).toBe(0);
        });
        it("render after unmount does fresh render", () => {
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
