import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../components/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "cron-lab";

test("the schedules sample matches cron-lab, the empty one decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "schedules"));
	assert.ok(matches.some((m) => m.agent.id === ID));
	const { d } = drive(registry, agent, "empty");
	assert.equal(d.state.crons.items.length, 0);
});

test("decode then encode gives back the same bytes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of ["empty", "schedules"]) {
		const msg = registry.sample(agent, id);
		const out = registry.encode(agent, registry.open(agent, msg), msg);
		assert.equal(encodeMessage(out), encodeMessage(msg));
	}
});

test("expressions are parsed, described and run forward in UTC", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "schedules");
	const s = d.state;
	assert.equal(s.headline, "5 expressions · 1 invalid · 2 pass · 0 fail");
	const standup = s.explain("standup");
	assert.equal(standup.description, "At 09:30 on Monday through Friday");
	assert.deepEqual(standup.fields.weekday.values, [1, 2, 3, 4, 5]);
	assert.deepEqual(standup.next.slice(0, 3), [
		"2025-03-10T09:30Z",
		"2025-03-11T09:30Z",
		"2025-03-12T09:30Z",
	]);
	assert.equal(s.explain("backup").description, "At 00:00");
	assert.deepEqual(s.next_runs("backup", 2).runs, ["2025-01-02T00:00Z", "2025-01-03T00:00Z"]);
	assert.equal(s.explain("poll").description, "Every 15 minutes, during hours 8 through 18");
	assert.equal(
		s.explain("report").description,
		"At 06:00 on day 1 of the month in January, April, July and October",
	);
	assert.deepEqual(s.next_runs("report", 2).runs, ["2025-01-01T06:00Z", "2025-04-01T06:00Z"]);
	const broken = s.explain("broken");
	assert.equal(broken.field, "minute");
	assert.match(broken.error, /minute: 61 is out of range 0-59/);
	assert.deepEqual(s.next_runs("nope", 3), { error: "no cron nope" });
});

test("day and weekday both restricted run on either; steps and lists", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "empty");
	d.send(ROOT, "add_cron", ["0 12 13 * FRI"]);
	d.send(ROOT, "add_cron", ["5,35 */6 * * 0"]);
	d.send(ROOT, "add_cron", ["0 9 * * 1"]);
	d.send(ROOT, "add_cron", ["0 0 30 FEB *"]);
	d.send(ROOT, "add_cron", ["1 2 3"]);
	d.drain();
	const s = d.state;
	// 2025-01-01 is a Wednesday: the first Friday is the 3rd, then the 10th, the 13th (a Monday).
	assert.deepEqual(s.next_runs("c1", 3).runs, [
		"2025-01-03T12:00Z",
		"2025-01-10T12:00Z",
		"2025-01-13T12:00Z",
	]);
	assert.equal(s.explain("c1").description, "At 12:00 on day 13 of the month or on Friday");
	assert.deepEqual(s.next_runs("c2", 3).runs, [
		"2025-01-05T00:05Z",
		"2025-01-05T00:35Z",
		"2025-01-05T06:05Z",
	]);
	assert.equal(s.explain("c2").description, "At minutes 5 and 35, every 6 hours on Sunday");
	assert.equal(s.explain("c3").description, "At 09:00 on Monday");
	assert.deepEqual(s.next_runs("c4", 3).runs, []);
	assert.match(s.explain("c5").error, /expected 5 fields/);
	assert.deepEqual(d.problems, []);
});

test("the builder's chips edit a field", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "schedules");
	d.send(ROOT, "set_field", ["standup", "weekday", "1,3,5"]);
	d.drain();
	assert.equal(d.state.cronById("standup").expression, "30 9 * * 1,3,5");
	d.send(ROOT, "set_field", ["backup", "hour", "3"]);
	d.drain();
	assert.equal(d.state.cronById("backup").expression, "0 3 * * *");
	// A chip click: Wednesday off, then Sunday on.
	const standup = new Selector().field("crons").item("items", 0);
	d.send(standup, "toggle", ["weekday", 3]);
	d.send(standup, "toggle", ["weekday", 0]);
	d.drain();
	assert.equal(d.state.cronById("standup").expression, "30 9 * * 0,1,5");
	assert.match(d.rootNode.textContent, /At 09:30 on Sunday, Monday and Friday/);
	d.send(standup, "toggle", ["weekday", 3]);
	d.drain();
	assert.deepEqual(
		d.state.cronById("standup").weekdayChips.map((c) => c.cls.includes("btn-primary")),
		[true, true, false, true, false, true, false],
	);
	assert.deepEqual(d.problems, []);
});

