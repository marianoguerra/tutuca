// cron-lab: the English, the next runs from an explicit reference time, the
// expectations, the builder and the tools. Every time is UTC or an explicit
// zone, so the results never depend on the machine.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "cron-lab";
const ids = (s) => s.get("crons").map((c) => c.id);

test("the sample's summary describes each cron, its next run and its expectation", async () => {
	const s = await session(await agent(ID), "schedules");
	assert.equal(s.get("headline"), "5 expressions · 1 invalid · 2 pass · 0 fail");
	const summary = s.get("summary");
	assert.match(summary, /^5 cron expressions: 1 invalid, 2 expectations pass, 0 fail\./);
	assert.match(summary, /standup: "30 9 \* \* MON-FRI" \(Europe\/Berlin\) "At 09:30 on Monday through Friday", next 2025-03-10T09:30Z, from 2025-03-07T12:00:00Z, expects next 2025-03-10T09:30:00Z: pass/);
	assert.match(summary, /backup: "@daily" \(UTC\) "At 00:00", next 2025-01-02T00:00Z/);
	assert.match(summary, /report: .*"At 06:00 on day 1 of the month in January, April, July and October", next 2025-01-01T06:00Z/);
	assert.match(summary, /broken: "61 25 \* \* \*" \(UTC\) error: minute: 61 is out of range 0-59/);
});

test("the rows show the runs in UTC and as they read in the cron's timezone", async () => {
	const s = await session(await agent(ID), "schedules");
	const [standup, backup] = s.get("cron_rows");
	assert.equal(standup.status, "pass");
	assert.equal(standup.from_label, "next runs after 2025-03-07T12:00Z (computed in UTC, also shown in Europe/Berlin)");
	assert.match(standup.runs[0].text, /^2025-03-10T09:30Z · 2025-03-10 10:30 /);
	assert.equal(backup.runs[0].text, "2025-01-02T00:00Z");
	assert.equal(backup.from_label, "next runs after 2025-01-01T00:00Z (computed in UTC)");
	assert.equal(s.get("cron_rows")[4].error, "minute: 61 is out of range 0-59");
});

test("explain gives the fields and next runs; bad ids are errors", async () => {
	const s = await session(await agent(ID), "schedules");
	const out = await s.json("explain", { id: "standup" });
	assert.deepEqual(out.fields.weekday, { text: "MON-FRI", values: [1, 2, 3, 4, 5] });
	assert.deepEqual(out.next.slice(0, 2), ["2025-03-10T09:30Z", "2025-03-11T09:30Z"]);
	assert.equal(out.from, "2025-03-07T12:00Z");
	assert.equal(out.status, "pass");
	const broken = await s.json("explain", { id: "broken" });
	assert.equal(broken.field, "minute");
	assert.equal((await s.call("explain", { id: "nope" })).isError, true);
});

test("next_runs looks further ahead, bounded to 1..100", async () => {
	const s = await session(await agent(ID), "schedules");
	const out = await s.json("next_runs", { id: "poll", count: 3 });
	assert.deepEqual(out, { id: "poll", from: "2025-01-01T00:00Z", runs: ["2025-01-01T08:00Z", "2025-01-01T08:15Z", "2025-01-01T08:30Z"] });
	const day = await s.json("next_runs", { id: "poll", count: 45 });
	assert.equal(day.runs[44], "2025-01-02T08:00Z");
	assert.equal((await s.call("next_runs", { id: "poll", count: 0 })).isError, true);
	assert.equal((await s.call("next_runs", { id: "broken", count: 3 })).isError, true);
});

