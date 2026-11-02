import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../components/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, loadAgents, ROOT, toolRunner } from "./helpers.js";

const ID = "echarts-lab";
const SAMPLES = ["empty", "temperatures", "sales"];

test("every sample but empty matches, and empty decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of SAMPLES.slice(1)) {
		const ids = registry.match(registry.sample(agent, id)).matches.map((m) => m.agent.id);
		assert.ok(ids.includes(ID), id);
	}
	assert.equal(registry.match(registry.sample(agent)).matches.length, 0);
	const { d } = drive(registry, agent);
	assert.equal(d.state.optionText, "");
	assert.equal(d.state.canRender, false);
});

test("the sales sample has a spec for each chart agent and opens with both", async () => {
	const registry = await loadAgents(["vega-lite-lab", ID]);
	const msg = registry.sample(registry.get(ID), "sales");
	const { matches } = registry.match(msg);
	assert.deepEqual(matches.map((m) => m.agent.id).sort(), [ID, "vega-lite-lab"]);
	for (const { agent } of matches) {
		const root = registry.open(agent, msg);
		assert.equal(root.canRender, true, agent.id);
		assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg));
	}
});

test("decode then encode gives back the same bytes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of SAMPLES) {
		const msg = registry.sample(agent, id);
		const root = registry.open(agent, msg);
		assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg), id);
	}
});

test("the temperatures option draws with a warning, and a patch fixes it", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "temperatures");
	const report = d.state.compile_report;
	assert.equal(report.ok, true);
	assert.ok(report.svgBytes > 1000);
	assert.ok(report.warnings.some((w) => w.includes('"londn"')));
	assert.ok(d.state.chartOption.includes('"dataset":[{"id":"climate","source":[{"month":"Jan"'));
	d.send(ROOT, "patch_option", ["/series/1/encode/y", "london"]);
	d.drain();
	assert.deepEqual(d.state.compile_report.warnings, []);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0], message.messages[0]); // the table didn't change
	assert.equal(out.messages[1].data.get("series")[1].get("encode").get("y"), "london");
	assert.equal(out.messages[1].meta, message.messages[1].meta);
});

test("unknown series types and dataset ids are errors", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "temperatures");
	d.send(ROOT, "patch_option", ["/series/0/type", "lin"]);
	d.send(ROOT, "patch_option", ["/series/1/datasetId", "nope"]);
	d.drain();
	const { ok, errors } = d.state.compile_report;
	assert.equal(ok, false);
	assert.equal(errors.length, 2);
	assert.equal(d.state.chartOption, "");
	assert.deepEqual(d.problems, []);
});

test("the empty lab grows an option and a table", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent);
	d.send(ROOT, "set_table", [
		"fruit",
		[
			{ name: "apple", n: 3 },
			{ name: "pear", n: 5 },
		],
	]);
	d.send(ROOT, "set_option", [
		{ series: [{ type: "pie", datasetId: "fruit", encode: { itemName: "name", value: "n" } }] },
	]);
	d.drain();
	assert.equal(d.state.canRender, true);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.deepEqual(
		out.messages.map((m) => `${m.id}:${m.kind}`),
		["option:echarts", "fruit:table"],
	);
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
});

test("tools: set_option, patch_option, describe_tables, and bad input", async () => {
	const { call, text, env } = await toolRunner(ID, "sales");
	assert.equal(JSON.parse(text(await call("compile_report"))).ok, true);
	const bad = await call("patch_option", { pointer: "/nope/0/x", value: 1 });
	assert.equal(bad.isError, true);
	const missing = await call("remove_table", { id: "nope" });
	assert.equal(missing.isError, true);
	const notObject = await call("set_option", { option: [1, 2] });
	assert.equal(notObject.isError, true);
	const fixed = await call("set_option", {
		option: {
			xAxis: { type: "category" },
			yAxis: {},
			series: [{ type: "bar", datasetId: "north", encode: { x: "month", y: "revenue" } }],
			dataset: [
				{
					id: "north",
					fromDatasetId: "sales",
					transform: { type: "filter", config: { dimension: "region", "=": "North" } },
				},
			],
		},
	});
	assert.deepEqual(JSON.parse(text(fixed)).warnings, []);
	assert.equal(JSON.parse(text(fixed)).ok, true);
	const tables = JSON.parse(text(await call("describe_tables")));
	assert.deepEqual(
		tables.map((x) => x.id),
		["sales", "targets"],
	);
	assert.equal(tables[1].columns[1].max, 520);
	assert.ok(env.root().summary.includes("ECharts option targets-chart: draws"));
});

