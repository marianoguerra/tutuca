// regex-lab: the grid of expectations, the highlights, the tools.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "regex-lab";

test("the sample's grid says which expectations pass", async () => {
	const s = await session(await agent(ID), "emails");
	assert.equal(s.get("headline"), "5 pass · 1 fail · 2 unset");
	const grid = await s.json("grid");
	assert.deepEqual(
		grid.map((row) => row.cells.map((c) => c.status)),
		[
			["pass", "pass"],
			["pass", "pass"],
			["pass", "none"],
			["fail", "none"],
		],
	);
	assert.match(s.get("summary"), /r2: \/@example\\\.\(com\|org\)\/i/);
});

test("set_regex fixes the failing cell and answers with the grid", async () => {
	const s = await session(await agent(ID), "emails");
	const out = await s.json("set_regex", { id: "r1", pattern: "^[^@\\s]+@[^@\\s]+$", flags: "" });
	assert.deepEqual(out[3].cells[0], { status: "pass", matched: false, expected: "no-match", regex: "r1" });
	assert.equal(s.get("headline"), "6 pass · 0 fail · 2 unset");
	assert.deepEqual(s.host.issues, []);
});

test("an invalid regex is invalid in the grid, and says why", async () => {
	const s = await session(await agent(ID), "emails");
	await s.call("set_regex", { id: "r2", pattern: "(", flags: "" });
	assert.match(s.get("summary"), /r2: \/\(\/ \(error: .*Unterminated group/);
	assert.match(s.get("headline"), /4 invalid/);
	assert.match(s.get("regex_rows")[1].error, /Unterminated group/);
});

test("explain_matches gives positions and groups; bad ids say so", async () => {
	const s = await session(await agent(ID), "emails");
	const out = await s.json("explain_matches", { regex: "r2", text: "t2" });
	assert.deepEqual(out.matches[0], { index: 17, end: 29, text: "@EXAMPLE.org", groups: ["org"], named: {} });
	assert.equal((await s.call("explain_matches", { regex: "nope", text: "t1" })).isError, true);
});

test("expectations: set, cleared, cycled from the grid; a bad outcome is rejected", async () => {
	const s = await session(await agent(ID), "emails");
	await s.call("set_expectation", { text: "t3", regex: "r2", outcome: "no-match" });
	assert.equal(s.get("texts")[2].expect.r2, "no-match");
	await s.call("set_expectation", { text: "t3", regex: "r2", outcome: "none" });
	assert.equal(s.get("texts")[2].expect.r2, undefined);
	// Cell 3*1+... : row t1 is the second row (index 1), so its r1 cell is 3 + 1.
	s.send("cycle_cell", 4);
	assert.equal(s.get("texts")[0].expect.r1, "no-match");
	assert.equal((await s.call("set_expectation", { text: "t1", regex: "r1", outcome: "maybe" })).isError, true);
});

test("removing a regex drops the expectations that name it; ids are reused", async () => {
	const s = await session(await agent(ID), "emails");
	await s.call("remove_regex", { id: "r1" });
	assert.ok(s.get("texts").every((t) => t.expect.r1 === undefined));
	await s.call("add_regex", { pattern: "x", flags: "g" });
	assert.deepEqual(s.get("regexes").map((r) => r.id), ["r2", "r3"]);
	await s.call("reorder_regexes", { id: "r3", index: 0 });
	assert.deepEqual(s.get("regexes").map((r) => r.id), ["r3", "r2"]);
	assert.deepEqual(s.host.issues, []);
});

test("the highlights cut each text at the focused regex's matches", async () => {
	const s = await session(await agent(ID), "emails");
	s.send("focus", "r2");
	assert.deepEqual(s.get("highlights")[0].segments, [
		{ text: "ada", hit: false },
		{ text: "@example.com", hit: true },
	]);
});
