// The scenarios of spec/bind/lower.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { lower, lowerRoot } from "../src/bind/lower.js";
import * as vnode from "../src/bind/vnode.js";
import { component, Host, h } from "../src/tutuca.js";
import * as sem from "../src/view/sem.js";

test("a component lowers to what its view lowers to", () => {
	const b = h("b", {}, "x");
	const C = component({ name: "C", view: b });
	assert.deepEqual(lowerRoot(C.make()), [
		vnode.makeEl(b.tid, "b", null, null, {}, [vnode.text("x")]),
	]);
});

test("groups keep their key; their children lower in place", () => {
	const tree = sem.group("a", [sem.text("A"), sem.component("C", [sem.comment("c")])]);
	assert.deepEqual(lower(tree), [vnode.group("a", [vnode.text("A"), vnode.comment("c")])]);
});

test("elements in props lower to vnode values", () => {
	const tree = sem.el(900, "p", null, null, { title: sem.el(901, "b", null, null, {}, []) }, []);
	assert.deepEqual(lower(tree), [
		vnode.makeEl(900, "p", null, null, { title: vnode.makeEl(901, "b", null, null, {}, []) }, []),
	]);
});

test("hello world: a host puts a component on the page", () => {
	const { document } = new JSDOM("<main></main>").window;
	const rootNode = document.querySelector("main");
	const Hello = component({
		name: "Hello",
		view: h("p", { class: "loud" }, "Hello, ", h("b", {}, "world"), "!"),
	});
	const host = new Host({ document, rootNode });
	const C = host.scope.register({ Hello });
	host.start(C.Hello());
	assert.equal(rootNode.innerHTML, '<p class="loud">Hello, <b>world</b>!</p>');
	// Rendering again keeps the nodes: same templates, same elements.
	const p = rootNode.firstChild;
	host.render();
	assert.equal(rootNode.firstChild, p);
});
