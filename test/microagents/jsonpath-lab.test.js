import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../apps/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "jsonpath-lab";

test("the store sample matches jsonpath-lab and its empty sample decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "store"));
	assert.ok(matches.some((m) => m.agent.id === ID));
	const { d } = drive(registry, agent, "empty");
	assert.equal(d.state.paths.items.length, 0);
	assert.equal(d.state.treeRows.length, 0);
});

test("decode then encode gives back the same bytes for every sample", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const s of agent.samples) {
		const root = registry.open(agent, s.message);
		assert.equal(encodeMessage(registry.encode(agent, root, s.message)), encodeMessage(s.message));
	}
});

test("paths select results, the tree highlights the focused one's, and edits change only their part", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "store");
	assert.equal(d.state.headline, "3 paths · 1 pass · 1 fail · 0 invalid");
	assert.equal(d.state.results("p3").count, 5);
	assert.equal(d.state.treeRows.filter((r) => r.cls.includes("bg-warning")).length, 4);
	d.send(ROOT, "focus", ["p3"]);
	d.drain();
	assert.equal(d.state.focusedResults[0].pointer, "/store/book/0/price");
	// p2 expects 3 books under 10, there are 2: fix the expectation.
	d.send(ROOT, "set_expected_count", ["p2", 2]);
	d.send(ROOT, "set_path", ["p3", "$.store.bicycle.price"]);
	d.drain();
	assert.equal(d.state.headline, "3 paths · 2 pass · 0 fail · 0 invalid");
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0], message.messages[0]); // untouched parts stay the same objects
	assert.equal(out.messages[1].meta.get("https://tutuca.dev/d/expect").get("count"), 2n);
	assert.equal(out.messages[1].data, message.messages[1].data);
	assert.equal(out.messages[2].data.get("path"), "$.store.bicycle.price");
	assert.equal(out.messages[3], message.messages[3]);
});

test("a bad path or document says why", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "store");
	d.send(ROOT, "set_path", ["p1", "$.store.book[0"]);
	d.drain();
	assert.match(d.state.results("p1").error, /isn't closed/);
	d.send(ROOT, "set_path", ["p1", "store"]);
	d.send(ROOT, "set_document_text", ["{"]);
	d.drain();
	assert.match(d.state.results("p1").error, /starts with \$/);
	assert.match(d.state.results("p3").error, /document/);
	assert.deepEqual(d.problems, []);
});

test("an empty lab grows into one that matches its query", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "empty");
	d.send(ROOT, "set_document", [{ a: [1, 2, 3] }]);
	d.send(ROOT, "add_path", ["$.a[?(@ > 1)]"]);
	d.drain();
	assert.equal(d.state.results("p1").count, 2);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
});

test("the tools run paths and reject bad ids", async () => {
	const { call, text } = await toolRunner(ID, "store");
	const r = JSON.parse(text(await call("results", { id: "p1" })));
	assert.equal(r.count, 4);
	assert.equal(r.results[0].pointer, "/store/book/0/author");
	assert.match(text(await call("document_paths")), /\/store\/bicycle\/color: string/);
	assert.equal((await call("set_path", { id: "p9", path: "$" })).isError, true);
	assert.equal((await call("results", { id: "p9" })).isError, true);
	assert.match(text(await call("add_path", { path: "$..isbn" })), /p4: \$\.\.isbn → 2 results/);
	assert.equal((await call("remove_path", { id: "p4" })).isError, false);
	assert.match(
		text(await call("set_path", { id: "p1", path: "$..author" })),
		/p1: \$\.\.author → 4/,
	);
});

