// vega-lite-lab: the compile report, the spec's edits, the tables and their preview.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "vega-lite-lab";

test("the sales sample compiles; the summary lists the tables and their columns", async () => {
	const s = await session(await agent(ID), "sales");
	assert.equal(s.get("headline"), "compiles · 0 warnings");
	const summary = s.get("summary");
	assert.match(summary, /^Vega-Lite spec: compiles · 0 warnings\./);
	assert.match(summary, /sales · table · 8 rows: month: date, revenue: integer, region: string/);
	assert.match(summary, /targets · csv · 2 rows: region: string, target: integer/);
	const report = await s.json("compile_report");
	assert.deepEqual(report, { ok: true, errors: [], warnings: [], marks: ["rect"], tables: ["sales", "targets"] });
	assert.equal(s.get("can_render"), true);
});

test("the weather sample warns about a field no table has; its CSV reads with its delimiter", async () => {
	const s = await session(await agent(ID), "weather");
	assert.equal(s.get("headline"), "compiles · 1 warnings");
	assert.deepEqual(s.get("warning_list"), [
		{ text: 'field "precip" isn\'t a column of any table (columns: date, temp_max, temp_min, precipitation, weather)' },
	]);
	assert.equal(s.get("preview_title"), "seattle · csv · 10 rows (showing 8)");
	assert.equal(s.get("preview_rows").length, 8);
	assert.deepEqual(s.get("preview_rows")[0].cells.map((c) => c.text), ["2024-01-01", "12.8", "5", "0", "drizzle"]);
	await s.call("patch_spec", { pointer: "/encoding/tooltip/2/field", value: "precipitation" });
	assert.equal(s.get("headline"), "compiles · 0 warnings");
	assert.deepEqual(s.host.issues, []);
});

test("the chart spec inlines the named table's rows as data.values", async () => {
	const s = await session(await agent(ID), "sales");
	const chart = JSON.parse(s.get("chart_spec"));
	assert.equal(chart.data.name, "sales");
	assert.equal(chart.data.values.length, 8);
	assert.deepEqual(chart.data.values[0], { month: "2024-01", region: "North", revenue: 120 });
	assert.equal(chart.mark, "bar");
});

test("the empty sample doesn't compile yet, and says why", async () => {
	const s = await session(await agent(ID), "empty");
	assert.equal(s.get("headline"), "1 errors");
	assert.match(s.get("error_list")[0].text, /Invalid specification/);
	assert.equal(s.get("can_render"), false);
	assert.equal(s.get("chart_spec"), "");
	assert.equal(s.get("has_tables"), false);
});

test("patch_spec sets a value and answers with the report; a bad pointer or a JSON-text value changes nothing", async () => {
	const s = await session(await agent(ID), "sales");
	const out = await s.json("patch_spec", { pointer: "/mark", value: "line" });
	assert.equal(out.ok, true);
	assert.equal(s.get("spec").mark, "line");
	const missing = await s.call("patch_spec", { pointer: "/encoding/size/field", value: "revenue" });
	assert.equal(missing.isError, true);
	assert.match(missing.content[0].text, /set \/encoding\/size to the whole object/);
	assert.equal(s.get("spec").encoding.size, undefined);
	const text = await s.call("patch_spec", { pointer: "/encoding/size", value: '{"field": "revenue"}' });
	assert.equal(text.isError, true);
	assert.match(text.content[0].text, /JSON text for an object/);
	assert.equal((await s.call("patch_spec", { pointer: "mark", value: "bar" })).isError, true);
	assert.equal(s.get("spec").mark, "line");
	// A later edit that works clears the error.
	assert.equal((await s.json("patch_spec", { pointer: "/encoding/size", value: { field: "revenue", type: "quantitative" } })).ok, true);
	assert.deepEqual(s.host.issues, []);
});

