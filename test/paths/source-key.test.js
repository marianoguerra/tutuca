import assert from "node:assert/strict";
import test from "node:test";
import { component, each, field, h, renderEach, renderIt, send } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

// A Leaf in rows[1].cells[2] of a Mid, the Mid in mids[1] of a Top: each receiver
// sees the key of the step that leads out of its own view.
test("sourceKey is relative to the receiver for events, notifies, sends and replies", () => {
	const seen = [];
	const failures = [];
	const record = (who) => (_draft, _args, ctx) => {
		seen.push([who, ctx.sourceKey]);
	};
	const Leaf = component({
		name: "Leaf",
		view: h("button", { "@on.click": send("click") }),
		on: {
			click(_draft, _args, ctx) {
				seen.push(["leaf click", ctx.sourceKey]);
				ctx.notify("ping");
				ctx.ask("load");
			},
			loadReplyOk: record("leaf reply"),
		},
	});
	const Mid = component({
		name: "Mid",
		fields: (t) => ({ rows: t.array() }),
		view: h("div", {}, each(field("rows"), h("p", {}, each(field("cells"), renderIt())))),
		on: { ping: record("mid notify") },
	});
	const Top = component({
		name: "Top",
		fields: (t) => ({ mids: t.array() }),
		view: h("div", {}, renderEach(field("mids"))),
		on: {
			ping(_draft, _args, ctx) {
				seen.push(["top notify", ctx.sourceKey]);
				ctx.sendAt("ping", [], (b) => b.item("mids", 1));
			},
		},
	});
	const onReport = (type, info) => type === "taskFailed" && failures.push(info.error);
	const { host, rootNode, C } = setupHost({ Leaf, Mid, Top }, { sync: true, onReport });
	host.scope.registerAskHandlers({ load: () => "loaded" });
	const mid = C.Mid({ rows: [{ cells: [] }, { cells: [C.Leaf(), C.Leaf(), C.Leaf()] }] });
	host.start(C.Top({ mids: [C.Mid(), mid] }));
	host.handleEvent({ type: "click", target: rootNode.querySelectorAll("button")[2] });
	while (host.tasks.length) host.handleTasks();
	assert.deepEqual(failures, []);
	assert.deepEqual(seen, [
		["leaf click", null],
		["mid notify", 2],
		["leaf reply", null],
		["top notify", 1],
		["mid notify", null],
	]);
});
