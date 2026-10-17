import assert from "node:assert/strict";
import test from "node:test";
import {
	component,
	each,
	field,
	h,
	provided,
	render,
	renderEach,
	renderIt,
	send,
	seqItem,
	sourceKey,
} from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const setup = (specs) => setupHost(specs, { sync: true });

function click(host, rootNode, index = 0) {
	host.handleEvent({
		type: "click",
		target: rootNode.querySelectorAll("button")[index],
	});
	host.handleTasks();
}

for (const sourceName of ["field", "seqItem", "provided"]) {
	for (const object of [false, true]) {
		for (const mode of ["renderEach", "each", "renderIt", "iterWith"]) {
			test(`${sourceName} ${object ? "object" : "array"} collection: ${mode}`, () => {
				const seen = [];
				const Item = component({
					name: "Item",
					fields: (t) => ({ count: t.number() }),
					view: h("button", { "@on.click": send("inc") }, field("count")),
					on: {
						inc(draft, _args, ctx) {
							draft.count++;
							ctx.notify("changed");
						},
					},
				});
				const source =
					sourceName === "field"
						? field("items")
						: sourceName === "seqItem"
							? seqItem("groups", "selected")
							: provided("items");
				const content =
					mode === "renderEach"
						? renderEach(source)
						: each(
								source,
								h(
									"section",
									{},
									mode === "renderIt"
										? renderIt()
										: h("button", { "@on.click": send("pick", sourceKey()) }, "pick"),
								),
								mode === "iterWith" ? "iterate" : undefined,
							);
				const Panel = component({
					name: "Panel",
					fields: (t) => ({
						items: t.any(),
						groups: t.any(),
						selected: t.number(),
						picked: t.any(),
					}),
					loops: {
						iterate: {
							iter: (items) => (Array.isArray(items) ? items.entries() : Object.entries(items)),
						},
					},
					view: h("div", {}, content),
					on: {
						pick(draft, [key]) {
							draft.picked = key;
						},
						changed() {
							seen.push("panel");
						},
					},
				});
				const Root = component({
					name: "Root",
					fields: (t) => ({
						panel: t.component("Panel"),
						groups: t.any(),
						selected: t.number(),
					}),
					provides:
						sourceName === "provided"
							? {
									items(pb) {
										pb.seqItem("groups", "selected");
									},
								}
							: undefined,
					view: h("main", {}, render(field("panel"))),
					on: {
						changed() {
							seen.push("root");
						},
					},
				});
				const { host, rootNode, C } = setup({ Root, Panel, Item });
				const items = object ? { a: C.Item(), b: C.Item() } : [C.Item(), C.Item()];
				const panel = C.Panel({
					items: sourceName === "field" ? items : undefined,
					groups: sourceName === "seqItem" ? [items] : undefined,
				});
				host.start(C.Root({ panel, groups: sourceName === "provided" ? [items] : undefined }));
				assert.equal(rootNode.querySelectorAll("button").length, 2);
				click(host, rootNode, 1);
				const root = host.rootComponent;
				const key = object ? "b" : 1;
				if (mode === "each" || mode === "iterWith") {
					assert.equal(root.panel.picked, key);
				} else {
					const updated =
						sourceName === "provided"
							? root.groups[0]
							: sourceName === "seqItem"
								? root.panel.groups[0]
								: root.panel.items;
					assert.equal(updated[key].count, 1);
					assert.equal(items[key].count, 0);
					assert.deepEqual(seen, ["panel", "root"]);
				}
			});
		}
	}
}

test("nested provided collection jumps preserve provider depths and shadowing", () => {
	const seen = [];
	const Counter = component({
		name: "Counter",
		fields: (t) => ({ count: t.number() }),
		view: h("button", { "@on.click": send("inc") }, "inc"),
		on: {
			inc(draft, _args, ctx) {
				draft.count++;
				ctx.notify("changed");
			},
		},
	});
	const InnerPanel = component({
		name: "InnerPanel",
		view: h("div", {}, renderEach(provided("items"))),
		on: {
			changed() {
				seen.push("inner");
			},
		},
	});
	const Group = component({
		name: "Group",
		fields: (t) => ({ items: t.map(), panel: t.component("InnerPanel") }),
		provides: {
			items(pb) {
				pb.field("items");
			},
		},
		view: h("section", {}, render(field("panel"))),
		on: {
			changed() {
				seen.push("group");
			},
		},
	});
	const OuterPanel = component({
		name: "OuterPanel",
		view: h("div", {}, renderEach(provided("items"))),
		on: {
			changed() {
				seen.push("outer");
			},
		},
	});
	const Root = component({
		name: "Root",
		fields: (t) => ({ groups: t.array(), panel: t.component("OuterPanel") }),
		provides: {
			items(pb) {
				pb.field("groups");
			},
		},
		view: h("main", {}, render(field("panel"))),
		on: {
			changed() {
				seen.push("root");
			},
		},
	});
	const { host, rootNode, C } = setup({ Root, Group, OuterPanel, InnerPanel, Counter });
	host.start(C.Root({ groups: [C.Group({ items: { a: C.Counter() } })] }));
	click(host, rootNode);
	assert.equal(host.rootComponent.groups[0].items.a.count, 1);
	assert.deepEqual(seen, ["inner", "group", "outer", "root"]);
});

