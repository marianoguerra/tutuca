// jq-lab: the grid of filters × inputs, the pinned outputs, the tools.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "jq-lab";

test("the sample's grid runs every filter on every input and says which pins pass", async () => {
	const s = await session(await agent(ID), "orders");
	// f2 on i2 fails: add of an empty list is null, the pin says 0.
	assert.equal(s.get("headline"), "1 pass · 1 fail · 2 unset · 0 errors");
	const grid = await s.json("outputs");
	assert.deepEqual(
		grid.map((row) => row.cells.map((c) => c.status)),
		[
			["pass", "none"],
			["none", "fail"],
		],
	);
	assert.deepEqual(grid[1].cells[1].outputs, [null]);
	assert.deepEqual(grid[0].cells[0].outputs, [["o1", "o3"]]);
	assert.deepEqual(grid[1].cells[0].outputs, [49.5]);
	const summary = s.get("summary");
	assert.match(summary, /^2 filters, 2 inputs, 2 expectations: 1 pass, 1 fail, 2 cells unset, 0 errors\./);
	assert.match(summary, /i1: \{.*orders: \[\{.*total: number.*\}\]/);
	assert.match(summary, /f1: \[\.orders\[\] \| select/);
	assert.match(summary, /f2 on i2: 0/);
});

test("set_filter answers with the grid; a syntax error is invalid, a bad id changes nothing", async () => {
	const s = await session(await agent(ID), "orders");
	const out = await s.json("set_filter", { id: "f1", filter: ".orders[] | select(.status == \"paid\") | .id" });
	assert.deepEqual(out[0].cells[0], { input: "i1", status: "fail", outputs: ["o1", "o3"], error: "", more: false, expected: [["o1", "o3"]] });
	assert.equal(s.get("headline"), "0 pass · 2 fail · 2 unset · 0 errors");
	await s.call("set_filter", { id: "f2", filter: ".orders | map(.total) | add // 0" });
	assert.equal(s.get("headline"), "1 pass · 1 fail · 2 unset · 0 errors");
	await s.call("set_filter", { id: "f2", filter: ".orders[" });
	assert.match(s.get("filter_rows")[1].error, /compile error/);
	assert.match(s.get("summary"), /f2: \.orders\[ \(error: jq: error: syntax error/);
	// f2's pinned cell fails, its other cell is invalid.
	assert.equal(s.get("headline"), "0 pass · 2 fail · 1 unset · 1 errors");
	const before = s.get("filters");
	assert.equal((await s.call("set_filter", { id: "nope", filter: "." })).isError, true);
	assert.deepEqual(s.get("filters"), before);
	assert.deepEqual(s.host.issues, []);
});

test("a runtime error shows in the cell; endless outputs stop at 100", async () => {
	const s = await session(await agent(ID), "orders");
	await s.call("add_filter", { filter: ".customer.name" });
	await s.call("add_filter", { filter: "range(1000)" });
	const grid = await s.json("outputs");
	assert.equal(grid[2].filter, "f3");
	assert.equal(grid[2].cells[0].status, "error");
	assert.match(grid[2].cells[0].error, /Cannot index string with string \("name"\)/);
	assert.equal(grid[3].cells[0].outputs.length, 100);
	assert.equal(grid[3].cells[0].more, true);
	assert.deepEqual(s.host.issues, []);
});

test("inputs: set, added, edited as text (kept while it isn't JSON), removed with their pins", async () => {
	const s = await session(await agent(ID), "orders");
	await s.call("set_input", { id: "i2", value: { orders: [] , customer: "grace", extra: 0 } });
	assert.equal(s.get("headline"), "1 pass · 1 fail · 2 unset · 0 errors");
	await s.call("set_expected", { filter: "f2", input: "i2", outputs: [null] });
	assert.equal(s.get("headline"), "2 pass · 0 fail · 2 unset · 0 errors");
	await s.call("add_input", { value: [1, 2] });
	assert.deepEqual(s.get("inputs")[2], { id: "i3", value: [1, 2] });
	s.send("set_input_text", "i3", "[1, 2");
	assert.deepEqual(s.get("inputs")[2].value, [1, 2]);
	assert.equal(s.get("input_rows")[2].text, "[1, 2");
	assert.ok(s.get("input_rows")[2].error !== "");
	assert.equal((await s.json("outputs"))[0].cells[2].status, "invalid");
	assert.equal((await s.call("input_shape", { input: "i3" })).isError, true);
	s.send("set_input_text", "i3", "[1, 2, 3]");
	assert.deepEqual(s.get("inputs")[2].value, [1, 2, 3]);
	assert.equal(s.get("input_rows")[2].error, "");
	await s.call("remove_input", { id: "i1" });
	assert.deepEqual(s.get("expected").map((e) => e.input), ["i2"]);
	assert.deepEqual(s.get("data").inputs.map((x) => x.id), ["i2", "i3"]);
	assert.equal((await s.call("remove_input", { id: "nope" })).isError, true);
	assert.deepEqual(s.host.issues, []);
});

test("expectations: set, replaced, cleared, toggled from the grid", async () => {
	const s = await session(await agent(ID), "orders");
	await s.call("set_expected", { filter: "f2", input: "i1", outputs: [50] });
	assert.equal((await s.json("outputs"))[1].cells[0].status, "fail");
	await s.call("set_expected", { filter: "f2", input: "i1", outputs: [49.5] });
	assert.equal(s.get("expected").length, 3);
	assert.equal(s.get("headline"), "2 pass · 1 fail · 1 unset · 0 errors");
	await s.call("clear_expected", { filter: "f2", input: "i1" });
	assert.equal(s.get("expected").length, 2);
	assert.equal((await s.call("clear_expected", { filter: "f2", input: "i1" })).isError, true);
	assert.equal((await s.call("set_expected", { filter: "f9", input: "i1", outputs: [] })).isError, true);
	// Cells: a header row (corner, i1, i2), then f1's label and its 2 cells: f1 × i2 is 5.
	s.send("toggle_cell", 5);
	assert.deepEqual(s.get("expected")[2], { filter: "f1", input: "i2", outputs: [[]] });
	s.send("toggle_cell", 4);
	assert.deepEqual(s.get("expected").map((e) => `${e.filter}/${e.input}`), ["f2/i2", "f1/i2"]);
	assert.deepEqual(s.host.issues, []);
});

test("removing a filter drops its pins; reorder moves it", async () => {
	const s = await session(await agent(ID), "orders");
	await s.call("remove_filter", { id: "f1" });
	assert.deepEqual(s.get("expected").map((e) => e.filter), ["f2"]);
	await s.call("add_filter", { filter: ".customer" });
	await s.call("reorder_filters", { id: "f3", index: 0 });
	assert.deepEqual(s.get("filters").map((f) => f.id), ["f3", "f2"]);
	assert.equal((await s.call("remove_filter", { id: "f2" })).isError, false);
	// The last filter stays.
	assert.equal((await s.call("remove_filter", { id: "f3" })).isError, true);
	assert.deepEqual(s.host.issues, []);
});

test("input_shape and get_input read an input; bad ids and pointers say so", async () => {
	const s = await session(await agent(ID), "orders");
	assert.match((await s.json("input_shape", { input: "i2" })).shape, /^\{(customer: string, orders: \[\]|orders: \[\], customer: string)\}$/);
	assert.deepEqual(await s.json("get_input", { input: "i1", pointer: "/orders/1/total" }), { value: 12.5 });
	assert.deepEqual(await s.json("get_input", { input: "i2", pointer: "" }), { value: { customer: "grace", orders: [] } });
	assert.equal((await s.call("get_input", { input: "i1", pointer: "/orders/9" })).isError, true);
	assert.equal((await s.call("input_shape", { input: "nope" })).isError, true);
});

test("the shown outputs follow the focused filter, with the pins", async () => {
	const s = await session(await agent(ID), "orders");
	assert.deepEqual(s.get("shown").map((r) => r.label), ["i1 outputs", "i1 expected", "i2 outputs"]);
	s.send("focus", "f2");
	assert.equal(s.get("focus_label"), "f2");
	assert.deepEqual(s.get("shown")[0], { label: "i1 outputs", text: "[\n  49.5\n]", status: "ok" });
	s.send("focus", "f2");
	assert.equal(s.get("focus_label"), "f1");
});