test("an unknown mark is an error, a bad aggregate a Vega-Lite warning", async () => {
	const s = await session(await agent(ID), "sales");
	const bad = await s.json("patch_spec", { pointer: "/mark", value: "barr" });
	assert.equal(bad.ok, false);
	assert.match(bad.errors[0], /unknown mark "barr"/);
	assert.equal(s.get("can_render"), false);
	await s.call("patch_spec", { pointer: "/mark", value: "bar" });
	const report = await s.json("patch_spec", { pointer: "/encoding/y/aggregate", value: "summ" });
	assert.ok(report.warnings.some((w) => /summ/.test(w)), JSON.stringify(report));
});

test("remove_spec_key and set_spec; an empty spec is rejected", async () => {
	const s = await session(await agent(ID), "sales");
	await s.call("remove_spec_key", { pointer: "/encoding/color" });
	assert.equal(s.get("spec").encoding.color, undefined);
	assert.equal((await s.call("remove_spec_key", { pointer: "/encoding/color" })).isError, true);
	assert.equal((await s.call("set_spec", { spec: {} })).isError, true);
	const out = await s.json("set_spec", { spec: { data: { name: "targets" }, mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "target", type: "quantitative" } } } });
	assert.equal(out.ok, true);
	assert.equal(s.get("spec").data.name, "targets");
});

test("the editor keeps text that isn't a spec, and the spec stays the last good one", async () => {
	const s = await session(await agent(ID), "sales");
	s.send("set_spec_text", '{"mark": ');
	assert.equal(s.get("editor_text"), '{"mark": ');
	assert.notEqual(s.get("spec_error"), "");
	assert.equal(s.get("spec").mark, "bar");
	assert.match(s.get("summary"), /the editor's text isn't a spec yet/);
	s.send("set_spec_text", '{"mark": "point", "data": {"name": "sales"}}');
	assert.equal(s.get("spec_error"), "");
	assert.equal(s.get("spec").mark, "point");
});

test("tables: set_table adds and replaces (a CSV table stays CSV), remove and reorder check the id", async () => {
	const s = await session(await agent(ID), "sales");
	await s.call("set_table", { id: "costs", rows: [{ month: "2024-01", cost: 10 }] });
	assert.deepEqual(s.get("tables").map((t) => t.id), ["sales", "targets", "costs"]);
	await s.call("set_table", { id: "targets", rows: [{ region: "East", target: 3 }] });
	const targets = s.get("tables")[1];
	assert.equal(typeof targets.csv, "string");
	assert.match(targets.csv, /East/);
	assert.equal((await s.call("set_table", { id: "bad id", rows: [] })).isError, true);
	await s.call("reorder_tables", { id: "costs", index: 0 });
	assert.deepEqual(s.get("tables").map((t) => t.id), ["costs", "sales", "targets"]);
	const bad = await s.call("remove_table", { id: "nope" });
	assert.equal(bad.isError, true);
	assert.equal(s.get("tables").length, 3);
	assert.equal((await s.call("reorder_tables", { id: "nope", index: 0 })).isError, true);
	s.send("focus", "costs");
	assert.equal(s.get("table_rows")[0].on, true);
	await s.call("remove_table", { id: "costs" });
	assert.deepEqual(s.get("tables").map((t) => t.id), ["sales", "targets"]);
	assert.equal(s.get("focus"), "");
	assert.deepEqual(s.host.issues, []);
});

test("removing the table the spec names makes it an error", async () => {
	const s = await session(await agent(ID), "sales");
	await s.call("remove_table", { id: "sales" });
	const report = await s.json("compile_report");
	assert.equal(report.ok, false);
	assert.match(report.errors[0], /data name "sales" isn't a table; the tables are targets/);
});

test("describe_tables gives each column's type and range, and sample rows", async () => {
	const s = await session(await agent(ID), "sales");
	const [sales, targets] = await s.json("describe_tables");
	assert.equal(sales.rows, 8);
	assert.deepEqual(sales.columns.find((c) => c.name === "revenue"), { name: "revenue", type: "integer", min: 88, max: 150, distinct: 8, nulls: 0 });
	assert.equal(sales.sample.length, 3);
	assert.equal(targets.kind, "csv");
});
