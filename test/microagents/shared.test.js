// The helpers and components the agents share (kit.lib, kit.ui) and the chat's tool call views.
import assert from "node:assert/strict";
import test from "node:test";
import { shellComponents } from "../../components/microagents/app.js";
import { decodeMessage, encodeMessage } from "../../components/microagents/core/tdata.js";
import { entriesFor } from "../../components/microagents/index.js";
import * as expect from "../../components/microagents/lib/expect.js";
import { grid } from "../../components/microagents/lib/grid.js";
import { nodes, parse, pointer } from "../../components/microagents/lib/json.js";
import { encodeParts, nextId, strOf, withData } from "../../components/microagents/lib/parts.js";
import {
	describe,
	formatCsv,
	parseCsv,
	readPart,
	writePart,
} from "../../components/microagents/lib/table.js";
import { parseIso } from "../../components/microagents/lib/time.js";
import { jsonViewArgs, toolCallView } from "../../components/microagents/ui.js";
import { Driver } from "../../src/test/driver.js";
import { apply, DispatchPath, render } from "../../src/tutuca.js";
import { document, scopeWith } from "../helpers.js";

const C = scopeWith(shellComponents).components;
const ROOT = new DispatchPath();

test("pointers resolve, set and remove, saying why when they can't", () => {
	const doc = { a: { "b/c": [1, 2] }, "~x": 3 };
	assert.equal(pointer.format(["a", "b/c", "1"]), "/a/b~1c/1");
	assert.equal(pointer.resolve(doc, "/a/b~1c/1").value, 2);
	assert.equal(pointer.resolve(doc, "/~0x").value, 3);
	assert.match(pointer.resolve(doc, "/a/b~1c/5").reason, /index 5 is out of range/);
	assert.match(pointer.resolve(doc, "/a/nope").reason, /no key "nope" \(its keys: "b\/c"\)/);
	assert.match(pointer.parse("/a~2").error, /~ that isn't ~0/);
	const set = pointer.set(doc, "/a/b~1c/-", 3);
	assert.deepEqual(set.value.a["b/c"], [1, 2, 3]);
	assert.deepEqual(doc.a["b/c"], [1, 2], "the original stays as it was");
	assert.deepEqual(pointer.remove(doc, "/~0x").value, { a: { "b/c": [1, 2] } });
	assert.match(
		pointer.set(doc, "/zz/y", 1).error,
		/the document has no key "zz".*set \/zz to the whole object/,
	);
});

test("JSON text parses once, and a document becomes tree rows", () => {
	assert.equal(parse('{"a":1}'), parse('{"a":1}'));
	assert.equal(parse("", { emptyError: "no document" }).error, "no document");
	assert.deepEqual(
		nodes({ a: [true] }).map((n) => `${n.depth} ${n.pointer} ${n.key} ${n.text}`),
		["0  $ {1 keys}", "1 /a a [1 items]", "2 /a/0 0 true"],
	);
});

test("tables read from csv and table parts and write back in their form", () => {
	const rows = parseCsv('a;b\n1;"x;y"\n2.5;true', ";");
	assert.deepEqual(rows, [
		{ a: 1, b: "x;y" },
		{ a: 2.5, b: true },
	]);
	assert.equal(formatCsv(rows, ";"), 'a;b\n1;"x;y"\n2.5;true');
	assert.deepEqual(describe({ id: "t", kind: "csv", rows }).columns[0], {
		name: "a",
		type: "number",
		min: 1,
		max: 2.5,
		distinct: 2,
		nulls: 0,
	});
	const csv = decodeMessage(
		'{"id":"t","kind":"csv","data":"a;b\\n1;2","meta":{"https://tutuca.dev/d/csv":{"delimiter":";"}}}',
	);
	const x = readPart(csv);
	assert.deepEqual(x, { id: "t", kind: "csv", rows: [{ a: 1, b: 2 }], delimiter: ";" });
	assert.equal(writePart(csv, { ...x, rows: [{ a: 3, b: 4 }] }).data, "a;b\n3;4");
	assert.equal(
		encodeMessage(writePart(null, { id: "n", rows: [{ a: 1 }] })),
		'{"id":"n","kind":"table","data":[[{"a":1}]]}',
	);
});

test("encodeParts keeps untouched parts, updates, drops and appends", () => {
	const msg = decodeMessage(
		'{"id":"m","kind":"k","messages":[{"id":"a","kind":"x","data":{"v":"1"}},{"id":"o","kind":"other","data":1},{"id":"b","kind":"x","data":{"v":"2"}}]}',
	);
	const spec = (items) => ({
		items,
		same: (m, it) => strOf(m, "v") === it.v,
		update: (m, it) => withData(m, { v: it.v }),
		create: (it) => ({ id: it.id, kind: "x", data: new Map([["v", it.v]]), meta: new Map() }),
	});
	assert.equal(
		encodeParts(msg, {
			x: spec([
				{ id: "a", v: "1" },
				{ id: "b", v: "2" },
			]),
		}),
		msg,
	);
	const out = encodeParts(msg, {
		x: spec([
			{ id: "a", v: "1" },
			{ id: "c", v: "3" },
			{ id: "b", v: "9" },
		]),
	});
	assert.equal(out.messages[0], msg.messages[0]);
	assert.equal(out.messages[1], msg.messages[1]);
	assert.equal(strOf(out.messages[2], "v"), "9");
	assert.deepEqual(
		out.messages.map((m) => m.id),
		["a", "o", "b", "c"],
	);
	assert.equal(withData(msg.messages[0], { v: "1" }), msg.messages[0]);
	assert.equal(nextId("r", [{ id: "r1" }, { id: "r3" }]), "r4");
});

test("expectations read, cycle and count", () => {
	const m = decodeMessage(
		'{"id":"t","kind":"text","data":"x","meta":{"https://tutuca.dev/d/expect":{"r1":"match","r2":"nope"}}}',
	);
	assert.deepEqual(expect.read(m, { accept: expect.OUTCOMES }), { r1: "match" });
	assert.deepEqual(expect.cycle({ r1: "match" }, "r1"), { r1: "no-match" });
	assert.deepEqual(expect.cycle({ r1: "no-match" }, "r1"), {});
	assert.equal(expect.withAll(m.meta, {}).has(expect.DIALECT), false);
	assert.equal(expect.status("match", true), "pass");
	assert.equal(expect.status("no-match", true), "fail");
	assert.equal(expect.status(undefined, false), "none");
	assert.equal(
		expect.headline(["pass", "fail", "none", "invalid"]),
		"1 pass · 1 fail · 1 unset · 1 invalid",
	);
	const g = grid({
		rows: ["t1"],
		cols: ["r1", "r2"],
		cell: (_r, c) => ({ status: c === "r1" ? "pass" : "none", label: c }),
	});
	assert.equal(g.cells.length, 6);
	assert.deepEqual(g.at(4), { row: 0, col: 0 });
	assert.equal(g.at(1), null);
	assert.deepEqual(g.statuses, ["pass", "none"]);
	assert.equal(parseIso("2025-01-02T03:04:05+01:00"), Date.UTC(2025, 0, 2, 2, 4, 5));
});

test("JsonView shows a tree that folds, raw text, and edits that notify", () => {
	const d = new Driver({
		root: C.JsonView(jsonViewArgs({ a: { b: 1 }, c: [2] }, { label: "spec" })),
		document,
	});
	assert.deepEqual(
		d.state.treeRows.map((r) => r.key),
		["$", "a", "b", "c", "0"],
	);
	d.send(ROOT, "fold", [1]);
	assert.deepEqual(
		d.state.treeRows.map((r) => r.key),
		["$", "a", "c", "0"],
	);
	assert.match(d.rootNode.textContent, /Tree.*Raw.*Copy/);
	d.send(ROOT, "show", ["raw"]);
	assert.equal(d.state.showRawText, true);
	const text = C.JsonView(jsonViewArgs("not json"));
	assert.equal(text.isJson, false);
	assert.equal(text.showRawText, true);
	assert.deepEqual(d.problems, []);
});

test("a tool call is one line that opens to its arguments and result", () => {
	const call = {
		type: "toolCall",
		id: "c1",
		name: "set_regex",
		arguments: { id: "r1", pattern: "x" },
	};
	const result = {
		role: "toolResult",
		toolCallId: "c1",
		toolName: "set_regex",
		content: [{ type: "text", text: '{"ok":true}' }],
		details: { changed: true },
		isError: false,
	};
	const running = toolCallView(C, call, null);
	assert.equal(running.state, "running");
	const done = toolCallView(C, call, result);
	assert.equal(done.state, "changed the data");
	assert.equal(done.output.isJson, true);
	const d = new Driver({ root: done, document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messageset_regexid: r1 · pattern: x.*changed the data/,
	);
	const entries = entriesFor(C, [
		{ role: "user", content: "fix it", timestamp: 0 },
		{
			role: "assistant",
			content: [{ type: "text", text: "On it." }, call],
			stopReason: "toolUse",
			model: "m",
		},
		result,
	]);
	assert.deepEqual(
		entries.map((e) => e.kind ?? e.state),
		["user", "assistant", "message"],
	);
	assert.equal(entries[2].state, "changed the data");
});

test("withPart replaces or adds one part; withData can drop empty values", async () => {
	const { withPart } = await import("../../components/microagents/lib/parts.js");
	const msg = decodeMessage(
		'{"id":"m","kind":"k","messages":[{"id":"s","kind":"spec","data":{"a":"1"}}]}',
	);
	assert.equal(
		withPart(msg, "spec", "s", (m) => m),
		msg,
	);
	const changed = withPart(msg, "spec", "s", (m) => withData(m, { a: "2" }));
	assert.equal(strOf(changed.messages[0], "a"), "2");
	assert.equal(
		withPart(msg, "spec", "nope", (m) => m),
		msg,
	);
	assert.equal(
		withPart(
			msg,
			"spec",
			"x",
			(m) => m,
			() => ({ id: "x", kind: "spec", data: 1, meta: new Map() }),
		).messages.length,
		2,
	);
	assert.equal(withData(msg.messages[0], { b: "" }, { dropEmpty: true }), msg.messages[0]);
	assert.equal(withData(msg.messages[0], { b: "" }).data.get("b"), "");
});

test("plain-text JsonViews, headline options, fixed grid cells and synced views", async () => {
	const { syncViews } = await import("../../components/microagents/ui.js");
	const plain = C.JsonView(jsonViewArgs("a\nb", { editable: true, json: false }));
	assert.equal(plain.error, "");
	assert.equal(plain.showRawEditor, true);
	assert.equal(
		expect.headline(["pass"], { always: true, invalid: "errors" }),
		"1 pass · 0 fail · 0 unset · 0 errors",
	);
	const g = grid({
		rows: [1],
		cols: [1],
		cell: () => ({ status: "none", label: "-", fixed: true }),
	});
	assert.equal(g.at(3), null);
	const views = {};
	const make = (key, text) => C.JsonView(jsonViewArgs(text, { id: key }));
	syncViews(views, { a: "1", b: "2" }, make);
	views.a = apply(views.a, "show", "raw");
	syncViews(views, { a: "3" }, make);
	assert.equal(views.a.text, "3");
	assert.equal(views.a.mode, "raw"); // a view whose text changed keeps its mode
	assert.deepEqual(Object.keys(views), ["a"]);
});

test("pointer edits on a scalar fail in words; a bad pointer keeps the tokens before it", () => {
	assert.match(pointer.set(true, "/a", 1).error, /the document is a boolean, not an object or an array/);
	assert.deepEqual(pointer.resolve({}, "/a/b~2").tokens, ["a"]);
});

test("withJsonPart writes one JSON part only when its text is JSON that changed", async () => {
	const { withJsonPart } = await import("../../components/microagents/lib/parts.js");
	const msg = decodeMessage(
		'{"id":"m","kind":"k","messages":[{"id":"d","kind":"json","data":{"a":1}}]}',
	);
	assert.equal(withJsonPart(msg, { kind: "json", id: "d", text: '{ "a": 1 }' }), msg);
	assert.equal(withJsonPart(msg, { kind: "json", id: "d", text: "{oops" }), msg);
	assert.equal(
		encodeMessage(withJsonPart(msg, { kind: "json", id: "d", text: '{"a":2}' })),
		'{"id":"m","kind":"k","messages":[{"id":"d","kind":"json","data":{"a":2}}]}',
	);
	assert.equal(
		withJsonPart(msg, { kind: "json", id: "", text: "[1]", newId: "n" }).messages[1].id,
		"n",
	);
});

test("a List reorders by drag and drop, removes, adds and pages; encode keeps the new order", async () => {
	const { component, field, t, tag } = await import("../../src/tutuca.js");
	const { components, listHandlers, listOf } = await import("../../components/microagents/ui.js");
	const { dispatchDrag } = await import("../../src/test/pbt.js");
	const Item = component({ name: "Item", fields: { id: t.string() }, view: tag.span(field("id")) });
	const Box = component({
		name: "Box",
		fields: { items: t.component("List") },
		view: render(field("items")),
		on: listHandlers("items", {
			make: (self, ctx) => ctx.scope.make("Item", { id: `i${self.items.items.length + 1}` }),
		}),
	});
	const S = scopeWith({ ...components, Item, Box }).components;
	const make = (ids) =>
		S.Box({
			items: listOf(
				S,
				"items",
				ids.map((id) => S.Item({ id })),
				{ addLabel: "Item" },
			),
		});
	const d = new Driver({ root: make(["a", "b", "c"]), document });
	const ids = () => d.state.items.items.map((x) => x.id);
	const rows = () => d.rootNode.querySelectorAll('[data-dragtype="items"]');
	dispatchDrag(rows()[2], rows()[0].parentNode);
	d.drain();
	assert.deepEqual(ids(), ["c", "a", "b"]);
	// A drop on the lower half of a row puts the item below it.
	const target = rows()[2].parentNode;
	target.getBoundingClientRect = () => ({ top: 100, height: 40 });
	const Event = document.defaultView.Event;
	rows()[0].dispatchEvent(new Event("dragstart", { bubbles: true }));
	const drop = new Event("drop", { bubbles: true, cancelable: true });
	Object.defineProperty(drop, "clientY", { value: 130 });
	target.dispatchEvent(drop);
	rows()[0].dispatchEvent(new Event("dragend", { bubbles: true }));
	d.drain();
	assert.deepEqual(ids(), ["a", "b", "c"]);
	d.send(ROOT, "reorder_items", ["c", 0]);
	assert.deepEqual(ids(), ["c", "a", "b"]);
	[...d.rootNode.querySelectorAll('button[title="Remove"]')][1].click();
	d.drain();
	[...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === "+ Item").click();
	d.drain();
	assert.deepEqual(ids(), ["c", "b", "i3"]);
	assert.deepEqual(d.problems, []);
	// Pages: no pager until there are more items than fit in a page; adding shows the last page.
	const many = new Driver({ root: make(Array.from({ length: 10 }, (_, i) => `x${i}`)), document });
	assert.equal(many.rootNode.querySelector('button[title="Next page"]'), null);
	[...many.rootNode.querySelectorAll("button")].find((b) => b.textContent === "+ Item").click();
	many.drain();
	assert.equal(many.state.items.pagerLabel, "11–11 of 11");
	assert.equal(many.rootNode.querySelectorAll('[data-dragtype="items"]').length, 1);
	assert.notEqual(many.rootNode.querySelector('button[title="Next page"]'), null);
	const msg = decodeMessage(
		'{"id":"m","kind":"k","messages":[{"id":"a","kind":"x","data":1},{"id":"o","kind":"other","data":1},{"id":"b","kind":"x","data":2}]}',
	);
	const out = encodeParts(msg, {
		x: { items: [{ id: "b" }, { id: "a" }], ordered: true, same: () => true },
	});
	assert.deepEqual(
		out.messages.map((m) => m.id),
		["b", "o", "a"],
	);
});

test("tables page their rows; ⚙ sets the rows per page; JSON views open as trees", () => {
	const rows = Array.from({ length: 23 }, (_, i) => ({ n: i + 1 }));
	const d = new Driver({ root: C.DataTable({ id: "t", kind: "table", rows }), document });
	assert.equal(d.state.pagerLabel, "1–10 of 23");
	assert.equal(d.state.previewRows.length, 10);
	d.send(ROOT, "page_last", []);
	assert.equal(d.state.pagerLabel, "21–23 of 23");
	assert.equal(d.state.previewRows[0].cells[0].text, "21");
	assert.equal(d.state.noNext, true);
	assert.equal(d.rootNode.querySelector("select"), null);
	[...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === "⚙").click();
	d.drain();
	const pick = d.rootNode.querySelector('select[aria-label="Rows per page"]');
	pick.value = "5";
	pick.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
	d.drain();
	assert.equal(d.state.pagerLabel, "21–23 of 23");
	d.send(ROOT, "page_first", []);
	assert.equal(d.state.pagerLabel, "1–5 of 23");
	assert.deepEqual(d.problems, []);
	const small = C.DataTable({ id: "s", kind: "table", rows: rows.slice(0, 3) });
	assert.equal(small.hasPager, false);
	assert.equal(C.JsonView(jsonViewArgs({ a: 1 }, { editable: true })).showTree, true);
	assert.equal(C.JsonView(jsonViewArgs("{oops", { editable: true })).showRawEditor, true);
});

test("Ctrl+click folds or unfolds a JSON node and its siblings", () => {
	const d = new Driver({
		root: C.JsonView(jsonViewArgs({ a: { x: 1 }, b: [1], c: 3, d: { y: { z: 1 } } })),
		document,
	});
	const keys = () => d.state.treeRows.map((r) => r.key);
	const row = (key) =>
		[...d.rootNode.querySelectorAll('[class*="cursor-default"]')].find(
			(r) => r.children[1].textContent === key,
		);
	const { MouseEvent } = document.defaultView;
	row("a").dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
	d.drain();
	assert.deepEqual(keys(), ["$", "a", "b", "c", "d"]);
	row("d").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
	d.drain();
	assert.deepEqual(keys(), ["$", "a", "x", "b", "0", "c", "d", "y", "z"]);
	row("b").dispatchEvent(new MouseEvent("click", { bubbles: true }));
	d.drain();
	assert.deepEqual(keys(), ["$", "a", "x", "b", "c", "d", "y", "z"]);
	assert.deepEqual(d.problems, []);
});
