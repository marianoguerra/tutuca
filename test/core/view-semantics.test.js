import assert from "node:assert/strict";
import test from "node:test";
import { $if, AstNode, component, field, h, pushView, t } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const setup = (specs) => setupHost(specs);

for (const value of ["hello", 42, false, null, undefined]) {
	test(`literal ${String(value)} works in every expression body`, () => {
		const expected = value == null ? "" : String(value);
		for (const body of [
			value,
			$if(true, value, "wrong"),
			$if(false, "wrong", value),
			pushView("compact", value),
		]) {
			const Root = component({ name: "Root", views: { main: body } });
			const { host, rootNode } = setup({ Root });
			host.start(Root.make());
			assert.equal(rootNode.textContent, expected);
		}
	});
}

test("literal condition uses JS truthiness and only evaluates the selected branch", () => {
	for (const value of [false, 0, "", null, undefined, NaN, true, 1, "false", {}]) {
		let calls = 0;
		const selected = new (class extends AstNode {
			eval() {
				calls++;
				return "selected";
			}
		})();
		const rejected = new (class extends AstNode {
			eval() {
				throw new Error("unselected branch evaluated");
			}
		})();
		const v = $if(value, value ? selected : rejected, value ? rejected : selected);
		assert.equal(v.eval({}), "selected");
		assert.equal(calls, 1);
	}
});

test("attributes and children read fields, and $if selects values", () => {
	const Greeting = component({
		name: "Greeting",
		fields: { name: t.string("world"), loud: t.boolean() },
		view: h(
			"p",
			{ class: $if(field("loud"), "loud", "quiet"), title: field("name") },
			"Hello, ",
			field("name"),
			"!",
		),
	});
	const { host, rootNode } = setup({ Greeting });
	host.start(Greeting.make({ name: "Ada", loud: true }));
	const p = rootNode.querySelector("p");
	assert.equal(p.textContent, "Hello, Ada!");
	assert.equal(p.getAttribute("title"), "Ada");
	assert.equal(p.className, "loud");
});

test("re-rendering patches the existing DOM", () => {
	const Str = component({
		name: "Str",
		fields: { value: t.string() },
		view: h("span", {}, field("value")),
	});
	const { host, rootNode } = setup({ Str });
	host.start(Str.make({ value: "a" }));
	const span = rootNode.querySelector("span");
	host.rootComponent = Str.make({ value: "b" });
	host.render();
	assert.equal(rootNode.querySelector("span"), span);
	assert.equal(span.textContent, "b");
});

test("components are wrapped in meta comments", () => {
	const C = component({ name: "C", view: h("b", {}, "x") });
	const { host, rootNode } = setup({ C });
	host.start(C.make());
	const comments = [...rootNode.childNodes].filter((n) => n.nodeType === 8).map((n) => n.data);
	assert.deepEqual(comments, ['§{"t":"component"}§', "§/§"]);
});

test("a component without a main view is rejected", () => {
	assert.throws(() => component({ name: "C", views: { compact: "x" } }), /C has no main view/);
});

test("view names don't resolve to inherited properties", () => {
	const C = component({ name: "C", view: "main" });
	assert.equal(C.views.toString, undefined);
});

test("arrays of children splice into their parent, nested ones too", () => {
	const Root = component({
		name: "Root",
		fields: { show: t.boolean(true) },
		view: h("p", {}, [h("b", {}, "x"), [$if(field("show"), h("i", {}, "y"), ""), "z"]]),
	});
	const { host, rootNode } = setup({ Root });
	host.start(Root.make());
	assert.equal(rootNode.querySelector("p").innerHTML, "<b>x</b><i>y</i>z");
});
