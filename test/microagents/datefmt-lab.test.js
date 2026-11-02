import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../components/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "datefmt-lab";

test("the formats sample matches datefmt-lab, the empty one decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "formats"));
	const match = matches.find((m) => m.agent.id === ID);
	assert.ok(match);
	assert.deepEqual(
		match.bindings.get("instants").map((m) => m.id),
		["i1", "i2", "i3"],
	);
	const { d } = drive(registry, agent, "empty");
	assert.equal(d.state.instants.items.length, 0);
	assert.equal(d.state.headline, "0 pass · 0 fail · 0 unset · 0 error");
});

test("decode then encode gives back the same bytes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of ["empty", "formats"]) {
		const msg = registry.sample(agent, id);
		const out = registry.encode(agent, registry.open(agent, msg), msg);
		assert.equal(encodeMessage(out), encodeMessage(msg));
	}
});

test("strftime formats fixed instants in UTC", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "formats");
	const s = d.state;
	assert.equal(s.headline, "3 pass · 1 fail · 14 unset · 0 error");
	// i1 is 2024-03-05T14:07:09.123Z, a Tuesday; i3 2021-01-03T08:05:00Z, a Sunday.
	const f = (format, at = 0) => s.try_strftime(format)[at];
	const out = (format, at) => f(format, at).text;
	assert.equal(out("%Y-%m-%d %H:%M:%S"), "2024-03-05 14:07:09");
	assert.equal(out("%a %A %b %B %h"), "Tue Tuesday Mar March Mar");
	assert.equal(out("%y %C %j %e|%k|%l %I %p %P"), "24 20 065  5|14| 2 02 PM pm");
	assert.equal(out("%F %T %R %D"), "2024-03-05 14:07:09 14:07 03/05/24");
	assert.equal(out("%s.%L %z %Z %%"), "1709647629.123 +0000 UTC %");
	assert.equal(out("%u %w %U %W %V %G %g"), "2 2 09 10 10 2024 24");
	assert.equal(out("%c"), "Tue Mar  5 14:07:09 2024");
	assert.equal(out("%-d/%-m %-H"), "5/3 14");
	assert.equal(out("%U %W %V %G %u %w", 2), "01 00 53 2020 7 0");
	const bad = f("%Y %Q %");
	assert.equal(bad.text, "2024 [%Q?] [%?]");
	assert.equal(bad.errors.length, 2);
	assert.equal(Object.keys(s.directives).length > 35, true);
});

test("Intl formats in UTC by default and shows resolved options and parts", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "formats");
	const s = d.state;
	const row = s.formatted.find((r) => r.instant === "i2");
	assert.equal(row.cells.find((c) => c.format === "f5").output, "Samstag, 1. Januar 2000");
	assert.equal(s.formatted[0].cells.find((c) => c.format === "f6").status, "pass");
	const f4 = s.formatById("f4");
	assert.equal(f4.resolved.timeZone, "UTC");
	assert.equal(f4.resolved.locale, "en-US");
	assert.ok(s.partRows[0].parts.some((p) => p.label === "weekday" && p.text === "Tuesday"));
	d.send(ROOT, "set_intl_option", ["f4", "weekday", "short"]);
	d.drain();
	assert.equal(s.formatById("f4") !== d.state.formatById("f4"), true);
	assert.equal(d.state.formatted[0].cells.find((c) => c.format === "f4").status, "error");
	assert.notEqual(d.state.formatted[0].cells.find((c) => c.format === "f4").error, "");
	d.send(ROOT, "set_intl_option", ["f4", "dateStyle", ""]);
	d.send(ROOT, "set_intl_option", ["f4", "timeStyle", ""]);
	d.drain();
	assert.equal(d.state.formatted[0].cells.find((c) => c.format === "f4").output, "Tue");
	assert.deepEqual(d.problems, []);
});

test("edits from the page and the tools change only their part", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "formats");
	d.send(ROOT, "set_strftime", ["f1", "%Y-%m-%d %H:%M"]);
	d.send(ROOT, "set_expectation", ["f1", "i1", "2024-03-05 14:07"]);
	d.drain();
	assert.equal(d.state.headline, "4 pass · 0 fail · 14 unset · 0 error");
	// The instant input edits i1, which stays a tdata Instant.
	d.send(new Selector().field("instants").item("items", 0), "edit", ["2024-03-06T00:00:00Z"]);
	// Clicking the f2 cell of i2 pins its output.
	const { grid, instants, formats } = d.state;
	const cell = grid.cells.findIndex((_, i) => {
		const place = grid.at(i);
		return (
			place !== null && instants.items[place.row].id === "i2" && formats[place.col].id === "f2"
		);
	});
	d.send(ROOT, "pin_cell", [cell]);
	d.drain();
	assert.equal(d.state.formatById("f2").expect.i2, "Fri, 31 Dec 1999 23:59:59 +0000");
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0].data.epochNanoseconds, 1709683200000000000n);
	assert.equal(out.messages[1], message.messages[1]);
	assert.equal(out.messages[2], message.messages[2]);
	assert.equal(out.messages[3].data.get("format"), "%Y-%m-%d %H:%M");
	assert.equal(
		out.messages[3].meta.get("https://tutuca.dev/d/expect").get("i1"),
		"2024-03-05 14:07",
	);
	assert.equal(
		out.messages[4].meta.get("https://tutuca.dev/d/expect").get("i2"),
		"Fri, 31 Dec 1999 23:59:59 +0000",
	);
	assert.equal(out.messages[5], message.messages[5]);
	assert.deepEqual(d.problems, []);
});