test("an edit changes only its part", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "schedules");
	d.send(ROOT, "set_expression", ["report", "0 7 1 */3 *"]);
	d.send(ROOT, "set_expected_next", ["backup", "2025-01-02T00:00:00Z"]);
	d.drain();
	assert.equal(d.state.counts.pass, 3);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0], message.messages[0]);
	assert.equal(out.messages[2], message.messages[2]);
	assert.equal(out.messages[3].data.get("expression"), "0 7 1 */3 *");
	assert.equal(out.messages[3].meta.get("x/notes").get("why"), "quarterly report");
	assert.equal(
		out.messages[1].meta.get("https://tutuca.dev/d/expect").get("next"),
		"2025-01-02T00:00:00Z",
	);
	assert.deepEqual(d.problems, []);
});

test("tools set and read expressions; a bad id is an error", async () => {
	const { call, text, env } = await toolRunner(ID, "schedules");
	const r = await call("set_expression", { id: "broken", expression: "0 22 * * SAT,SUN" });
	assert.equal(r.isError, false);
	assert.equal(env.root().cronById("broken").description, "At 22:00 on Saturday and Sunday");
	const f = await call("set_field", { id: "poll", field: "minute", value: "0" });
	assert.equal(f.isError, false);
	assert.equal(env.root().cronById("poll").expression, "0 8-18 * * *");
	assert.equal((await call("add_cron", { expression: "@weekly" })).isError, false);
	assert.equal(env.root().cronById("c6").description, "At 00:00 on Sunday");
	const runs = JSON.parse(text(await call("next_runs", { id: "c6", count: 2 })));
	assert.deepEqual(runs.runs, ["2025-01-05T00:00Z", "2025-01-12T00:00Z"]);
	assert.match(text(await call("explain", { id: "standup" })), /Monday through Friday/);
	assert.equal(
		(await call("set_expression", { id: "nope", expression: "* * * * *" })).isError,
		true,
	);
	assert.equal(
		(await call("set_field", { id: "poll", field: "second", value: "1" })).isError,
		true,
	);
	assert.equal((await call("explain", { id: "nope" })).isError, true);
	assert.equal((await call("remove_cron", { id: "c6" })).isError, false);
	assert.equal(env.root().crons.items.length, 5);
});

test("a set_expression call shows the expression, its meaning and next run", async () => {
	const { call, agent } = await toolRunner(ID, "schedules");
	const args = { id: "backup", expression: "0 3 * * MON" };
	const result = await call("set_expression", args);
	const view = agent.scope.make("SetExpressionCall", {
		call: { type: "toolCall", id: "c1", name: "set_expression", arguments: args },
		result,
		kind: "message",
	});
	assert.equal(view.next, "2025-01-06T03:00Z");
	const d = new Driver({ root: view, document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		// The shared frame has one glimpse: the expression and its meaning, joined by " · ".
		/messageset_expressionbackup = 0 3 \* \* MON · At 03:00 on Mondaynext 2025-01-06T03:00Z/,
	);
	const bad = agent.scope.make("SetExpressionCall", {
		call: { id: "c2", name: "set_expression", arguments: { id: "x", expression: "1 2" } },
		result: null,
		kind: "message",
	});
	assert.equal(bad.state, "running");
	assert.match(bad.meaning, /expected 5 fields/);
	assert.deepEqual(d.problems, []);
});

test("reorder_crons moves an expression, and encode writes the new order", async () => {
	const { call, env, registry, agent, message } = await toolRunner(ID, "schedules");
	assert.equal((await call("reorder_crons", { id: "broken", index: 1 })).isError, false);
	assert.equal((await call("reorder_crons", { id: "nope", index: 0 })).isError, true);
	const ids = ["standup", "broken", "backup", "poll", "report"];
	assert.deepEqual(
		env.root().crons.items.map((c) => c.id),
		ids,
	);
	const out = registry.encode(agent, env.root(), message);
	assert.deepEqual(
		out.messages.map((m) => m.id),
		ids,
	);
	assert.equal(out.messages[1], message.messages[4]);
});

test("the list: drag to reorder, the remove button and the add button", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "schedules");
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="crons"]');
	dispatchDrag(handles()[0], handles()[2].parentNode);
	d.drain();
	assert.deepEqual(
		d.state.crons.items.map((c) => c.id),
		["backup", "standup", "poll", "report", "broken"],
	);
	[...d.rootNode.querySelectorAll('button[title="Remove"]')][4].click();
	d.drain();
	[...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === "+ Expression").click();
	d.drain();
	assert.deepEqual(d.state.crons.items.map((c) => `${c.id} ${c.expression}`).slice(3), [
		"report 0 6 1 JAN,APR,JUL,OCT *",
		"c5 * * * * *",
	]);
	assert.deepEqual(d.problems, []);
	assert.deepEqual(
		registry.encode(agent, d.state, message).messages.map((m) => m.id),
		["backup", "standup", "poll", "report", "c5"],
	);
});

test("cron-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});
