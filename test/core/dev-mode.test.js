import assert from "node:assert/strict";
import test from "node:test";
import { component, field, findInvalidFields, h, renderEach, send, t } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const Item = component({
	name: "Item",
	fields: { count: t.number() },
	view: h("button", { "on:click": send("inc") }, field("count")),
	on: {
		inc(draft) {
			draft.count = draft.count > 0 ? "many" : draft.count + 1;
		},
	},
});

const List = component({
	name: "List",
	fields: { items: t.array(t.component("Item")), title: t.string() },
	view: h("div", { "on:click": send("rename") }, renderEach(field("items"))),
	on: {
		rename(draft) {
			draft.title = 42;
			draft.extra = true;
		},
	},
});

function setup(dev) {
	const reports = [];
	const onReport = (type, info) => type === "stateInvalid" && reports.push(info);
	return { ...setupHost({ List, Item }, { dev, sync: true, onReport }), reports };
}

const summary = (issues) =>
	issues.map(({ path, component, reason }) => `${component} ${path.join(".")} ${reason}`);

test("findInvalidFields reports invalid and undeclared fields with their paths", () => {
	const { C } = setup(false);
	const list = C.List({ items: [C.Item(), C.Item()] });
	assert.deepEqual(findInvalidFields(list, null), []);
	const broken = Object.assign(
		C.List({ items: [C.Item(), Object.assign(C.Item(), { count: "x" })] }),
		{
			title: 1,
			extra: 2,
		},
	);
	assert.deepEqual(summary(findInvalidFields(broken, null)), [
		"List extra undeclared",
		"Item items.1.count invalid",
		"List title invalid",
	]);
});

test("findInvalidFields skips subtrees shared with the previous state", () => {
	const { C } = setup(false);
	const bad = Object.assign(C.Item(), { count: "x" });
	const prev = C.List({ items: [C.Item()] });
	prev.items.push(bad);
	const next = Object.assign(C.List(), { items: prev.items });
	assert.deepEqual(findInvalidFields(next, prev), []);
	assert.equal(findInvalidFields(next, null).length, 1);
});

test("dev mode checks the root on start and the state after each task", () => {
	const { host, rootNode, reports, C } = setup(true);
	host.start(C.List({ items: [C.Item(), C.Item()] }));
	assert.deepEqual(reports, []);
	const [first] = rootNode.querySelectorAll("button");
	first.click();
	assert.deepEqual(reports, []);
	first.click();
	assert.equal(reports.length, 1);
	assert.equal(reports[0].task.name, "inc");
	assert.deepEqual(summary(reports[0].issues), ["Item items.0.count invalid"]);
	// Only the changed item is walked, so the old issue isn't reported again with the new one.
	rootNode.querySelector("div").click();
	assert.equal(reports.length, 2);
	assert.equal(reports[1].task.name, "rename");
	assert.deepEqual(summary(reports[1].issues), ["List extra undeclared", "List title invalid"]);
	// Invalid states are reported, not rolled back.
	assert.equal(host.rootComponent.items[0].count, "many");
});

test("dev mode reports an invalid root on start, and nothing runs without dev", () => {
	const { C, ...on } = setup(true);
	const bad = Object.assign(C.Item(), { count: null });
	on.host.start(bad);
	assert.deepEqual(summary(on.reports[0].issues), ["Item count invalid"]);
	assert.equal(on.reports[0].task, null);
	const off = setup(false);
	off.host.start(bad);
	off.rootNode.querySelector("button").click();
	assert.deepEqual(off.reports, []);
});

const Picker = component({
	name: "Picker",
	fields: { items: t.array(t.component("Item")).default([]), picked: t.number() },
	view: h(
		"div",
		{},
		h("p", { "on:click": send("pick", 1) }, "ok"),
		h("i", { "on:click": send("pick", "x") }, "bad arg"),
		h("b", { "on:click": send("pick", 99) }, "breaks post"),
		h("u", { "on:click": send("noisy") }, "emits"),
	),
	on: {
		pick: {
			args: [t.number().int()],
			pre: (prev) => prev.items.length > 0,
			post: (_prev, next, [n]) => next.picked === n && n < 10,
			run(draft, [n]) {
				draft.picked = n;
			},
		},
		noisy: {
			emits: { notify: ["picked"] },
			run(_draft, _args, ctx) {
				ctx.notify("picked");
				ctx.notify("other");
				ctx.ask("load");
			},
		},
	},
});

test("dev mode reports messages that break their spec", () => {
	const reports = [];
	const onReport = (type, info) => type === "messageInvalid" && reports.push(info);
	const { host, rootNode, C } = setupHost({ Picker, Item }, { dev: true, sync: true, onReport });
	host.start(C.Picker({ items: [C.Item()] }));
	const click = (tag) => rootNode.querySelector(tag).click();
	click("p");
	assert.deepEqual(reports, []);
	click("i");
	click("b");
	click("u");
	assert.deepEqual(
		reports.map(({ message, issues }) => [message, issues]),
		[
			["pick", ["arg:0", "post"]],
			["pick", ["post"]],
			["noisy", ["emits:notify:other", "emits:ask:load"]],
		],
	);
	host.rootComponent = Object.assign(host.scope.components.Picker(), {});
	host.render();
	click("p");
	assert.deepEqual(reports.at(-1).issues, ["pre"]);
});
