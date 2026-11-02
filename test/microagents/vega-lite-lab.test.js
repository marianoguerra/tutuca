import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../apps/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, loadAgents, ROOT, toolRunner } from "./helpers.js";

const ID = "vega-lite-lab";
const SAMPLES = ["empty", "weather", "sales"];

test("every sample but empty matches, and empty decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of SAMPLES.slice(1)) {
		const ids = registry.match(registry.sample(agent, id)).matches.map((m) => m.agent.id);
		assert.ok(ids.includes(ID), id);
	}
	assert.equal(registry.match(registry.sample(agent)).matches.length, 0);
	const { d } = drive(registry, agent);
	assert.equal(d.state.specText, "");
	assert.equal(d.state.canRender, false);
});

test("the sales sample opens with both chart agents", async () => {
	const registry = await loadAgents([ID, "echarts-lab"]);
	const msg = registry.sample(registry.get(ID), "sales");
	assert.deepEqual(
		registry
			.match(msg)
			.matches.map((m) => m.agent.id)
			.sort(),
		["echarts-lab", ID],
	);
});

test("decode then encode gives back the same bytes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of SAMPLES) {
		const msg = registry.sample(agent, id);
		const root = registry.open(agent, msg);
		assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg), id);
	}
});

test("the weather spec compiles with a warning, and a patch fixes it", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "weather");
	const table = d.state.tables.items[0];
	assert.equal(table.kind, "csv");
	assert.deepEqual(
		table.columns.map((c) => `${c.name}:${c.type}`),
		["date:date", "temp_max:number", "temp_min:number", "precipitation:number", "weather:string"],
	);
	assert.equal(d.state.compile_report.ok, true);
	assert.ok(d.state.compile_report.warnings.some((w) => w.includes('"precip"')));
	assert.ok(d.state.chartSpec.includes('"datasets":{"seattle":'));
	d.send(ROOT, "patch_spec", ["/encoding/tooltip/2/field", "precipitation"]);
	d.drain();
	assert.deepEqual(d.state.compile_report.warnings, []);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0], message.messages[0]); // the table didn't change
	assert.equal(
		out.messages[1].data.get("encoding").get("tooltip")[2].get("field"),
		"precipitation",
	);
	assert.equal(out.messages[1].meta, message.messages[1].meta);
});

test("an edited csv table is written back as csv with its delimiter", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "weather");
	d.send(ROOT, "set_table", ["seattle", [{ date: "2024-02-01", temp_max: 9.5, weather: "sun" }]]);
	d.drain();
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0].data, "date;temp_max;weather\n2024-02-01;9.5;sun");
	assert.equal(out.messages[1], message.messages[1]);
});

test("the empty lab grows a spec and a table", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent);
	d.send(ROOT, "set_table", [
		"pts",
		[
			{ a: 1, b: 2 },
			{ a: 2, b: 5 },
		],
	]);
	d.send(ROOT, "set_spec", [
		{
			data: { name: "pts" },
			mark: "point",
			encoding: {
				x: { field: "a", type: "quantitative" },
				y: { field: "b", type: "quantitative" },
			},
		},
	]);
	d.drain();
	assert.equal(d.state.canRender, true);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.deepEqual(
		out.messages.map((m) => `${m.id}:${m.kind}`),
		["spec:vega-lite", "pts:table"],
	);
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
});

test("tools: set_spec, patch_spec, describe_tables, render_svg, and bad input", async () => {
	const { call, text, env } = await toolRunner(ID, "sales");
	const report = await call("compile_report");
	assert.equal(JSON.parse(text(report)).ok, true);
	const bad = await call("patch_spec", { pointer: "/nope/x/field", value: "a" });
	assert.equal(bad.isError, true);
	const missing = await call("remove_table", { id: "nope" });
	assert.equal(missing.isError, true);
	const wrong = await call("patch_spec", { pointer: "/mark", value: "barr" });
	assert.equal(wrong.isError, false);
	assert.ok(JSON.parse(text(wrong)).errors[0].includes("unknown mark"));
	const fixed = await call("set_spec", {
		spec: {
			data: { name: "targets" },
			mark: "bar",
			encoding: {
				x: { field: "region", type: "nominal" },
				y: { field: "target", type: "quantitative" },
			},
		},
	});
	assert.equal(JSON.parse(text(fixed)).ok, true);
	const tables = JSON.parse(text(await call("describe_tables")));
	const revenue = tables[0].columns.find((c) => c.name === "revenue");
	assert.deepEqual(
		[revenue.type, revenue.min, revenue.max, revenue.distinct],
		["integer", 88, 150, 8],
	);
	assert.equal(tables[1].sample[0].target, 520);
	const svg = JSON.parse(text(await call("render_svg")));
	assert.equal(svg.ok, true);
	assert.ok(svg.svgBytes > 500);
	assert.ok(env.root().summary.includes("targets (csv · 2 rows)"));
});