test("jsonpath-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});

test("the document is edited in a JsonView, and the focused path's results show in one", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "store");
	assert.equal(d.state.docView.text, d.state.docText);
	assert.deepEqual(Object.keys(JSON.parse(d.state.resultsView.text)), [
		"/store/book/0/author",
		"/store/book/1/author",
		"/store/book/2/author",
		"/store/book/3/author",
	]);
	d.send(ROOT, "focus", ["p3"]);
	assert.equal(JSON.parse(d.state.resultsView.text)["/store/book/0/price"], 8.95);
	d.send(new Selector().field("docView"), "edit", ['{"store":{"book":[{"price":1}]}}']);
	assert.equal(d.state.docText, '{"store":{"book":[{"price":1}]}}');
	assert.deepEqual(JSON.parse(d.state.resultsView.text), { "/store/book/0/price": 1 });
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[3].data.get("store").get("book")[0].get("price"), 1n);
});

test("set_path and results calls show the path and what it selects", async () => {
	const { agent } = await loadAgent(ID);
	const C = agent.scope.components;
	const summary = [
		"2 paths: 1 pass, 0 fail, 1 have no expected count, 0 invalid.",
		"paths:",
		"  p1: $..author → 4 results, expected 4 (pass)",
		"  p2: $..price → 5 results",
		"document d1: {}",
	].join("\n");
	const text = (t) => ({ content: [{ type: "text", text: t }], isError: false });
	const call = { id: "c1", name: "set_path", arguments: { id: "p1", path: "$..author" } };
	const d = new Driver({
		root: C.PathCall({ call, result: text(summary), kind: "message" }),
		document,
	});
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messageset_pathp1 = \$\.\.author4 results, expected 4 \(pass\)/,
	);
	assert.deepEqual(
		d.state.others.map((x) => x.text),
		["p2: $..price → 5 results"],
	);
	const added = C.PathCall({
		call: { name: "add_path", arguments: { path: "$..price" } },
		result: text(summary),
	});
	assert.equal(added.path, "p2 = $..price");
	const answer = {
		path: "$..isbn",
		count: 2,
		expected: 3,
		results: [{ pointer: "/a", value: "x" }],
	};
	const results = new Driver({
		root: C.ResultsCall({
			call: { id: "c2", name: "results", arguments: { id: "p4" } },
			result: text(JSON.stringify(answer)),
			kind: "view",
		}),
		document,
	});
	assert.match(
		results.rootNode.querySelector("summary").textContent,
		/viewresultsp4 = \$\.\.isbn2 results \(expected 3\)/,
	);
	assert.ok(results.state.stateClass.includes("badge-error"));
	assert.deepEqual(results.state.rows, [{ text: '/a: "x"' }]);
	assert.deepEqual([...d.problems, ...results.problems], []);
});

test("paths reorder by tool and by drag; encode keeps the order, the results follow the first", async () => {
	const { call, env, message, registry, agent } = await toolRunner(ID, "store");
	assert.equal((await call("reorder_paths", { id: "p3", index: 0 })).isError, false);
	assert.equal((await call("reorder_paths", { id: "p9", index: 0 })).isError, true);
	const ids = (root) => registry.encode(agent, root, message).messages.map((m) => m.id);
	assert.deepEqual(ids(env.root()), ["p3", "p1", "p2", "d1"]);
	assert.equal(JSON.parse(env.root().resultsView.text)["/store/book/0/price"], 8.95);
	const d = new Driver({ root: registry.open(agent, message), document });
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="paths"]');
	dispatchDrag(handles()[2], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(ids(d.state), ["p3", "p1", "p2", "d1"]);
	assert.equal(JSON.parse(d.state.resultsView.text)["/store/book/0/price"], 8.95);
	d.send(ROOT, "remove_paths_at", [0]);
	d.send(ROOT, "add_paths", []);
	assert.deepEqual(
		d.state.paths.items.map((x) => x.id),
		["p1", "p2", "p3"],
	);
	assert.equal(d.state.paths.items[2].path, "$");
	assert.equal(JSON.parse(d.state.resultsView.text)["/store/book/0/price"], undefined);
	assert.deepEqual(d.problems, []);
});
