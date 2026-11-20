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
	assert.match(s.get("chartSvg"), /^<svg width="600" height="400"/);
	const report = await s.json("compileReport");
	assert.equal(report.ok, true);
	assert.deepEqual(report.series, [{ type: "bar", datasetId: "targets" }]);
	assert.deepEqual(report.tables, ["sales", "targets"]);
	assert.ok(report.svgBytes > 1000);
	assert.equal(report.svg, undefined);
});

test("the temperatures sample warns about an encoded column the table doesn't have; patchOption fixes it", async () => {
	const s = await session(await agent(ID), "temperatures");
	assert.equal(s.get("headline"), "draws · 1 warnings");
	assert.deepEqual(s.get("warningList"), [{ text: 'series 1 encodes "londn", but dataset "climate" has columns month, tokyo, london' }]);
	const out = await s.json("patchOption", { pointer: "/series/1/encode/y", value: "london" });
	assert.equal(out.ok, true);
	assert.deepEqual(out.warnings, []);
	assert.equal(s.get("option").series[1].encode.y, "london");
	assert.deepEqual(s.host.issues, []);
});

test("an unknown series type or dataset id is an error, and nothing is drawn", async () => {
	const s = await session(await agent(ID), "temperatures");
	const bad = await s.json("patchOption", { pointer: "/series/0/type", value: "lines2" });
	assert.equal(bad.ok, false);
	assert.match(bad.errors[0], /series 0 has type "lines2"/);
	assert.equal(s.get("canRender"), false);
	assert.equal(s.get("chartSvg"), "");
	await s.call("patchOption", { pointer: "/series/0/type", value: "line" });
	const report = await s.json("patchOption", { pointer: "/series/0/datasetId", value: "nope" });
	assert.match(report.errors[0], /series 0 reads datasetId "nope", which isn't a table or dataset; they are climate/);
});

test("what ECharts throws while drawing is an error", async () => {
	const s = await session(await agent(ID), "temperatures");
	const report = await s.json("removeOptionKey", { pointer: "/xAxis" });
	assert.equal(report.ok, false);
	assert.match(report.errors[0], /^ECharts can't draw the option/);
});

test("a bad pointer, a JSON-text value or an empty option changes nothing and says why", async () => {
	const s = await session(await agent(ID), "temperatures");
	const missing = await s.call("patchOption", { pointer: "/series/0/lineStyle/color", value: "red" });
	assert.equal(missing.isError, true);
	assert.match(missing.content[0].text, /set \/series\/0\/lineStyle to the whole object/);
	assert.equal(s.get("option").series[0].lineStyle, undefined);
	const text = await s.call("patchOption", { pointer: "/series/0/lineStyle", value: '{"color": "red"}' });
	assert.equal(text.isError, true);
	assert.equal((await s.call("removeOptionKey", { pointer: "/nope" })).isError, true);
	assert.equal((await s.call("setOption", { option: {} })).isError, true);
	assert.equal((await s.json("patchOption", { pointer: "/series/0/lineStyle", value: { color: "red" } })).ok, true);
	assert.equal(s.get("option").series[0].lineStyle.color, "red");
	assert.deepEqual(s.host.issues, []);
});

test("setOption replaces the option; a series without datasetId reads the first table", async () => {
	const s = await session(await agent(ID), "empty");
	assert.deepEqual(s.get("warningList"), [{ text: "the option has no series, so nothing is drawn" }]);
	await s.call("setTable", { id: "fruit", rows: [{ name: "apple", n: 3 }, { name: "pear", n: 5 }] });
	const out = await s.json("setOption", { option: { series: [{ type: "pie", encode: { itemName: "name", value: "n" } }] } });
	assert.equal(out.ok, true);
	assert.deepEqual(out.warnings, []);
	assert.match(s.get("chartSvg"), /<path/);
	assert.deepEqual(s.get("data"), {
		option: { series: [{ type: "pie", encode: { itemName: "name", value: "n" } }] },
		tables: [{ id: "fruit", rows: [{ name: "apple", n: 3 }, { name: "pear", n: 5 }] }],
	});
});

test("the editor keeps text that isn't an option", async () => {
	const s = await session(await agent(ID), "temperatures");
	s.send("setOptionText", "[1, 2]");
	assert.equal(s.get("optionError"), "the option must be a JSON object with at least one key");
	assert.equal(s.get("editorText"), "[1, 2]");
	assert.equal(s.get("option").series.length, 2);
});

test("tables: setTable keeps CSV, remove and reorder check the id", async () => {
	const s = await session(await agent(ID), "sales");
	await s.call("setTable", { id: "targets", rows: [{ region: "North", target: 600 }] });
	assert.match(s.get("tables")[1].csv, /600/);
	assert.equal((await s.call("removeTable", { id: "nope" })).isError, true);
	assert.equal((await s.call("reorderTables", { id: "nope", index: 1 })).isError, true);
	await s.call("reorderTables", { id: "targets", index: 0 });
	assert.deepEqual(s.get("tables").map((t) => t.id), ["targets", "sales"]);
	await s.call("removeTable", { id: "sales" });
	const report = await s.json("compileReport");
	assert.match(report.errors[0], /fromDatasetId "sales"/);
	assert.deepEqual(s.host.issues, []);
});

test("describeTables describes the CSV table's columns", async () => {
	const s = await session(await agent(ID), "temperatures");
	const [climate] = await s.json("describeTables");
	assert.equal(climate.kind, "csv");
	assert.equal(climate.rows, 12);
	assert.deepEqual(climate.columns.find((c) => c.name === "tokyo"), { name: "tokyo", type: "number", min: 5.2, max: 26.4, distinct: 12, nulls: 0 });
});
