// tutuca/pure: handlers written as pure-js source, checked against their component and run
// like any other handler.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lint } from "../../src/lint/index.js";
import { checkHandlerOf, handlerSignature, pureHandlers, typeText } from "../../src/pure/index.js";
import { Driver } from "../../src/testing/driver.js";
import { component, enableHandlerSources, Scope, t } from "../../src/tutuca.js";

enableHandlerSources(pureHandlers());

const Item = component({
	name: "Item",
	fields: { title: t.string(), done: t.boolean() },
	on: { toggle: { pure: true, args: [], run: "function (next) { next.done = !this.done; }" } },
});
const TodoList = component({
	name: "TodoList",
	fields: {
		text: t.string(),
		items: t.array(t.component("Item")),
		filter: t.enum(["all", "open", "done"]),
		tags: t.map(t.number()),
	},
	queries: {
		get left() {
			return this.items.filter((item) => !item.done).length;
		},
		get summary() {
			return `${this.left} left`;
		},
	},
	on: {
		setText: { args: [t.string()], run: "function (next, [text]) { next.text = text; }" },
		add: {
			args: [],
			emits: { notify: ["added"] },
			run: `function (next, _args, ctx) {
				const text = this.text.trim();
				if (text === "") return;
				next.items.push(ctx.make("Item", { title: text }));
				next.text = "";
				ctx.notify("added", [text]);
			}`,
		},
		toggle: {
			args: [t.number()],
			run: `function (next, [i]) {
				const item = next.items[i];
				if (item === undefined) return;
				next.items[i] = tutuca.apply(item, "toggle");
			}`,
		},
		tag: {
			args: [t.string()],
			run: "function (next, [name]) { next.tags[name] = (this.tags[name] ?? 0) + 1; }",
		},
		describe: { args: [], run: "function (next) { next.text = this.summary; }" },
		cycle: {
			args: [],
			run: `function (next) {
				if (this.filter === "all") next.filter = "open";
				else if (this.filter === "open") next.filter = "done";
				else next.filter = "all";
			}`,
		},
	},
});
const Broken = component({
	name: "Broken",
	fields: { text: t.string(), count: t.number() },
	on: {
		wrongType: { args: [], run: "function (next) { next.text = this.count; }" },
		readOnly: { args: [], run: "function (next) { this.count = 1; }" },
		escape: { args: [], run: "function (next) { next.text = this.text.constructor.name; }" },
		wrongEmit: {
			args: [],
			emits: { notify: ["saved"] },
			run: 'function (next, _args, ctx) { ctx.notify("deleted"); }',
		},
		pureCtx: { pure: true, args: [], run: "function (next, _args, ctx) { ctx.stopNext(); }" },
		event: { args: [], run: "function (next, _args, ctx) { ctx.event.preventDefault(); }" },
	},
});

// args: the root's fields, or a function of the scope giving them (to make children).
const start = (name, args = {}) => {
	const scope = new Scope();
	scope.register({ Item, TodoList, Broken });
	return new Driver({ root: scope.make(name, typeof args === "function" ? args(scope) : args) });
};
const oneItem = (scope) => ({ items: [scope.make("Item", { title: "a" })] });

describe("source handlers", () => {
	test("run like functions: fields, arrays, ctx.make, ctx.notify", () => {
		const d = start("TodoList");
		d.send("setText", ["  milk  "]);
		d.send("add");
		d.send("setText", ["bread"]);
		d.send("add");
		assert.deepEqual(d.problems, []);
		assert.deepEqual(
			d.state.items.map((i) => [i.title, i.done]),
			[
				["milk", false],
				["bread", false],
			],
		);
		assert.equal(d.state.text, "");
	});
	test("apply a child's pure message through tutuca.apply", () => {
		const d = start("TodoList", oneItem);
		d.send("toggle", [0]);
		d.send("toggle", [5]);
		assert.deepEqual(d.problems, []);
		assert.equal(d.state.items[0].done, true);
	});
	test("dictionaries and enums", () => {
		const d = start("TodoList");
		d.send("tag", ["x"]);
		d.send("tag", ["x"]);
		d.send("cycle");
		assert.deepEqual(d.problems, []);
		assert.deepEqual({ ...d.state.tags }, { x: 2 });
		assert.equal(d.state.filter, "open");
	});
	test("queries are typed by checking their getters, one reading another", () => {
		const d = start("TodoList", oneItem);
		d.send("describe");
		assert.deepEqual(d.problems, []);
		assert.equal(d.state.text, "1 left");
	});
	test("a handler that doesn't check fails when it runs, saying why", () => {
		const d = start("Broken");
		d.send("wrongType");
		const [p] = d.problems;
		assert.match(String(p.error?.message ?? p.message), /not-assignable/);
	});
});

describe("what a source handler can't do", () => {
	const issues = lint([Item, TodoList, Broken]);
	const of = (label) =>
		issues.filter((i) => i.message.startsWith(`${label},`)).map((i) => i.message);
	test("lint finds nothing wrong in the handlers that check", () => {
		assert.deepEqual(
			issues.filter(
				(i) =>
					!i.message.startsWith("on.") ||
					/^on\.(setText|add|toggle|tag|describe|cycle),/.test(i.message),
			),
			[],
		);
	});
	test("write this, assign a number to a string, use what isn't there", () => {
		assert.match(of("on.wrongType")[0], /next.text is string; this is number/);
		assert.match(of("on.readOnly")[0], /read-only/);
		assert.match(of("on.escape")[0], /reserved-name/);
	});
	test("notify a name its emits doesn't list", () => {
		assert.match(of("on.wrongEmit")[0], /argument-type/);
	});
	test("a pure handler gets no ctx", () => {
		assert.match(of("on.pureCtx")[0], /too-many-params/);
	});
	test("ctx has no event: the DOM is out of reach", () => {
		assert.match(of("on.event")[0], /has no event/);
	});
	test("checkHandlerOf checks an instance's handler in its scope", () => {
		const scope = new Scope();
		scope.register({ Item, Broken });
		const diagnostics = checkHandlerOf(scope.make("Broken"), "wrongType");
		assert.equal(diagnostics[0].code, "not-assignable");
	});
});

describe("the mapping", () => {
	test("field types are pure-js types", () => {
		const known = new Set(["Item"]);
		assert.equal(typeText(t.string()), "string");
		assert.equal(typeText(t.enum(["a", "b"])), '"a" | "b"');
		assert.equal(typeText(t.option(t.number())), "number | null");
		assert.equal(typeText(t.array(t.enum(["a", "b"]))), '("a" | "b")[]');
		assert.equal(typeText(t.map(t.boolean())), "{ [key: string]: boolean }");
		assert.equal(typeText(t.record({ x: t.number(), y: t.number() })), "{ x: number; y: number }");
		assert.equal(typeText(t.component("Item"), known), "Item");
		assert.equal(typeText(t.component("Other"), known), "unknown");
		assert.equal(typeText(t.any()), "unknown");
	});
	test("a handler's signature: this read, next draft, args, ctx", () => {
		const s = handlerSignature(TodoList, TodoList.on.setText);
		assert.deepEqual(s, {
			this: { mode: "read", type: "TodoList" },
			params: [{ mode: "draft", type: "TodoList" }, "[string]", "Ctx"],
			result: "void",
		});
		assert.equal(handlerSignature(Item, Item.on.toggle).params.length, 2);
		// A handler whose emits say what it sends has a ctx of its own.
		assert.equal(handlerSignature(TodoList, TodoList.on.add).params[2], "Ctx_TodoList_add");
	});
});
