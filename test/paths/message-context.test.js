import assert from "node:assert/strict";
import test from "node:test";
import {
	component,
	each,
	field,
	h,
	provided,
	render,
	renderIt,
	send,
	sourceKey,
	t,
} from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const setup = (specs) => setupHost(specs, { sync: true });

for (const placement of ["root", "field", "provided", "nested loops"]) {
	test(`loop handlers route derived tasks from their component: ${placement}`, async () => {
		const seen = [];
		const Child = component({
			name: "Child",
			fields: { count: t.number() },
			view: h("span", {}),
			on: {
				inc(next) {
					next.count++;
				},
			},
		});
		const Panel = component({
			name: "Panel",
			fields: {
				rows: t.array().default([{ cells: [{ label: "cell" }] }]),
				child: t.component("Child"),
				picked: t.any(),
				result: t.any(),
			},
			view: h(
				"div",
				{},
				each(
					field("rows"),
					h(
						"section",
						{},
						each(field("cells"), h("button", { "on:click": send("act", sourceKey()) })),
					),
				),
			),
			on: {
				act(next, [key], ctx) {
					next.picked = key;
					// The source key survives even though derived tasks use the component path.
					assert.equal(ctx.sourceKey, 0);
					ctx.sendAt("inc", [], (b) => b.field("child"));
					ctx.ask("load");
					ctx.notify("changed");
				},
				changed() {
					seen.push("panel");
				},
			},
			answers: {
				load: {
					ok(next, [value], ctx) {
						next.result = value;
						ctx.sendAt("inc", [], (b) => b.field("child"));
					},
				},
			},
		});
		const Root = component({
			name: "Root",
			fields: {
				storage: t.any(),
				groups: t.any(),
				panel: t.option(t.component("Panel")),
			},
			provides:
				placement === "provided"
					? {
							panel(b) {
								b.field("storage").field("panel");
							},
						}
					: undefined,
			view: h(
				"main",
				{},
				placement === "nested loops"
					? each(
							field("groups"),
							h("section", {}, each(field("panels"), h("article", {}, renderIt()))),
						)
					: render(placement === "provided" ? provided("panel") : field("panel")),
			),
			on: {
				changed() {
					seen.push("root");
				},
			},
		});
		const { host, rootNode, failures, drain, C } = setup({ Root, Panel, Child });
		host.scope.registerAskHandlers({ load: () => Promise.resolve("loaded") });
		const panel = C.Panel({ child: C.Child() });
		const rootArgs =
			placement === "provided"
				? { storage: { panel } }
				: placement === "nested loops"
					? { groups: [{ panels: [panel] }] }
					: { panel };
		host.start(placement === "root" ? panel : C.Root(rootArgs));
		host.handleEvent({ type: "click", target: rootNode.querySelector("button") });
		drain();
		await Promise.resolve();
		await Promise.resolve();
		drain();
		assert.deepEqual(failures, []);
		const root = host.rootComponent;
		const updated =
			placement === "root"
				? root
				: placement === "provided"
					? root.storage.panel
					: placement === "nested loops"
						? root.groups[0].panels[0]
						: root.panel;
		assert.equal(updated.picked, 0);
		assert.equal(updated.child.count, 2);
		assert.equal(updated.result, "loaded");
		assert.deepEqual(seen, placement === "root" ? [] : ["root"]);
	});
}

test("forwardAt from an event handler forwards the sent message and keeps the DOM event as cause", () => {
	const Child = component({
		name: "Child",
		fields: { got: t.any() },
		view: h("span", {}),
		on: {
			act(next, [n]) {
				next.got = n;
			},
		},
	});
	const Parent = component({
		name: "Parent",
		fields: { child: t.component("Child"), causeType: t.any() },
		view: h("div", {}, h("button", { "on:click": send("act", 7) }), render(field("child"))),
		on: {
			act(next, _args, ctx) {
				next.causeType = ctx.event.type;
				ctx.forwardAt((b) => b.field("child"));
			},
		},
	});
	const { host, rootNode, failures, drain, C } = setup({ Parent, Child });
	host.start(C.Parent());
	host.handleEvent({ type: "click", target: rootNode.querySelector("button") });
	drain();
	assert.deepEqual(failures, []);
	assert.equal(host.rootComponent.causeType, "click");
	assert.equal(host.rootComponent.child.got, 7);
});