test("the option editor is a JsonView whose edits are the option's text", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "temperatures");
	// The editor opens as a tree; its Raw view is the textarea.
	assert.equal(d.rootNode.querySelector("textarea"), null);
	[...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Raw").click();
	d.drain();
	const box = d.rootNode.querySelector("textarea");
	assert.ok(box.value.includes('"series"'));
	const option = {
		xAxis: { type: "category" },
		yAxis: {},
		series: [{ type: "bar", datasetId: "climate", encode: { x: "month", y: "london" } }],
	};
	box.value = JSON.stringify(option);
	box.dispatchEvent(new box.ownerDocument.defaultView.Event("input", { bubbles: true }));
	d.drain();
	assert.equal(d.state.compile_report.ok, true);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[1].data.get("series")[0].get("type"), "bar");
	d.send(ROOT, "remove_option_key", ["/series/0/encode"]);
	d.drain();
	const removed = { ...option, series: [{ type: "bar", datasetId: "climate" }] };
	assert.equal(d.state.optionView.text, JSON.stringify(removed, null, 2));
	const empty = drive(registry, agent).d;
	const emptyBox = empty.rootNode.querySelector("textarea");
	emptyBox.value = "{}";
	emptyBox.dispatchEvent(new box.ownerDocument.defaultView.Event("input", { bubbles: true }));
	empty.drain();
	assert.equal(empty.state.optionId, "option");
});

test("the chat shows patch_option and set_option in the option's terms", async () => {
	const { call, agent } = await toolRunner(ID, "temperatures");
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
		await line("PatchOptionCall", "patch_option", {
			pointer: "/series/1/encode/y",
			value: "london",
		}),
		'messagepatch_option/series/1/encode/y = "london"draws · 0 warnings',
	);
	assert.match(
		await line("PatchOptionCall", "patch_option", { pointer: "/nope/0", value: 1 }),
		/^messagepatch_option\/nope\/0 = 1.*can.t run.*the document has no key "nope"/,
	);
	assert.equal(
		await line("SetOptionCall", "set_option", {
			option: { series: [{ type: "lin", datasetId: "climate" }] },
		}),
		"messageset_optionlin climate1 errors",
	);
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

test("echarts-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});

test("a failed patch_option says why, in the pointer's words", async () => {
	const { call } = await toolRunner(ID, "temperatures");
	const r = await call("patch_option", { pointer: "/series/0/lineStyle/color", value: "#e5343b" });
	assert.equal(r.isError, true);
	assert.match(
		r.content[0].text,
		/can't run with these arguments now: \/series\/0 has no key "lineStyle", and a pointer doesn't make the objects on its way: set \/series\/0\/lineStyle to the whole object/,
	);
	const style = { color: "#3465e5" };
	assert.equal(
		(await call("patch_option", { pointer: "/series/0/lineStyle", value: style })).isError,
		false,
	);
});

test("a t.any() parameter says it takes JSON as itself, not encoded", async () => {
	const { typeSchema } = await import("../../components/microagents/core/tool-schema.js");
	const { t } = await import("../../src/tutuca.js");
	const schema = typeSchema(t.any());
	assert.match(schema.description, /Don't encode it as a JSON string/);
	// Every JSON type, named: with no type, GLM's tool-call parser passes objects as JSON text.
	assert.deepEqual(schema.type, ["object", "array", "string", "number", "boolean", "null"]);
});

test("an object sent as JSON text is refused, saying to send the object itself", async () => {
	const { call, host } = await toolRunner(ID, "temperatures");
	const before = host.root.optionText;
	const set = await call("set_option", { option: '{"series": [{"type": "line"}]}' });
	assert.equal(set.isError, true);
	assert.match(
		set.content[0].text,
		/option is a string holding JSON text for an object; send the object itself/,
	);
	const patch = await call("patch_option", {
		pointer: "/series/0/itemStyle",
		value: '{"color": "red"}',
	});
	assert.equal(patch.isError, true);
	assert.match(patch.content[0].text, /the value is a string holding JSON text for an object/);
	assert.equal(host.root.optionText, before);
	// A string that only looks like JSON is a string.
	const name = await call("patch_option", { pointer: "/series/0/name", value: "{not json" });
	assert.equal(name.isError, false);
});
