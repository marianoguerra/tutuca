// datefmt-lab: the table of instants × formats, strftime in UTC, Intl in UTC
// or an explicit timeZone, the expectations and the tools. No output depends
// on the machine's zone or locale.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "datefmt-lab";
const cell = (formatted, instant, format) => formatted.find((r) => r.instant === instant).cells.find((c) => c.format === format);

test("the sample's table says which expectations pass", async () => {
	const s = await session(await agent(ID), "formats");
	assert.equal(s.get("headline"), "3 pass · 1 fail · 14 unset · 0 error");
	const summary = s.get("summary");
	assert.match(summary, /^3 instants, 3 strftime formats, 3 Intl formats: 3 expectations pass, 1 fail, 0 cells error\./);
	assert.match(summary, /i1: 2024-03-05T14:07:09\.123Z/);
	assert.match(summary, /f1: strftime "%Y-%m-%d %H:%M:%S" expects /);
	assert.match(summary, /f6: Intl ja-JP-u-ca-japanese /);
	const formatted = await s.json("formatted");
	assert.deepEqual(cell(formatted, "i2", "f1"), { format: "f1", output: "1999-12-31 23:59:59", expected: "1999-12-31 23:59", status: "fail", error: "" });
	assert.equal(cell(formatted, "i3", "f3").status, "pass");
	assert.equal(cell(formatted, "i1", "f2").output, "Tue, 05 Mar 2024 14:07:09 +0000");
	assert.equal(cell(formatted, "i1", "f6").output, "令和6年3月5日");
	// Intl in UTC by default, in the timeZone it names otherwise: i2 is already 2000 in Berlin.
	assert.match(cell(formatted, "i1", "f4").output, /^Tuesday, March 5, 2024 at 2:07\sPM$/);
	assert.equal(cell(formatted, "i2", "f5").output, "Samstag, 1. Januar 2000");
});

test("set_strftime fixes a format and answers with the table; bad ids change nothing", async () => {
	const s = await session(await agent(ID), "formats");
	const out = await s.json("set_strftime", { id: "f1", format: "%Y-%m-%d %H:%M" });
	assert.equal(cell(out, "i2", "f1").status, "pass");
	assert.equal(cell(out, "i1", "f1").status, "fail");
	await s.call("set_expectation", { format: "f1", instant: "i1", expected: "2024-03-05 14:07" });
	assert.equal(s.get("headline"), "4 pass · 0 fail · 14 unset · 0 error");
	const before = s.get("data");
	assert.equal((await s.call("set_strftime", { id: "f4", format: "%Y" })).isError, true);
	assert.equal((await s.call("set_expectation", { format: "f1", instant: "i9", expected: "x" })).isError, true);
	assert.deepEqual(s.get("data"), before);
	assert.deepEqual(s.host.issues, []);
});

test("an unknown directive makes its cells errors and says why", async () => {
	const s = await session(await agent(ID), "formats");
	await s.call("set_strftime", { id: "f2", format: "%Q" });
	assert.equal(s.get("strftime_rows")[1].error, "unknown directive %Q at position 0");
	assert.equal(s.get("headline"), "3 pass · 1 fail · 11 unset · 3 error");
	assert.match(s.get("summary"), /3 cells error\./);
});