test("a new lab grows from empty and matches the query", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "empty");
	d.send(ROOT, "add_instant", ["2024-02-29T12:00:00+02:00"]);
	d.send(ROOT, "add_strftime", ["%d.%m.%Y %H:%M"]);
	d.send(ROOT, "add_intl", ["fr-FR"]);
	d.drain();
	d.send(ROOT, "set_intl_option", ["f2", "hour12", "false"]);
	d.drain();
	assert.equal(d.state.formatted[0].cells[0].output, "29.02.2024 10:00");
	assert.equal(d.state.formatted[0].cells[1].output, "29 févr. 2024");
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[2].data.get("options").get("hour12"), false);
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
	assert.deepEqual(d.problems, []);
});

test("tools edit formats and read the table; bad ids are errors", async () => {
	const { call, text, env } = await toolRunner(ID, "formats");
	const r = await call("set_strftime", { id: "f1", format: "%Y-%m-%d %T" });
	assert.equal(r.isError, false);
	assert.equal(JSON.parse(text(r))[1].cells[0].status, "fail");
	assert.equal((await call("set_locale", { id: "f5", locale: "en-GB" })).isError, false);
	const opt = await call("set_intl_option", { id: "f5", option: "timeZone", value: "Asia/Tokyo" });
	assert.equal(opt.isError, false);
	assert.match(
		env.root().formatted[1].cells.find((c) => c.format === "f5").output,
		/^Saturday,? 1 January 2000$/,
	);
	assert.equal((await call("add_instant", { iso: "2030-06-15T10:00:00Z" })).isError, false);
	assert.equal(env.root().instants.items.length, 4);
	assert.match(text(await call("directives")), /%V/);
	assert.equal((await call("set_strftime", { id: "f4", format: "%Y" })).isError, true); // an Intl id
	assert.equal((await call("set_locale", { id: "nope", locale: "en" })).isError, true);
	assert.equal(
		(await call("set_intl_option", { id: "f4", option: "month", value: "huge" })).isError,
		true,
	);
	assert.equal((await call("add_instant", { iso: "yesterday" })).isError, true);
	assert.equal(
		(await call("set_expectation", { format: "f1", instant: "i9", expected: "x" })).isError,
		true,
	);
});

test("a set_strftime call shows the pattern and its output for the first instant", async () => {
	const { call, agent } = await toolRunner(ID, "formats");
	const args = { id: "f1", format: "%d/%m/%Y" };
	const result = await call("set_strftime", args);
	const view = agent.scope.make("SetStrftimeCall", {
		call: { type: "toolCall", id: "c1", name: "set_strftime", arguments: args },
		result,
		kind: "message",
	});
	assert.equal(view.outputs.length, 3);
	const d = new Driver({ root: view, document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		// The shared frame has one glimpse: the pattern and its first output, joined by a space.
		/messageset_strftimef1 = "%d\/%m\/%Y" → 05\/03\/2024.*fail/,
	);
	assert.equal(
		agent.scope.make("SetStrftimeCall", { call: { arguments: args }, result: null }).state,
		"running",
	);
	assert.deepEqual(d.problems, []);
});

test("reorder tools move instants and formats, and encode writes the new order", async () => {
	const { call, env, registry, agent, message } = await toolRunner(ID, "formats");
	assert.equal((await call("reorder_instants", { id: "i3", index: 0 })).isError, false);
	assert.equal((await call("reorder_strftimes", { id: "f3", index: 0 })).isError, false);
	assert.equal((await call("reorder_intls", { id: "f6", index: 0 })).isError, false);
	assert.equal((await call("reorder_intls", { id: "f1", index: 0 })).isError, true);
	const root = env.root();
	assert.deepEqual(
		root.formats.map((f) => f.id),
		["f3", "f1", "f2", "f6", "f4", "f5"],
	);
	const out = registry.encode(agent, root, message);
	assert.deepEqual(
		out.messages.map((m) => m.id),
		["i3", "i1", "i2", "f3", "f1", "f2", "f6", "f4", "f5"],
	);
	assert.equal(out.messages[0], message.messages[2]);
});

test("the lists: drag an instant, remove one (its expectations go), add rows", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "formats");
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="instants"]');
	assert.equal(handles().length, 3);
	dispatchDrag(handles()[2], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(
		d.state.instants.items.map((x) => x.id),
		["i3", "i1", "i2"],
	);
	[...d.rootNode.querySelectorAll('button[title="Remove"]')][1].click(); // i1
	d.drain();
	assert.deepEqual(d.state.strftimes.items[0].expect, { i2: "1999-12-31 23:59" });
	const add = (text) =>
		[...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === text).click();
	add("+ Instant");
	add("+ strftime");
	add("+ Intl");
	d.drain();
	assert.deepEqual(
		d.state.instants.items.map((x) => `${x.id} ${x.value}`),
		["i3 2021-01-03T08:05:00Z", "i2 1999-12-31T23:59:59Z", "i4 2024-01-01T00:00:00Z"],
	);
	assert.deepEqual(
		d.state.formats.map((f) => f.id),
		["f1", "f2", "f3", "f7", "f4", "f5", "f6", "f8"],
	);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.deepEqual(out.messages.map((m) => m.id).slice(0, 2), ["i3", "i2"]);
});

test("datefmt-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});
