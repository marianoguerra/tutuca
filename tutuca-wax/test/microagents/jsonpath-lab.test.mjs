// jsonpath-lab: the paths run on the document (jsonpath-plus, through the
// jsonpath host functions), their expected counts, the tree's highlights, the
// document edited as text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "jsonpath-lab";

test("the sample's paths: counts against their expectations", async () => {
	const s = await session(await agent(ID), "store");
	assert.equal(s.get("headline"), "3 paths · 1 pass · 1 fail · 0 invalid");
	assert.deepEqual(
		s.get("info_rows").map((r) => [r.id, r.status, r.label]),
		[
			["p1", "pass", "4 results (expected 4)"],
			["p2", "fail", "2 results (expected 3)"],
			["p3", "none", "5 results"],
		],
	);
	assert.match(s.get("summary"), /p2: \$\.store\.book\[\?\(@\.price < 10\)\]\.title → 2 results, expected 3 \(fail\)/);
});

test("results gives pointers and values; a bad id is an error", async () => {
	const s = await session(await agent(ID), "store");
	assert.deepEqual(await s.json("results", { id: "p2" }), {
		path: "$.store.book[?(@.price < 10)].title",
		count: 2,
		expected: 3,
		results: [
			{ pointer: "/store/book/0/title", value: "Sayings of the Century" },
			{ pointer: "/store/book/2/title", value: "Moby Dick" },
		],
	});
	const p3 = await s.json("results", { id: "p3" });
	assert.equal(p3.expected, undefined);
	assert.equal(p3.count, 5);
	assert.equal((await s.call("results", { id: "p9" })).isError, true);
});

test("document_paths lists the document's pointers and types", async () => {
	const s = await session(await agent(ID), "store");
	const out = await s.json("document_paths");
	assert.ok(out.sample.includes("(root): object"));
	assert.ok(out.sample.includes("/store/book: array"));
	assert.ok(out.sample.includes("/store/bicycle/price: number"));
	assert.equal(out.nodes, out.sample.length);
});

test("set_path and set_expected_count fix the failing path", async () => {
	const s = await session(await agent(ID), "store");
	const text = await s.text("set_path", { id: "p2", path: "$.store.book[?(@.price < 20)].title" });
	assert.match(text, /p2: .* → 3 results, expected 3 \(pass\)/);
	await s.call("set_expected_count", { id: "p3", count: 5 });
	assert.equal(s.get("headline"), "3 paths · 3 pass · 0 fail · 0 invalid");
	assert.equal(s.get("paths")[2].expected_count, 5);
	await s.call("set_expected_count", { id: "p3", count: -1 });
	assert.equal(s.get("info_rows")[2].status, "none");
	assert.equal((await s.call("set_expected_count", { id: "p3", count: -2 })).isError, true);
	assert.equal((await s.call("set_path", { id: "p9", path: "$" })).isError, true);
	assert.deepEqual(s.host.issues, []);
});

test("a malformed path is invalid and says why", async () => {
	const s = await session(await agent(ID), "store");
	await s.call("set_path", { id: "p3", path: "$.store[" });
	assert.equal(s.get("info_rows")[2].status, "invalid");
	assert.equal(s.get("path_rows")[2].problem, "a [ isn't closed");
	assert.match(s.get("summary"), /p3: \$\.store\[ → error: a \[ isn't closed/);
	assert.deepEqual(await s.json("results", { id: "p3" }), { error: "a [ isn't closed" });
});

test("paths: added, reordered, removed; ids reused", async () => {
	const s = await session(await agent(ID), "store");
	await s.call("add_path", { path: "$.store.bicycle.color" });
	assert.deepEqual(s.get("paths")[3], { id: "p4", path: "$.store.bicycle.color", expected_count: -1 });
	await s.call("reorder_paths", { id: "p4", index: 0 });
	assert.deepEqual(s.get("paths").map((p) => p.id), ["p4", "p1", "p2", "p3"]);
	await s.call("remove_path", { id: "p1" });
	assert.deepEqual(s.get("paths").map((p) => p.id), ["p4", "p2", "p3"]);
	assert.equal((await s.call("remove_path", { id: "p1" })).isError, true);
	assert.deepEqual(s.host.issues, []);
});

test("the tree lights the focused path's matches", async () => {
	const s = await session(await agent(ID), "store");
	assert.equal(s.get("focus_label"), "$.store.book[*].author");
	assert.equal(s.get("tree_rows").filter((r) => r.hit).length, 4);
	s.send("focus", "p3");
	assert.equal(s.get("focus_label"), "$..price");
	const lit = s.get("tree_rows").filter((r) => r.hit);
	assert.deepEqual(lit.map((r) => r.text).sort(), ["12.99", "19.95", "22.99", "8.95", "8.99"]);
	assert.equal(s.get("focused_results").length, 5);
});

test("the document: replaced, or edited as text and kept while it isn't JSON", async () => {
	const s = await session(await agent(ID), "store");
	await s.call("set_document", { document: { store: { book: [{ author: "A" }] } } });
	assert.equal(s.get("info_rows")[0].label, "1 results (expected 4)");
	s.send("set_document_text", "{ nope");
	assert.notEqual(s.get("doc_error"), "");
	assert.equal(s.get("editor_text"), "{ nope");
	assert.equal(s.get("headline"), "3 paths · 0 pass · 0 fail · 3 invalid");
	assert.match((await s.json("document_paths")).error, /JSON/);
	s.send("set_document_text", '{"store": {"book": []}}');
	assert.equal(s.get("doc_error"), "");
	assert.deepEqual(s.get("data").document, { store: { book: [] } });
});
