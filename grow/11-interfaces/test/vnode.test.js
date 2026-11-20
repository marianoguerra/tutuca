import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { comment, group, makeEl, morph, text } from "../src/bind/vnode.js";

const page = () => {
	const { document } = new JSDOM("<main></main>").window;
	return { document, main: document.querySelector("main") };
};

test("morph builds the DOM of a tree of vnodes", () => {
	const { document, main } = page();
	const tree = [
		comment("a list"),
		makeEl(1, "ul", null, null, { class: "todos" }, [
			makeEl(2, "li", null, "a", {}, [text("write the spec")]),
			makeEl(2, "li", null, "b", {}, [text("write the code")]),
		]),
	];
	morph(document, main, tree);
	assert.equal(
		main.innerHTML,
		'<!--a list--><ul class="todos"><li>write the spec</li><li>write the code</li></ul>',
	);
});

test("morphing to a new tree leaves what rendering it would, and keeps the nodes", () => {
	const { document, main } = page();
	const view = (title, count) => [makeEl(3, "p", null, null, { title }, [text(`count: ${count}`)])];
	const old = view("zero", 0);
	morph(document, main, old);
	const p = main.firstChild;
	morph(document, main, view("one", 1), old);
	assert.equal(main.innerHTML, '<p title="one">count: 1</p>');
	assert.equal(main.firstChild, p);
});

test("elements of different templates replace each other", () => {
	const { document, main } = page();
	const old = [makeEl(5, "p", null, null, {}, [])];
	morph(document, main, old);
	const p = main.firstChild;
	morph(document, main, [makeEl(6, "p", null, null, {}, [])], old);
	assert.equal(main.innerHTML, "<p></p>");
	assert.notEqual(main.firstChild, p);
});

test("keyed groups move with their key", () => {
	const { document, main } = page();
	const item = (key) => group(key, [makeEl(4, "li", null, null, {}, [text(key)])]);
	const old = [item("a"), item("b")];
	morph(document, main, old);
	const [a, b] = main.childNodes;
	morph(document, main, [item("b"), item("a")], old);
	assert.equal(main.innerHTML, "<li>b</li><li>a</li>");
	assert.deepEqual([...main.childNodes], [b, a]);
});

test("svg sets its own namespace", () => {
	const { document, main } = page();
	morph(document, main, [makeEl(7, "svg", null, null, {}, [makeEl(8, "g", null, null, {}, [])])]);
	assert.equal(main.firstChild.namespaceURI, "http://www.w3.org/2000/svg");
	assert.equal(main.firstChild.firstChild.namespaceURI, "http://www.w3.org/2000/svg");
});