test("set_expression and set_field change an expression; a bad id changes nothing", async () => {
	const s = await session(await agent(ID), "schedules");
	await s.call("set_expression", { id: "broken", expression: "59 23 * * *" });
	assert.equal(s.get("headline"), "5 expressions · 0 invalid · 2 pass · 0 fail");
	await s.call("set_field", { id: "backup", name: "hour", value: "3" });
	assert.equal(s.get("crons")[1].expression, "0 3 * * *");
	assert.match(s.get("summary"), /backup: "0 3 \* \* \*" \(UTC\) "At 03:00", next 2025-01-01T03:00Z/);
	const before = s.get("crons");
	assert.equal((await s.call("set_expression", { id: "nope", expression: "* * * * *" })).isError, true);
	assert.equal((await s.call("set_field", { id: "backup", name: "second", value: "1" })).isError, true);
	assert.deepEqual(s.get("crons"), before);
	assert.deepEqual(s.host.issues, []);
});

test("expectations: a moved reference time fails one; bad ISO times are rejected", async () => {
	const s = await session(await agent(ID), "schedules");
	await s.call("set_from", { id: "poll", iso: "2025-01-01T18:50:00Z" });
	assert.equal(s.get("cron_rows")[2].status, "fail");
	assert.match(s.get("summary"), /expects next 2025-01-01T08:00:00Z: fail/);
	await s.call("set_expected_next", { id: "poll", iso: "2025-01-02T08:00Z" });
	assert.equal(s.get("cron_rows")[2].status, "pass");
	await s.call("set_expected_next", { id: "poll", iso: "" });
	assert.equal(s.get("cron_rows")[2].status, "none");
	assert.equal((await s.call("set_expected_next", { id: "poll", iso: "tomorrow" })).isError, true);
	assert.equal((await s.call("set_from", { id: "poll", iso: "soon" })).isError, true);
	assert.equal(s.get("headline"), "5 expressions · 1 invalid · 1 pass · 0 fail");
	assert.deepEqual(s.host.issues, []);
});

test("the timezone shows the runs in another zone, never moving them", async () => {
	const s = await session(await agent(ID), "schedules");
	await s.call("set_timezone", { id: "backup", timezone: "America/New_York" });
	const row = s.get("cron_rows")[1];
	assert.match(row.runs[0].text, /^2025-01-02T00:00Z · 2025-01-01 19:00 /);
	await s.call("set_timezone", { id: "backup", timezone: "UTC" });
	assert.equal(s.get("cron_rows")[1].runs[0].text, "2025-01-02T00:00Z");
});

test("add, remove and reorder crons", async () => {
	const s = await session(await agent(ID), "schedules");
	await s.call("add_cron", { expression: "@hourly" });
	assert.deepEqual(ids(s), ["standup", "backup", "poll", "report", "broken", "c6"]);
	assert.equal(s.get("crons")[5].timezone, "UTC");
	await s.call("reorder_crons", { id: "c6", index: 0 });
	assert.equal(ids(s)[0], "c6");
	await s.call("remove_cron", { id: "broken" });
	assert.equal(ids(s).length, 5);
	assert.equal((await s.call("remove_cron", { id: "broken" })).isError, true);
	assert.deepEqual(s.host.issues, []);
});

test("the builder's chips toggle values of the focused cron", async () => {
	const s = await session(await agent(ID), "schedules");
	s.send("focus", "backup");
	assert.equal(s.get("focus_label"), "backup: @daily");
	const chips = s.get("chips");
	assert.equal(chips.length, 5 + 60 + 24 + 31 + 12 + 7);
	assert.deepEqual(chips[0], { label: "minute", status: "label", title: "" });
	assert.equal(chips[1].status, "on"); // minute 0
	// hour 6: the hour label is at 61, hour 0 at 62.
	s.send("toggle_chip", 68);
	assert.equal(s.get("crons")[1].expression, "0 0,6 * * *");
	// weekday MON: the weekday label is at 131, SUN at 132. * holds every day, so MON goes.
	s.send("toggle_chip", 133);
	assert.equal(s.get("crons")[1].expression, "0 0,6 * * 0,2-6");
	s.send("toggle_chip", 133);
	assert.equal(s.get("crons")[1].expression, "0 0,6 * * *");
	s.send("toggle_chip", 131); // a label does nothing
	assert.equal(s.get("crons")[1].expression, "0 0,6 * * *");
	assert.deepEqual(s.host.issues, []);
});
