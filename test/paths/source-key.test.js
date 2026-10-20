import assert from "node:assert/strict";
import test from "node:test";
import { component, each, field, h, renderEach, renderIt, send, t } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

// A Leaf in rows[1].cells[2] of a Mid, the Mid in mids[1] of a Top: each receiver
// sees the key of the step that leads out of its own view.
test("sourceKey is relative to the receiver for events, notifies, sends and replies", () => {
	const seen = [];
	const record = (who) => (_draft, _args, ctx) => {
		seen.push([who, ctx.sourceKey]);
	};
	const Leaf = component({
		name: "Leaf",
		view: h("button", { "on:click": send("click") }),
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
		fields: { rows: t.array() },
		view: h("div", {}, each(field("rows"), h("p", {}, each(field("cells"), renderIt())))),
		on: { ping: record("mid notify") },
	});
	const Top = component({
		name: "Top",
		fields: { mids: t.array() },
		view: h("div", {}, renderEach(field("mids"))),
		on: {
			ping(_draft, _args, ctx) {
				seen.push(["top notify", ctx.sourceKey]);
				ctx.sendAt("ping", [], (b) => b.item("mids", 1));
			},
		},
	});
	const { host, rootNode, C, failures, click } = setupHost({ Leaf, Mid, Top }, { sync: true });
	host.scope.registerAskHandlers({ load: () => "loaded" });
	const mid = C.Mid({ rows: [{ cells: [] }, { cells: [C.Leaf(), C.Leaf(), C.Leaf()] }] });
	host.start(C.Top({ mids: [C.Mid(), mid] }));
	click(rootNode.querySelectorAll("button")[2]);
	assert.deepEqual(failures, []);
	assert.deepEqual(seen, [
		["leaf click", null],
		["mid notify", 2],
		["leaf reply", null],
		["top notify", 1],
		["mid notify", null],
	]);
});
