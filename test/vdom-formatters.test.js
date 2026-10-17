import assert from "node:assert/strict";
import test from "node:test";
import { installVdomFormatters } from "../src/dev/vdom-formatters.js";
import { vcomment as comment, vfrag as fragment, vh as h } from "./helpers.js";

const formatter = installVdomFormatters({});

// Flattens JsonML to the text DevTools would show; nested object refs print as <ref>.
const text = (ml) => {
	if (ml === null) return null;
	if (typeof ml === "string") return ml;
	if (ml[0] === "object") return "<ref>";
	return ml.slice(2).map(text).join("");
};
const header = (v) => text(formatter.header(v));
const body = (v) => text(formatter.body(v));

test("install is idempotent per target", () => {
	const target = {};
	assert.equal(installVdomFormatters(target), installVdomFormatters(target));
	assert.equal(target.devtoolsFormatters.length, 1);
});

test("ignores values it doesn't know", () => {
	for (const v of [1, "s", null, undefined, {}, [], [1, h("p")], () => {}]) {
		assert.equal(formatter.header(v), null);
		assert.equal(formatter.hasBody(v), false);
	}
});

test("large non vdom arrays bail out on the first item", () => {
	let reads = 0;
	const items = new Proxy(new Array(100000).fill(0), {
		get: (t, k) => {
			if (/^\d+$/.test(k)) reads++;
			return t[k];
		},
	});
	assert.equal(formatter.header(items), null);
	assert.equal(reads, 1);
});

test("elements with a short text child render inline", () => {
	const v = h("span", { class: "x" }, "Hello");
	assert.equal(header(v), '<span class="x">Hello</span>');
	assert.equal(formatter.hasBody(v), false);
	assert.equal(header(h("br")), "<br></br>");
});

test("elements with children expand and close", () => {
	const v = h("p", { title: "t" }, ["Hello, ", h("b", {}, "Ada")]);
	assert.equal(header(v), '<p title="t">…</p>');
	assert.equal(formatter.hasBody(v), true);
	assert.equal(body(v), "<ref><ref></p>");
});

test("attribute values", () => {
	const v = h("input", { key: 7, disabled: true, checked: false, value: null, oninput: () => {} });
	assert.equal(header(v), '<input key="7" disabled checked=false value=null oninput=ƒ></input>');
	const many = h("div", { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" });
	assert.equal(header(many), '<div a="1" b="2" c="3" d="4" …+2></div>');
	const html = h("div", { dangerouslySetInnerHTML: { __html: "<b>x</b>" } });
	assert.equal(header(html), "<div dangerouslySetInnerHTML=<ref>></div>");
});

test("namespaces only show when not implied", () => {
	const svg = h("svg", {}, [h("circle", { r: "1", namespace: "http://www.w3.org/2000/svg" })]);
	assert.equal(header(svg), "<svg>…</svg>");
	assert.equal(header(svg.childs[0]), '<svg:circle r="1"></svg:circle>');
});

test("text, comments, fragments and vnode arrays", () => {
	assert.equal(header(h("p", {}, "x".repeat(50)).childs[0]), `"${"x".repeat(40)}…"`);
	assert.equal(header(comment(" note ")), "<!-- note -->");
	const frag = fragment([h("i"), "t"], "k");
	assert.equal(header(frag), '<> key="k" (2)');
	assert.equal(body(frag), "<ref><ref></>");
	const out = [h("a"), comment("c")]; // what render() returns and host._curVDom holds
	assert.equal(header(out), "[2 vnodes]");
	assert.equal(body(out), "<ref><ref>");
});

test("comment hook", () => {
	const f = installVdomFormatters({}, { comment: (t) => (t === "x" ? ["X"] : null) });
	assert.equal(text(f.header(comment("x"))), "X");
	assert.equal(text(f.header(comment("y"))), "<!--y-->");
});