test("the spec editor is a JsonView whose edits are the spec's text", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "weather");
	assert.equal(d.state.specView.editable, true);
	// The editor opens as a tree; its Raw view is the textarea.
	assert.equal(d.rootNode.querySelector("textarea"), null);
	[...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Raw").click();
	d.drain();
	const box = d.rootNode.querySelector("textarea");
	assert.ok(box.value.includes('"mark"'));
	const spec = { data: { name: "seattle" }, mark: "tick", encoding: { x: { field: "temp_max" } } };
	box.value = JSON.stringify(spec);
	box.dispatchEvent(new box.ownerDocument.defaultView.Event("input", { bubbles: true }));
	d.drain();
	assert.equal(d.state.compile_report.ok, true);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[1].data.get("mark"), "tick");
	d.send(ROOT, "patch_spec", ["/mark", "bar"]);
	d.drain();
	assert.equal(d.state.specView.text, JSON.stringify({ ...spec, mark: "bar" }, null, 2));
	// In the empty lab, the first edit (notified to the root) makes the spec part.
	const empty = drive(registry, agent).d;
	const emptyBox = empty.rootNode.querySelector("textarea");
	emptyBox.value = "{}";
	emptyBox.dispatchEvent(new box.ownerDocument.defaultView.Event("input", { bubbles: true }));
	empty.drain();
	assert.equal(empty.state.specId, "spec");
	assert.equal(empty.state.specText, "{}");
});

test("the chat shows patch_spec and set_spec in the spec's terms", async () => {
	const { call, agent } = await toolRunner(ID, "weather");
	const line = async (name, tool, args) => {
		const result = await call(tool, args);
		const root = agent.scope.make(name, {
			call: { type: "toolCall", id: "x", name: tool, arguments: args },
			result,
			kind: "message",
		});
		const d = new Driver({ root, document });
		assert.deepEqual(d.problems, []);
		return d.rootNode.querySelector("summary").textContent;
	};
	assert.equal(
		await line("PatchSpecCall", "patch_spec", {
			pointer: "/encoding/tooltip/2/field",
			value: "precipitation",
		}),
		'messagepatch_spec/encoding/tooltip/2/field = "precipitation"compiles · 0 warnings',
	);
	assert.match(
		await line("PatchSpecCall", "patch_spec", { pointer: "/nope/x", value: 1 }),
		/^messagepatch_spec\/nope\/x = 1.*can.t run.*the document has no key "nope"/,
	);
	assert.equal(
		await line("SetSpecCall", "set_spec", { spec: { data: { name: "seattle" }, mark: "barr" } }),
		"messageset_specmark: barr · data: seattle1 errors",
	);
	const running = agent.scope.make("SetSpecCall", {
		call: { type: "toolCall", id: "y", name: "set_spec", arguments: {} },
		result: null,
	});
	assert.equal(running.state, "running");
});

test("reorder_tables moves a table, and encode writes the parts in the new order", async () => {
	const { call, env, registry, agent, message } = await toolRunner(ID, "sales");
	assert.equal((await call("reorder_tables", { id: "targets", index: 0 })).isError, false);
	assert.equal((await call("reorder_tables", { id: "nope", index: 0 })).isError, true);
	assert.deepEqual(
		env.root().tables.items.map((x) => x.id),
		["targets", "sales"],
	);
	const out = registry.encode(agent, env.root(), message);
	assert.deepEqual(
		out.messages.map((m) => m.id),
		["targets", "sales", ...message.messages.slice(2).map((m) => m.id)],
	);
	assert.equal(out.messages[0], message.messages[1]);
	assert.equal(out.messages[1], message.messages[0]);
});

test("the table list: drag to reorder and the remove button", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "sales");
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="tables"]');
	assert.equal(handles().length, 2);
	dispatchDrag(handles()[1], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(
		d.state.tables.items.map((x) => x.id),
		["targets", "sales"],
	);
	[...d.rootNode.querySelectorAll('button[title="Remove"]')][1].click();
	d.drain();
	assert.deepEqual(
		d.state.tables.items.map((x) => x.id),
		["targets"],
	);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.deepEqual(
		out.messages.map((m) => m.id),
		["targets", ...message.messages.slice(2).map((m) => m.id)],
	);
});

test("vega-lite-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});
