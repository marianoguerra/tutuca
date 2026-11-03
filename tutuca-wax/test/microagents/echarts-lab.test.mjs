// echarts-lab: the option drawn to SVG without a DOM, its edits, the tables.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "echarts-lab";

test("the sales sample draws to SVG; the summary lists the tables and their columns", async () => {
	const s = await session(await agent(ID), "sales");
	assert.equal(s.get("headline"), "draws · 0 warnings");
	assert.match(s.get("summary"), /^ECharts option: draws · 0 warnings\./);
	assert.match(s.get("summary"), /targets · csv · 2 rows: region: string, target: integer/);
	assert.match(s.get("chart_svg"), /^<svg width="600" height="400"/);
	const report = await s.json("compile_report");
	assert.equal(report.ok, true);
	assert.deepEqual(report.series, [{ type: "bar", datasetId: "targets" }]);
	assert.deepEqual(report.tables, ["sales", "targets"]);
	assert.ok(report.svgBytes > 1000);
	assert.equal(report.svg, undefined);
});

test("the temperatures sample warns about an encoded column the table doesn't have; patch_option fixes it", async () => {
	const s = await session(await agent(ID), "temperatures");
	assert.equal(s.get("headline"), "draws · 1 warnings");
	assert.deepEqual(s.get("warning_list"), [{ text: 'series 1 encodes "londn", but dataset "climate" has columns month, tokyo, london' }]);
	const out = await s.json("patch_option", { pointer: "/series/1/encode/y", value: "london" });
	assert.equal(out.ok, true);
	assert.deepEqual(out.warnings, []);
	assert.equal(s.get("option").series[1].encode.y, "london");
	assert.deepEqual(s.host.issues, []);
});

test("an unknown series type or dataset id is an error, and nothing is drawn", async () => {
	const s = await session(await agent(ID), "temperatures");
	const bad = await s.json("patch_option", { pointer: "/series/0/type", value: "lines2" });
	assert.equal(bad.ok, false);
	assert.match(bad.errors[0], /series 0 has type "lines2"/);
	assert.equal(s.get("can_render"), false);
	assert.equal(s.get("chart_svg"), "");
	await s.call("patch_option", { pointer: "/series/0/type", value: "line" });
	const report = await s.json("patch_option", { pointer: "/series/0/datasetId", value: "nope" });
	assert.match(report.errors[0], /series 0 reads datasetId "nope", which isn't a table or dataset; they are climate/);
});

test("what ECharts throws while drawing is an error", async () => {
	const s = await session(await agent(ID), "temperatures");
	const report = await s.json("remove_option_key", { pointer: "/xAxis" });
	assert.equal(report.ok, false);
	assert.match(report.errors[0], /^ECharts can't draw the option/);
});

test("a bad pointer, a JSON-text value or an empty option changes nothing and says why", async () => {
	const s = await session(await agent(ID), "temperatures");
	const missing = await s.call("patch_option", { pointer: "/series/0/lineStyle/color", value: "red" });
	assert.equal(missing.isError, true);
	assert.match(missing.content[0].text, /set \/series\/0\/lineStyle to the whole object/);
	assert.equal(s.get("option").series[0].lineStyle, undefined);
	const text = await s.call("patch_option", { pointer: "/series/0/lineStyle", value: '{"color": "red"}' });
	assert.equal(text.isError, true);
	assert.equal((await s.call("remove_option_key", { pointer: "/nope" })).isError, true);
	assert.equal((await s.call("set_option", { option: {} })).isError, true);
	assert.equal((await s.json("patch_option", { pointer: "/series/0/lineStyle", value: { color: "red" } })).ok, true);
	assert.equal(s.get("option").series[0].lineStyle.color, "red");
	assert.deepEqual(s.host.issues, []);
});

test("set_option replaces the option; a series without datasetId reads the first table", async () => {
	const s = await session(await agent(ID), "empty");
	assert.deepEqual(s.get("warning_list"), [{ text: "the option has no series, so nothing is drawn" }]);
	await s.call("set_table", { id: "fruit", rows: [{ name: "apple", n: 3 }, { name: "pear", n: 5 }] });
	const out = await s.json("set_option", { option: { series: [{ type: "pie", encode: { itemName: "name", value: "n" } }] } });
	assert.equal(out.ok, true);
	assert.deepEqual(out.warnings, []);
	assert.match(s.get("chart_svg"), /<path/);
	assert.deepEqual(s.get("data"), {
		option: { series: [{ type: "pie", encode: { itemName: "name", value: "n" } }] },
		tables: [{ id: "fruit", rows: [{ name: "apple", n: 3 }, { name: "pear", n: 5 }] }],
	});
});

test("the editor keeps text that isn't an option", async () => {
	const s = await session(await agent(ID), "temperatures");
	s.send("set_option_text", "[1, 2]");
	assert.equal(s.get("option_error"), "the option must be a JSON object with at least one key");
	assert.equal(s.get("editor_text"), "[1, 2]");
	assert.equal(s.get("option").series.length, 2);
});

test("tables: set_table keeps CSV, remove and reorder check the id", async () => {
	const s = await session(await agent(ID), "sales");
	await s.call("set_table", { id: "targets", rows: [{ region: "North", target: 600 }] });
	assert.match(s.get("tables")[1].csv, /600/);
	assert.equal((await s.call("remove_table", { id: "nope" })).isError, true);
	assert.equal((await s.call("reorder_tables", { id: "nope", index: 1 })).isError, true);
	await s.call("reorder_tables", { id: "targets", index: 0 });
	assert.deepEqual(s.get("tables").map((t) => t.id), ["targets", "sales"]);
	await s.call("remove_table", { id: "sales" });
	const report = await s.json("compile_report");
	assert.match(report.errors[0], /fromDatasetId "sales"/);
	assert.deepEqual(s.host.issues, []);
});

test("describe_tables describes the CSV table's columns", async () => {
	const s = await session(await agent(ID), "temperatures");
	const [climate] = await s.json("describe_tables");
	assert.equal(climate.kind, "csv");
	assert.equal(climate.rows, 12);
	assert.deepEqual(climate.columns.find((c) => c.name === "tokyo"), { name: "tokyo", type: "number", min: 5.2, max: 26.4, distinct: 12, nulls: 0 });
});