test("Intl formats: locale and options change the output; bad options are rejected", async () => {
	const s = await session(await agent(ID), "formats");
	await s.call("set_locale", { id: "f4", locale: "en-GB" });
	await s.call("set_intl_option", { id: "f4", option: "timeStyle", value: "" });
	await s.call("set_intl_option", { id: "f4", option: "dateStyle", value: "long" });
	assert.equal(cell(await s.json("formatted"), "i1", "f4").output, "5 March 2024");
	const out = await s.json("set_intl_option", { id: "f4", option: "timeZone", value: "Asia/Tokyo" });
	assert.equal(cell(out, "i2", "f4").output, "1 January 2000");
	assert.equal((await s.call("set_intl_option", { id: "f4", option: "dateStyle", value: "huge" })).isError, true);
	assert.equal((await s.call("set_intl_option", { id: "f4", option: "colour", value: "red" })).isError, true);
	assert.equal((await s.call("set_intl_option", { id: "f1", option: "dateStyle", value: "long" })).isError, true);
	// Mixing dateStyle with a field option is Intl's error, shown on the cells.
	await s.call("set_intl_option", { id: "f4", option: "year", value: "numeric" });
	assert.match(s.get("intl_cells")[0].error, /dateStyle|can't|Invalid/i);
	assert.equal(cell(await s.json("formatted"), "i1", "f4").status, "error");
	assert.deepEqual(s.host.issues, []);
});

test("the Intl rows show resolved options, a select per option, and the first instant's parts", async () => {
	const s = await session(await agent(ID), "formats");
	const cells = s.get("intl_cells");
	assert.equal(cells.length, 3 * 14);
	assert.equal(cells[0].kind, "head");
	assert.ok(cells[0].resolved.some((r) => r.text === "timeZone: UTC"));
	assert.deepEqual(
		cells.slice(1, 3).map((c) => [c.name, c.value]),
		[
			["dateStyle", "full"],
			["timeStyle", "short"],
		],
	);
	const f5 = s.get("part_rows")[1];
	assert.equal(f5.id, "f5");
	assert.deepEqual(f5.parts[0], { text: "Dienstag", label: "weekday" });
});

test("instants: add, change, remove (dropping their expectations), reorder", async () => {
	const s = await session(await agent(ID), "formats");
	assert.equal((await s.call("add_instant", { iso: "not a time" })).isError, true);
	await s.call("add_instant", { iso: "2024-02-29T12:00:00+02:00" });
	assert.equal(cell(await s.json("formatted"), "i4", "f1").output, "2024-02-29 10:00:00");
	await s.call("set_instant", { id: "i4", iso: "nope" });
	assert.equal(s.get("instant_rows")[3].error, '"nope" isn\'t an ISO time');
	assert.equal(cell(await s.json("formatted"), "i4", "f1").status, "error");
	await s.call("remove_instant", { id: "i1" });
	assert.equal(s.get("strftimes")[0].expect.i1, undefined);
	assert.equal(s.get("intls")[2].expect.i1, undefined);
	await s.call("reorder_instants", { id: "i4", index: 0 });
	assert.deepEqual(s.get("instants").map((i) => i.id), ["i4", "i2", "i3"]);
	assert.deepEqual(s.host.issues, []);
});

test("formats: added with ids shared by both kinds, removed, reordered", async () => {
	const s = await session(await agent(ID), "formats");
	await s.call("add_strftime", { format: "%s" });
	await s.call("add_intl", { locale: "fr-FR" });
	assert.deepEqual(s.get("strftimes").map((f) => f.id), ["f1", "f2", "f3", "f7"]);
	assert.deepEqual(s.get("intls")[3], { id: "f8", locale: "fr-FR", options: { dateStyle: "medium" }, expect: {} });
	assert.equal(cell(await s.json("formatted"), "i3", "f7").output, "1609661100");
	await s.call("remove_format", { id: "f4" });
	await s.call("remove_format", { id: "f2" });
	assert.equal((await s.call("remove_format", { id: "f2" })).isError, true);
	await s.call("reorder_strftimes", { id: "f7", index: 0 });
	await s.call("reorder_intls", { id: "f8", index: 0 });
	assert.deepEqual(s.get("strftimes").map((f) => f.id), ["f7", "f1", "f3"]);
	assert.deepEqual(s.get("intls").map((f) => f.id), ["f8", "f5", "f6"]);
	assert.deepEqual(s.host.issues, []);
});

test("pin_cell pins a cell's output as expected, or clears it", async () => {
	const s = await session(await agent(ID), "formats");
	// 7 columns: a row label and 6 formats; i1's row is the second, so its f2 cell is 7 + 2.
	s.send("pin_cell", 9);
	assert.equal(s.get("strftimes")[1].expect.i1, "Tue, 05 Mar 2024 14:07:09 +0000");
	s.send("pin_cell", 9);
	assert.equal(s.get("strftimes")[1].expect.i1, undefined);
	s.send("pin_cell", 3); // the header does nothing
	assert.equal(s.get("headline"), "3 pass · 1 fail · 14 unset · 0 error");
});

test("try_strftime and directives change nothing", async () => {
	const s = await session(await agent(ID), "formats");
	const out = await s.json("try_strftime", { format: "%j %-d %e" });
	assert.deepEqual(out[2], { instant: "i3", text: "003 3  3", error: "" });
	const directives = await s.json("directives");
	assert.equal(directives["%V"], "ISO week, 01-53");
	assert.equal((await s.call("directives")).details.changed, false);
});
