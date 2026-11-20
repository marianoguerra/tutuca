// The scenarios of spec/bind/lower.rkt and spec/bind/meta.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { lower, lowerRoot } from "../src/bind/lower.js";
import { META_CLOSE, metaString, stringMeta } from "../src/bind/meta.js";
import * as vnode from "../src/bind/vnode.js";
import { component, Host, h } from "../src/tutuca.js";
import * as sem from "../src/view/sem.js";

const open = vnode.comment(metaString({ t: "component" }));
const close = vnode.comment(META_CLOSE);

test("metadata text is what is written, and parsing inverts it", () => {
	assert.equal(metaString({ t: "component" }), '§{"t":"component"}§');
	assert.deepEqual(stringMeta('§{"t":"component"}§'), { t: "component" });
	// Look-alike comments are not metadata.
	assert.equal(stringMeta(META_CLOSE), null);
	assert.equal(stringMeta('§{"t":"it"}§'), null);
	assert.equal(stringMeta("§{not json}§"), null);
	assert.equal(stringMeta("ordinary comment"), null);
});

test("components are wrapped in metadata comments", () => {
	const b = h("b", {}, "x");
	const C = component({ name: "C", view: b });
	assert.deepEqual(lowerRoot(C.make()), [
		open,
		vnode.makeEl(b.tid, "b", null, null, {}, [vnode.text("x")]),
		close,
	]);
});

test("groups keep their key; their children lower in place", () => {
	const tree = sem.group("a", [sem.text("A"), sem.component("C", [sem.comment("c")])]);
	assert.deepEqual(lower(tree), [
		vnode.group("a", [vnode.text("A"), open, vnode.comment("c"), close]),
	]);
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
	assert.equal(
		rootNode.innerHTML,
		'<!--§{"t":"component"}§--><p class="loud">Hello, <b>world</b>!</p><!--§/§-->',
	);
	// Rendering again keeps the nodes: same templates, same elements.
	const p = rootNode.querySelector("p");
	host.render();
	assert.equal(rootNode.querySelector("p"), p);
});