test("rendered SeqItem collection stays frozen while sendAt captures producer commit", () => {
	const Item = component({
		name: "Item",
		fields: (t) => ({ count: t.number() }),
		view: h("button", { "@on.click": send("inc") }, "inc"),
		on: {
			inc(draft) {
				draft.count++;
			},
		},
	});
	const Root = component({
		name: "Root",
		fields: (t) => ({ selected: t.number(), groups: t.array() }),
		view: h(
			"div",
			{},
			h("button", { "@on.click": send("queue") }, "queue"),
			renderEach(seqItem("groups", "selected")),
		),
		on: {
			queue(draft, _args, ctx) {
				ctx.sendAt("inc", [], (pb) => pb.seqItem("groups", "selected").field(0));
				draft.selected = 1;
			},
		},
	});
	const { host, rootNode, C } = setup({ Root, Item });
	host.start(C.Root({ groups: [[C.Item()], [C.Item()]] }));
	const oldButton = rootNode.querySelectorAll("button")[1];
	// Queue both DOM events before executing either, as with already queued work.
	const handleTasks = host.handleTasks;
	host.handleTasks = () => {};
	host.handleEvent({ type: "click", target: rootNode.querySelector("button") });
	host.handleEvent({ type: "click", target: oldButton });
	host.handleTasks = handleTasks;
	host.handleTasks();
	assert.equal(host.rootComponent.groups[0][0].count, 1);
	assert.equal(host.rootComponent.groups[1][0].count, 1);
});

for (const depth of [0, 1, 2, 8]) {
	test(`${depth} provided collection jumps retain all bubbling frames`, () => {
		const seen = [];
		const Node = component({
			name: "Node",
			fields: (t) => ({ count: t.number(), id: t.number(), items: t.array() }),
			provides: {
				items(pb) {
					pb.field("items");
				},
			},
			view: h(
				"div",
				{},
				h("button", { "@on.click": send("inc") }, "inc"),
				renderEach(provided("items")),
			),
			on: {
				inc(draft, _args, ctx) {
					draft.count++;
					ctx.notify("changed");
				},
				changed() {
					seen.push(this.id);
				},
			},
		});
		const { host, rootNode, C } = setup({ Node });
		let root = C.Node({ id: depth, items: [] });
		for (let i = depth - 1; i >= 0; i--) root = C.Node({ id: i, items: [root] });
		host.start(root);
		click(host, rootNode, depth);
		let leaf = host.rootComponent;
		for (let i = 0; i < depth; i++) leaf = leaf.items[0];
		assert.equal(leaf.count, 1);
		assert.deepEqual(
			seen,
			Array.from({ length: depth }, (_, i) => depth - i - 1),
		);
	});
}

test("PathBuilder item updates array and object items", () => {
	const Item = component({
		name: "Item",
		fields: (t) => ({ count: t.number() }),
		view: null,
		on: {
			inc(draft) {
				draft.count++;
			},
		},
	});
	const Root = component({
		name: "Root",
		fields: (t) => ({ array: t.array(), object: t.map() }),
		view: h("button", { "@on.click": send("update") }, "update"),
		on: {
			update(_draft, _args, ctx) {
				ctx.sendAt("inc", [], (pb) => pb.item("array", 0));
				ctx.sendAt("inc", [], (pb) => pb.item("object", "a"));
			},
		},
	});
	const { host, rootNode, C } = setup({ Root, Item });
	host.start(C.Root({ array: [C.Item()], object: { a: C.Item() } }));
	click(host, rootNode);
	assert.equal(host.rootComponent.array[0].count, 1);
	assert.equal(host.rootComponent.object.a.count, 1);
});
