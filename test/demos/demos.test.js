import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { COMPOSITION_KINDS, canvas } from "../../components/canvas/index.js";
import { inferSchema, schemaDocument } from "../../components/json-schema/infer.js";
import { quadraticLabel } from "../../components/math/workbench.js";
import { notesComponents } from "../../components/notes/index.js";
import { addDays } from "../../components/todo/dates.js";
import { TODAY } from "../../components/todo/fixtures.js";
import { BUNDLES } from "../../demos/canvas/bundles.js";
import { start as startCanvas } from "../../demos/canvas/main.js";
import { start as startComposition } from "../../demos/composition/main.js";
import { start as startDrawing } from "../../demos/drawing/main.js";
import { start as startStudio } from "../../demos/json-schema/main.js";
import { start as startKanban } from "../../demos/kanban/main.js";
import { start as startLang } from "../../demos/lang/main.js";
import { start as startMath } from "../../demos/math/main.js";
import { start as startNotes } from "../../demos/notes/main.js";
import { RELAY_URL, syncFromQuery } from "../../demos/sync/engines.js";
import { start as startTracker } from "../../demos/thing-tracker/main.js";
import { start as startTodo } from "../../demos/todo/main.js";
import { start as startTreeSpec } from "../../demos/tree-spec/main.js";
import { bareShell } from "../../scripts/app.js";
import { startSynced } from "../../src/sync/index.js";
import { relay } from "../../src/sync/remote.js";
import { Host, specOf } from "../../src/tutuca.js";
import { assertClean, dom, mountDemo, settle } from "../helpers.js";

// Boots a demo in jsdom, collecting what would go to console.error.
// The notebook's bundle on a plain canvas, notes and a hole, for the canvas's own mechanics:
// what the default bundle starts with is its showcase, which the tests after these check.
const PLAIN = {
	...BUNDLES.default,
	id: "default",
	make: (C) =>
		canvas(
			C,
			[
				[48, 48, "notes"],
				[420, 120, C.Hole(), "Empty", 240],
			],
			{},
			COMPOSITION_KINDS,
		),
};

test("drawing demo: picks a tool", async () => {
	const app = mountDemo(startDrawing);
	assert.equal(app.state().shapes.length, 5);
	app.fire("click", app.$('button[title="Rectangle (R)"]'));
	assert.equal(app.state().tool, "rect");
	await assertClean(app);
});

test("tree spec demo: steps through an exported scenario", async () => {
	const scenario = JSON.parse(
		readFileSync(new URL("../../demos/tree-spec/scenarios/requests.json", import.meta.url), "utf8"),
	);
	const app = mountDemo(startTreeSpec, scenario);
	app.fire("click", app.$("section button.btn-outline"));
	assert.equal(app.state().trail.length, 1);
	await assertClean(app);
});

test("kanban demo: moves a dragged card to the column it's dropped on", async () => {
	const app = mountDemo(startKanban);
	const [todo, , done] = app.rootNode.querySelectorAll(".grid > div");
	const card = todo.querySelector('[data-dragtype="card"]');
	app.fire("dragstart", card);
	app.fire("dragover", done);
	app.fire("drop", done);
	app.fire("dragend", card);
	assert.deepEqual(
		app.state().columns.map((column) => column.cards.length),
		[2, 1, 1],
	);
	await assertClean(app);
});

test("composition demo: a picker becomes the cell picked, and adds pickers around it", async () => {
	const app = mountDemo(startComposition);
	const kinds = () => app.state().order.map((key) => specOf(app.state().entries[key].content).name);
	app.fire("click", app.$('[data-choice="tracker"]'));
	app.fire("click", app.$('[data-choice="group:pets/care"]'));
	assert.deepEqual(kinds(), ["TrackerCell"]);
	app.fire("click", app.$('[title="Add a cell at the end"]'));
	app.fire("click", app.$('[data-choice="kanban"]'));
	assert.deepEqual(kinds(), ["TrackerCell", "Board"]);
	await assertClean(app);
});

test("canvas demo: a click adds a hole, which becomes what's picked; items move, collapse and go", async () => {
	const app = mountDemo(startCanvas, PLAIN);
	const { MouseEvent } = app.rootNode.ownerDocument.defaultView;
	const pointer = (type, el, x, y) =>
		el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
	const items = () => app.state().order.map((key) => app.state().items[key]);
	const kinds = () => items().map((item) => specOf(item.content).name);
	assert.deepEqual(kinds(), ["Notes", "Hole"]);
	const bg = app.$(".canvas-bg");
	pointer("pointerdown", bg, 900, 500);
	pointer("pointerup", bg, 901, 500);
	assert.deepEqual(kinds(), ["Notes", "Hole", "Hole"]);
	assert.deepEqual([items()[2].x, items()[2].y], [900, 500]);
	assert.equal(app.rootNode.querySelectorAll("foreignObject").length, 3);
	// A press dragged away isn't a click.
	pointer("pointerdown", bg, 100, 900);
	pointer("pointerup", bg, 300, 900);
	assert.equal(kinds().length, 3);
	const lastItem = () => app.rootNode.querySelectorAll("foreignObject")[2];
	app.fire("click", lastItem().querySelector('[title="Put a component here"]'));
	app.fire("click", lastItem().querySelector('[data-choice="kanban"]'));
	assert.deepEqual(kinds(), ["Notes", "Hole", "Board"]);
	// The notes, dragged by their header from 10px into it, come to the front where it's let go.
	pointer("pointerdown", app.$("foreignObject header"), 58, 58);
	assert.deepEqual(kinds(), ["Hole", "Board", "Notes"]);
	pointer("pointermove", bg, 210, 310);
	pointer("pointerup", bg, 210, 310);
	assert.deepEqual([items()[2].x, items()[2].y], [200, 300]);
	assert.equal(kinds().length, 3, "letting go of a drag adds no hole");
	// A press on a header's button doesn't capture the pointer (a captured press never clicks
	// in a browser), so the click that follows reaches the button.
	let captures = 0;
	app.$("svg").setPointerCapture = () => captures++;
	const press = (el) => {
		pointer("pointerdown", el, 0, 0);
		pointer("pointerup", el, 0, 0);
		app.fire("click", el);
	};
	press(lastItem().querySelector('[title^="Collapse or expand"]'));
	assert.equal(items()[2].collapsed, true);
	press(lastItem().querySelector('[title="Remove"]'));
	assert.deepEqual(kinds(), ["Hole", "Board"]);
	assert.equal(captures, 0, "pressing a header's button captures nothing");
	pointer("pointerdown", app.$("foreignObject header"), 58, 58);
	pointer("pointerup", bg, 58, 58);
	assert.equal(captures, 1, "pressing the header itself does");
	await assertClean(app);
});

test("canvas demo: Ctrl+click collapses every item, an item maximizes, the canvas zooms and grows", async () => {
	const app = mountDemo(startCanvas, PLAIN);
	const { MouseEvent, KeyboardEvent, WheelEvent } = app.rootNode.ownerDocument.defaultView;
	const items = () => app.state().order.map((key) => app.state().items[key]);
	const toggles = () => app.rootNode.querySelectorAll('svg [title^="Collapse or expand"]');
	toggles()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
	assert.deepEqual(
		items().map((item) => item.collapsed),
		[true, true],
		"every item collapses",
	);
	toggles()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
	assert.deepEqual(
		items().map((item) => item.collapsed),
		[true, false],
		"a plain click, only its own",
	);
	// An item as tall as its content stops growing, and scrolls.
	assert.match(
		app.rootNode.querySelectorAll(".canvas-card")[1].getAttribute("style"),
		/max-height: ?720px/,
	);
	// Maximized, it shows over the page, till it's restored or Esc is pressed.
	assert.equal(app.$(".canvas-maximized"), null);
	app.fire("click", app.$('svg [title="Maximize"]'));
	assert.equal(app.state().maximized, app.state().order[0]);
	assert.ok(app.$(".canvas-maximized"));
	app.fire("click", app.$('.canvas-maximized [aria-label="Restore"]'));
	assert.equal(app.$(".canvas-maximized"), null);
	app.fire("click", app.$('svg [title="Maximize"]'));
	app
		.$(".canvas-root")
		.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
	assert.equal(app.state().maximized, "");
	// Zooming scales the svg, not the canvas; Ctrl+wheel zooms, the wheel alone doesn't.
	const svg = () => app.$("svg.canvas-svg");
	const { width, height } = app.state();
	app.fire("click", app.$('[aria-label="Zoom out"]'));
	assert.equal(app.state().zoom, 0.8);
	assert.equal(svg().getAttribute("width"), String(Math.round(width * 0.8)));
	assert.equal(svg().getAttribute("viewBox"), `0 0 ${width} ${height}`);
	app.fire("click", app.$('[aria-label="Actual size"]'));
	assert.equal(app.state().zoom, 1);
	svg().dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
	assert.equal(app.state().zoom, 1);
	svg().dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100, ctrlKey: true }));
	assert.ok(app.state().zoom > 1);
	// A hole near the edge grows the canvas past it.
	const bg = app.$(".canvas-bg");
	const pointer = (type, x, y) =>
		bg.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
	pointer("pointerdown", width - 10, 100);
	pointer("pointerup", width - 10, 100);
	assert.ok(app.state().width > width, "the canvas grows");
	await assertClean(app);
});

test("canvas demo: items resize by their corner; shapes are drawn, styled, moved and deleted", async () => {
	const app = mountDemo(startCanvas, PLAIN);
	const { MouseEvent, KeyboardEvent } = app.rootNode.ownerDocument.defaultView;
	const pointer = (type, el, x, y, more = {}) =>
		el.dispatchEvent(
			new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...more }),
		);
	const bg = app.$(".canvas-bg");
	const notes = () => app.state().items["item-1"];
	// The notes are at 48, 48 and 320 wide; jsdom shows them 0 tall.
	pointer("pointerdown", app.$('[title="Drag to resize"]'), 368, 48);
	pointer("pointermove", bg, 468, 348);
	pointer("pointerup", bg, 468, 348);
	assert.deepEqual([notes().width, notes().height], [420, 300]);
	assert.match(
		[...app.rootNode.querySelectorAll(".canvas-card")].at(-1).getAttribute("style"),
		/height: ?300px/,
	);
	assert.deepEqual(app.state().order, ["item-2", "item-1"], "a resized item comes to the front");
	const tool = (name) => app.fire("click", app.$(`[aria-label="Tools"] [value="${name}"]`));
	const shapes = () => app.state().shapes;
	const draw = (from, to, more) => {
		pointer("pointerdown", bg, ...from);
		pointer("pointermove", bg, ...to, more);
		pointer("pointerup", bg, ...to, more);
	};
	// The drawing tools, fill and stroke show once the drawing toggle is on.
	assert.equal(app.$('[aria-label="Tools"] [value="arrow"]'), null);
	app.fire("click", app.$('[aria-label="Draw: lines, arrows, shapes and text"]'));
	tool("arrow");
	app.fire("click", app.$('[aria-label="Stroke #ef4444"]'));
	draw([600, 600], [800, 650]);
	tool("rect");
	app.fire("click", app.$('[aria-label="Fill #22c55e"]'));
	draw([900, 600], [1000, 640], { shiftKey: true });
	assert.deepEqual(
		shapes().map((s) => [specOf(s).name, s.stroke, s.fill]),
		[
			["Arrow", "#ef4444", "none"],
			["Rect", "#ef4444", "#22c55e"],
		],
	);
	assert.deepEqual([shapes()[1].x1, shapes()[1].y1], [1000, 700], "shift draws a square");
	assert.equal(app.state().selected, shapes()[1].id, "a drawn shape is selected");
	assert.equal(app.state().order.length, 2, "drawing adds no hole");
	// Text goes where it's clicked, selected, and edited in the toolbar.
	tool("text");
	pointer("pointerdown", bg, 100, 1000);
	pointer("pointerup", bg, 100, 1000);
	assert.equal(app.state().tool, "select");
	app.fire("input", app.$('input[aria-label="Text"]'), "Hello");
	assert.equal(shapes()[2].text, "Hello");
	assert.equal(app.rootNode.querySelector("svg text").textContent, "Hello");
	// Selecting the arrow by pressing it, then moving it.
	const arrow = app.rootNode.querySelector("svg g g");
	pointer("pointerdown", arrow, 700, 625);
	pointer("pointermove", bg, 710, 645);
	pointer("pointerup", bg, 710, 645);
	assert.deepEqual([shapes()[0].x0, shapes()[0].y0], [610, 620]);
	app.fire("click", app.$('[aria-label="Fill #3b82f6"]'));
	assert.equal(shapes()[0].fill, "#3b82f6", "the selection takes the paint");
	app.rootNode
		.querySelector('[tabindex="0"]')
		.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
	assert.deepEqual(
		shapes().map((s) => specOf(s).name),
		["Rect", "Text"],
	);
	await assertClean(app);
});

test("canvas demo: a hole becomes a layout, edited from its item's toggle", async () => {
	const app = mountDemo(startCanvas, PLAIN);
	const item = () => app.state().items["item-2"];
	const card = () => app.rootNode.querySelectorAll("foreignObject")[1];
	const click = (selector, i = 0) => app.fire("click", card().querySelectorAll(selector)[i]);
	assert.equal(card().querySelector('[title="Edit it"]'), null, "a hole has nothing to edit");
	click('[title="Put a component here"]');
	click('[data-choice="vbox"]');
	assert.equal(specOf(item().content).name, "VBox");
	assert.equal(item().editing, true, "a new layout starts edited");
	click('[title="Add a slot below"]');
	assert.equal(item().content.items.length, 2);
	// The second slot's hole becomes a grid, edited with its parent.
	click('[title="Put a component here"]', 1);
	click('[data-choice="grid"]');
	const grid = () => item().content.items[1];
	assert.equal(specOf(grid()).name, "Grid");
	click('[title="More columns"]');
	assert.equal(grid().columns, 3);
	click('[title="Remove this slot"]', 1); // The grid's first cell.
	assert.equal(grid().items.length, 3);
	click('[title="Put a component here"]');
	click('[data-choice="notes"]');
	assert.equal(specOf(item().content.items[0]).name, "Notes");
	// Used, the layouts show no editing.
	click('[title="Use it"]');
	assert.equal(item().editing, false);
	assert.equal(card().querySelector('[title="Remove this slot"]'), null);
	assert.equal(card().querySelector('[title="More columns"]'), null);
	click('[title="Edit it"]');
	assert.ok(card().querySelector('[title="More columns"]'));
	await assertClean(app);
});

test("canvas demo: tabs add, rename, select and remove; an item's title is edited", async () => {
	const app = mountDemo(startCanvas, PLAIN);
	const item = () => app.state().items["item-2"];
	const tabs = () => item().content;
	const card = () => app.rootNode.querySelectorAll("foreignObject")[1];
	const click = (selector, i = 0) => app.fire("click", card().querySelectorAll(selector)[i]);
	click('[title="Put a component here"]');
	click('[data-choice="tabs"]');
	assert.equal(specOf(tabs()).name, "Tabs");
	click('[title="Add a tab"]');
	assert.deepEqual([tabs().items.length, tabs().active], [2, 1]);
	app.fire("input", card().querySelectorAll('[aria-label="Tab name"]')[0], "First");
	assert.deepEqual(tabs().labels, ["First", ""]);
	// The shown tab's hole becomes notes.
	click('[title="Put a component here"]');
	click('[data-choice="notes"]');
	assert.equal(specOf(tabs().items[1]).name, "Notes");
	click('[title="Use it"]');
	const headers = () => [...card().querySelectorAll('[role="tab"]')].map((t) => t.textContent);
	assert.deepEqual(headers(), ["First", "Tab 2"]);
	click('[role="tab"]');
	assert.equal(tabs().active, 0);
	click('[title="Edit it"]');
	click('[title="Remove this tab"]', 0);
	assert.deepEqual([tabs().items.length, tabs().labels, tabs().active], [1, [""], 0]);
	// The title, typed in the header, takes the place of what it holds.
	const title = () => card().querySelector('[aria-label="Title"]');
	assert.equal(title().placeholder, "🗂 Tabs");
	app.fire("input", title(), "My tabs");
	assert.equal(item().title, "My tabs");
	await assertClean(app);
});

test("canvas demo, notebook bundle: a garden project, every kind the notebook has on one canvas", async () => {
	const app = mountDemo(startCanvas);
	const items = () => app.state().order.map((key) => app.state().items[key]);
	assert.deepEqual(
		items().map((item) => specOf(item.content).name),
		["Markdown", "Drawing", "Board", "TodoApp", "Tabs"],
	);
	const [plan, yard, seedlings, tasks, tabs] = items().map((item) => item.content);
	assert.match(plan.text, /^# 🌱 Spring garden/);
	assert.ok(yard.shapes.length > 4, "the yard is drawn");
	assert.deepEqual(
		seedlings.columns.map((c) => c.title),
		["Seeds", "Sprouting", "Planted out"],
	);
	assert.equal(tasks.currentProject.name, "Garden", "the tasks open on the garden's project");
	assert.deepEqual(
		tabs.items.map((c) => specOf(c).name),
		["TrackerCell", "Notes"],
	);
	assert.equal(tabs.items[0].things.find((t) => t.id === "thing:home/plants").total, 5);
	assert.ok(app.state().shapes.some((shape) => specOf(shape).name === "Arrow"));
	await assertClean(app);
});

test("canvas demo, llm bundle: a weather agent's turn, and holes that become its parts", async () => {
	const app = mountDemo(startCanvas, "llm");
	const kinds = () => app.state().order.map((key) => specOf(app.state().items[key].content).name);
	assert.deepEqual(kinds(), [
		"InferenceRequest",
		"InferenceResponse",
		"ToolResult",
		"InferenceRequest",
		"InferenceResponse",
		"Transcript",
		"StructuredOutput",
	]);
	const content = (key) => app.state().items[key].content;
	assert.equal(app.state().items["item-1"].label, "📤 1. Request: the question and a tool");
	assert.equal(content("item-2").stopReason, "toolUse");
	assert.equal(content("item-4").messages.length, 3, "the second request sends the result too");
	assert.equal(content("item-5").stopReason, "stop");
	assert.equal(content("item-5").cacheRead, 412, "reading the first call's prompt from the cache");
	assert.ok(app.$(".llm-valid"), "the example's output matches its schema");
	// A hole lists the bundle's kinds (and the canvas's), not the notebook's.
	const bg = app.$(".canvas-bg");
	const { MouseEvent } = app.rootNode.ownerDocument.defaultView;
	for (const type of ["pointerdown", "pointerup"]) {
		bg.dispatchEvent(
			new MouseEvent(type, { bubbles: true, clientX: 1300, clientY: 1400, button: 0 }),
		);
	}
	const hole = () => [...app.rootNode.querySelectorAll("foreignObject")].at(-1);
	app.fire("click", hole().querySelector('[title="Put a component here"]'));
	assert.equal(hole().querySelector('[data-choice="notes"]'), null);
	assert.ok(hole().querySelector('[data-choice="vbox"]'));
	// Labeled by what each kind's component says in its canvas meta, or by the kind's own.
	assert.equal(hole().querySelector('[data-choice="toolResult"]').textContent, "📦 Tool result");
	assert.equal(hole().querySelector('[data-choice="vbox"]').textContent, "⬇️ Vertical box");
	assert.equal(hole().querySelector('[data-choice="json"]').textContent, "{} JSON");
	app.fire("click", hole().querySelector('[data-choice="toolResult"]'));
	assert.equal(kinds().at(-1), "ToolResult");
	const made = app.state().items[app.state().order.at(-1)];
	assert.deepEqual([made.label, made.width, made.editing], ["📦 Tool result", 420, true]);
	await assertClean(app);
});

test("canvas demo, http bundle: a GET that checks out, a POST that doesn't and the contract", async () => {
	const app = mountDemo(startCanvas, "http");
	const kinds = () => app.state().order.map((key) => specOf(app.state().items[key].content).name);
	assert.deepEqual(kinds(), [
		"HttpRequest",
		"HttpResponse",
		"HttpExchange",
		"ApiOperation",
		"JsonSchemaEditor",
		"HttpExchange",
		"HttpExchange",
	]);
	const failures = (key) => app.state().items[key].content.failures;
	assert.equal(app.state().items["item-3"].label, "✅ Reading a task: it checks out");
	assert.equal(failures("item-3"), 0, "the GET checks out");
	assert.ok(failures("item-6") >= 5, "the buggy POST doesn't");
	assert.equal(failures("item-7"), 0, "the fixed one does");
	assert.ok(app.$(".http-exchange .http-ok"));
	assert.ok(app.$(".http-exchange .http-fail"));
	await assertClean(app);
});

test("canvas demo, music bundle: a song in G, its key, scale, chords, solo and key change", async () => {
	const app = mountDemo(startCanvas, "music");
	const kinds = () => app.state().order.map((key) => specOf(app.state().items[key].content).name);
	assert.deepEqual(kinds(), [
		"CircleOfFifths",
		"ScaleExplorer",
		"ScaleExplorer",
		"ChordExplorer",
		"ChordExplorer",
		"ChordExplorer",
		"ChordExplorer",
		"OffsetExplorer",
		"Markdown",
	]);
	const content = (key) => app.state().items[key].content;
	const card = (key) =>
		app.rootNode.querySelectorAll("foreignObject")[app.state().order.indexOf(key)];
	assert.equal(app.state().items["item-1"].label, "⭕ The key: G major");
	assert.equal(content("item-1").selected, 1, "G on the circle");
	// The progression, I – V – vi – IV.
	assert.deepEqual(
		["item-4", "item-5", "item-6", "item-7"].map((key) => content(key).piano.labels),
		[
			["G", "B", "D"],
			["D", "F♯", "A"],
			["E", "G", "B"],
			["C", "E", "G"],
		],
	);
	app.fire(
		"click",
		card("item-4").querySelectorAll('.music-chords [aria-label="Root"] > button')[0],
	);
	assert.deepEqual(content("item-4").piano.labels, ["C", "E", "G"]);
	// The key change marks G major and where a whole step moves it, on either instrument.
	assert.deepEqual(content("item-8").piano.labels, ["G", "B", "D", "A", "C♯", "E"]);
	app.fire("click", card("item-8").querySelectorAll('[aria-label="Root"] > button')[0]);
	assert.deepEqual(content("item-8").piano.labels, ["C", "E", "G", "D", "F♯", "A"]);
	app.fire(
		"click",
		card("item-8").querySelector('[aria-label="Instrument"] > button:nth-of-type(2)'),
	);
	assert.ok(card("item-8").querySelector(".guitar-neck"));
	// The scale on the piano, the root in amber; the solo's pentatonic on the guitar.
	assert.deepEqual(content("item-3").guitar.marked, [7, 9, 11, 2, 4]);
	assert.ok(card("item-3").querySelector(".guitar-neck"), "the solo starts on the guitar");
	const scale = () => card("item-2");
	app.fire("click", scale().querySelectorAll('[aria-label="Root"] > button')[9]);
	app.fire("change", scale().querySelector('[aria-label="Scale"]'), "minor");
	assert.deepEqual(content("item-2").piano.labels, ["A", "B", "C", "D", "E", "F", "G", "A"]);
	assert.deepEqual(content("item-2").guitar.marked, [9, 11, 0, 2, 4, 5, 7]);
	assert.equal(scale().querySelector(".guitar-neck"), null, "the piano first");
	app.fire("click", scale().querySelector('[aria-label="Instrument"] > button:nth-of-type(2)'));
	assert.ok(scale().querySelector(".guitar-neck"));
	assert.equal(scale().querySelector(".piano-keys"), null, "then the guitar alone");
	await assertClean(app);
});

test("lang demo: switches notation and edits the program", async () => {
	const app = mountDemo(startLang);
	const output = () => app.$('[aria-label="Result"]').textContent;
	assert.equal(output(), '⇒ "ADA!"');
	app.fire("click", app.$('[data-notation="forth"]'));
	assert.match(app.$("pre").textContent, /IF .* ELSE .* THEN/);
	app.fire("click", app.$('[data-mode="edit"]'));
	assert.equal(app.state().viewName, "editForth");
	app.fire("input", app.$('[aria-label="number"]'), "2");
	assert.equal(output(), '⇒ s" 3"');
	await assertClean(app);
});

test("a demo's time travel bar steps back to an earlier state", async () => {
	const app = mountDemo(startLang);
	const bar = app.rootNode.previousElementSibling;
	assert.equal(bar.className, "time-travel");
	app.fire("click", app.$('[data-notation="forth"]'));
	app.fire("click", app.$('[data-mode="edit"]'));
	await settle();
	assert.match(bar.textContent, /state 3 of 3 · ☝ click → setMode\("edit"\)/);
	app.fire("click", bar.querySelector('button[title="Back"]'));
	await settle();
	assert.equal(app.state().viewName, "viewForth");
	app.fire("click", bar.querySelector('button[title="First state"]'));
	await settle();
	assert.equal(app.state().viewName, "viewLisp");
	assert.match(bar.textContent, /state 1 of 3 · ◆ initial/);
	await assertClean(app);
});

test("math demo: saves, reopens and removes problems", async () => {
	const app = mountDemo(startMath);
	const save = () =>
		app.fire(
			"click",
			[...app.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Save problem"),
		);
	save();
	assert.equal(app.state().history.length, 3);
	assert.equal(app.state().history[0].label, quadraticLabel(1, -3, 2));
	assert.equal(app.state().history[0].label, "x² − 3x + 2 = 0");
	save(); // Already saved: no duplicate.
	assert.equal(app.state().history.length, 3);
	app.fire("click", app.rootNode.querySelectorAll('button[title="Open"]')[2]);
	assert.equal(app.state().tab, "matrix");
	assert.deepEqual([app.state().matrix.a, app.state().matrix.d], [2, 2]);
	assert.equal(app.state().matrix.det, 0);
	app.fire("click", app.$('[aria-label="Remove problem"]'));
	assert.equal(app.state().history.length, 2);
	await assertClean(app);
});

test("todo demo: quick adds a task in plain words", async () => {
	const today = TODAY;
	const app = mountDemo(startTodo, today);
	app.fire("input", app.$('[aria-label="Quick add"]'), "Call mom tomorrow p1 #Errands");
	app.fire("submit", app.$('[aria-label="Quick add task"]'));
	const task = app.state().tasks.at(-1);
	assert.equal(task.title, "Call mom");
	assert.equal(task.due, addDays(today, 1));
	assert.equal(task.priority, 1);
	assert.equal(app.state().projects.find((p) => p.id === task.projectId).name, "Errands");
	await assertClean(app);
});

test("json studio demo: the schema follows the payload", async () => {
	const app = mountDemo(startStudio);
	const properties = () => app.state().schema.toSchema().properties;
	assert.deepEqual(Object.keys(properties()).slice(0, 3), ["orderId", "createdAt", "status"]);
	assert.equal(properties().createdAt.format, "date-time");
	// Renaming a key in the editor infers the schema again.
	app.fire("input", app.$('[aria-label="key"]'), "orderNumber");
	await settle();
	assert.ok("orderNumber" in properties());
	assert.equal(app.state().isStale, false);
	app.fire("change", app.$('[aria-label="Sample payload"]'), "user");
	assert.equal(properties().email.format, "email");
	assert.equal(app.state().schema.toSchema().title, "User");
	app.fire("input", app.$('[aria-label="JSON to paste"]'), "{ nope");
	app.fire(
		"click",
		[...app.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Use this JSON"),
	);
	assert.match(app.state().pasteError, /^Not JSON/);
	app.fire("input", app.$('[aria-label="JSON to paste"]'), '{"n": 1, "xs": [1, 2.5]}');
	app.fire(
		"click",
		[...app.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Use this JSON"),
	);
	assert.deepEqual(properties(), {
		n: { type: "integer" },
		xs: { type: "array", items: { type: "number" } },
	});
	await assertClean(app);
});

test("inferSchema: types, formats, required keys and merged items", () => {
	assert.deepEqual(inferSchema({ a: 1, b: "x@y.io", c: null, d: true }), {
		type: "object",
		properties: {
			a: { type: "integer" },
			b: { type: "string", format: "email" },
			c: { type: "null" },
			d: { type: "boolean" },
		},
		required: ["a", "b", "c", "d"],
	});
	assert.deepEqual(inferSchema([]), { type: "array" });
	assert.deepEqual(inferSchema(["2026-01-02", "https://a.io/x"]), {
		type: "array",
		items: { type: "string" },
	});
	// Objects merge: properties from all, required only those in every one.
	assert.deepEqual(inferSchema([{ id: 1, tag: "a" }, { id: 2.5 }]), {
		type: "array",
		items: {
			type: "object",
			properties: { id: { type: "number" }, tag: { type: "string" } },
			required: ["id"],
		},
	});
	// Different types: a union, same-typed branches merged.
	assert.deepEqual(inferSchema([1, "a", 2.5, null]).items, {
		anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
	});
	assert.deepEqual(schemaDocument({ type: "null" }, "T"), {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: "T",
		type: "null",
	});
});

test("thing tracker demo: logs a thing with a tap", async () => {
	const app = mountDemo(startTracker, Date.UTC(2026, 9, 16, 10, 30));
	const before = app.state().events.length;
	assert.ok(before > 50);
	app.fire("click", app.$('[aria-label^="Log Coffee"]'));
	await settle();
	assert.equal(app.state().events.length, before + 1);
	assert.equal(app.state().events.at(-1).thingId, "thing:hydration/coffee");
	await assertClean(app);
});

// A port to an in-process backend, answering like demos/sync/backend.js does.
const backendPorts = () => {
	const remote = relay();
	const ports = new Set();
	const connect = () => {
		const port = {
			onmessage: null,
			deliver(data) {
				setTimeout(() => port.onmessage?.({ data: structuredClone(data) }), 0);
			},
			postMessage(data) {
				if (data.type === "load")
					port.deliver({ type: "loaded", id: data.id, state: remote.load() });
				else if (data.type === "push") {
					const message = remote.receive(structuredClone(data.batch));
					for (const p of ports) p.deliver({ type: "message", message });
				}
			},
		};
		ports.add(port);
		return port;
	};
	return { remote, connect };
};
const memoryStorage = () => {
	const items = new Map();
	return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) };
};
const page = (query) =>
	dom('<header class="demo-bar"></header><div id="app"></div>', {
		url: `http://localhost/demos/notes/${query}`,
	});
const started = async (host) => {
	while (host.root === null) await settle();
	return host;
};

test("boot syncs any demo from the query: ?sync=local keeps the state in this browser", async () => {
	const window = page("?sync=local");
	const host = await started(startNotes(window.document));
	const $ = (selector) => window.document.querySelector(selector);
	$('[aria-label="New note"]').value = "buy milk";
	$('[aria-label="New note"]').dispatchEvent(new window.Event("input", { bubbles: true }));
	$("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	assert.match($(".sync-log").textContent, /sent: insert/);
	assert.equal($('.sync-modes [aria-current="page"]').textContent, "this browser");
	// Another page on the same address, in the same browser, starts from it.
	const again = page("?sync=local");
	Object.defineProperty(again, "localStorage", { value: window.localStorage });
	const other = await started(startNotes(again.document));
	assert.deepEqual(
		other.root.notes.map((n) => n.text),
		["buy milk"],
	);
	void host;
});

test("without ?sync a demo starts at once, its only engine the time travel history", () => {
	const host = startNotes(page("").document);
	assert.equal(host.engines.list.length, 1);
	assert.notEqual(host.root, null);
	assert.equal(startNotes(page("?history=0").document).engines.list.length, 0);
});

test("?sync=worker: tabs sync through the backend, and a new tab starts from it", async () => {
	const backend = backendPorts();
	const storage = memoryStorage();
	const open = async () => {
		const window = page("?sync=worker");
		const host = new Host({
			document: window.document,
			rootNode: window.document.getElementById("app"),
		});
		host.scope.register(notesComponents);
		const engines = await syncFromQuery(window, { connect: backend.connect, storage });
		await startSynced(host, { engines, make: (C) => C.Notes() });
		return host;
	};
	const a = await open();
	await settle();
	const b = await open();
	a.applyChange((d) => void d.notes.push(a.scope.make("Note", { text: "buy milk" })));
	await settle();
	assert.deepEqual(
		b.root.notes.map((n) => n.text),
		["buy milk"],
	);
	a.applyChange((d) => {
		d.filter = "open";
		d.draft = "unsaved";
	});
	const c = await open();
	assert.equal(c.root.notes[0].text, "buy milk");
	assert.equal(c.root.filter, "open"); // local: from this browser's storage
	assert.equal(c.root.draft, ""); // none: not kept
	assert.deepEqual(backend.remote.load().value.notes, [
		{ $: "Note", text: "buy milk", done: false },
	]);
});

test("?sync=relay: the Automerge document also syncs through the public relay", async () => {
	const { docHandle } = await import("../../src/sync/automerge.js");
	const window = page("?sync=relay");
	const opened = [];
	const open = (_, options) => {
		opened.push(options);
		return docHandle();
	};
	const engines = await syncFromQuery(window, { open, storage: memoryStorage() });
	assert.deepEqual(opened, [{ relay: RELAY_URL }]);
	assert.equal(engines[0].level, "shared");
});

test("?sync=automerge: tabs on the same document merge", async () => {
	const { docHandle } = await import("../../src/sync/automerge.js");
	const { clone } = await import("@automerge/automerge");
	const handle = docHandle();
	const open = async (h) => {
		const window = page("?sync=automerge");
		const host = new Host({
			document: window.document,
			rootNode: window.document.getElementById("app"),
		});
		host.scope.register(notesComponents);
		const engines = await syncFromQuery(window, { open: () => h, storage: memoryStorage() });
		await startSynced(host, { engines, make: (C) => C.Notes() });
		return host;
	};
	const a = await open(handle);
	const other = docHandle(clone(handle.doc()));
	const b = await open(other);
	a.applyChange((d) => void d.notes.push(a.scope.make("Note", { text: "from a" })));
	b.applyChange((d) => {
		d.title = "Merged";
	});
	handle.merge(other.doc());
	other.merge(handle.doc());
	for (const host of [a, b]) {
		assert.equal(host.root.title, "Merged");
		assert.equal(host.root.notes[0].text, "from a");
	}
});

test("canvas demo, agent bundle: with a model, a board's item wraps it in an agent and ejects it", async () => {
	const models = [{ provider: "echo", id: "echo", name: "Echo" }];
	const app = mountDemo(startCanvas, "agent", {
		inferenceAvailable: () => true,
		models: () => models,
	});
	const item = () => app.state().target.items["item-1"];
	assert.equal(app.state().target.agentsAvailable, true);
	assert.equal(specOf(item().content).name, "Board");
	const width = item().width;
	app.fire("click", app.$('[title="Wrap in an agent"]'));
	assert.equal(specOf(item().content).name, "Agent");
	assert.equal(specOf(item().content.target).name, "Board");
	assert.ok(item().width > width, "wider, for the chat");
	assert.equal(app.$('[title="Drive another component"]'), null, "the item ejects it instead");
	// The release notes beside it can still have one.
	assert.equal(app.rootNode.querySelectorAll('[title="Wrap in an agent"]').length, 1);
	// The echo model runs the tool a prompt names, on the board in the agent.
	app.fire(
		"input",
		app.$('.canvas-card textarea[aria-label="Prompt"]'),
		'/move_card {"id": "c00", "column": 2, "at": 0}',
	);
	app.fire("submit", app.$(".canvas-card form.agent-prompt"));
	assert.deepEqual(
		item().content.target.columns[2].cards.map((c) => c.id),
		["c00", "c20", "c21"],
	);
	// Ejected, the board is back in the item as the agent left it, as wide as it was.
	app.fire("click", app.$('[title="Eject it from the agent"]'));
	assert.equal(specOf(item().content).name, "Board");
	assert.deepEqual(
		item().content.columns[2].cards.map((c) => c.id),
		["c00", "c20", "c21"],
	);
	assert.equal(item().width, width);
	await assertClean(app);
});

test("canvas demo, agent bundle: without a model, nothing to wrap in an agent", async () => {
	const app = mountDemo(startCanvas, "agent", { inferenceAvailable: () => false });
	assert.equal(app.state().target.agentsAvailable, false);
	assert.equal(app.$('[title="Wrap in an agent"]'), null);
	await assertClean(app);
});

test("a demo served as an app (scripts/app.js): every demo's page without the demo bar", () => {
	const demos = readdirSync(new URL("../../demos/", import.meta.url), { withFileTypes: true })
		.filter((d) => d.isDirectory() && d.name !== "deps" && d.name !== "sync")
		.map((d) => d.name);
	assert.ok(demos.includes("canvas"));
	for (const name of demos) {
		const html = readFileSync(new URL(`../../demos/${name}/index.html`, import.meta.url), "utf8");
		const page = bareShell(html, { api: "/api/" });
		assert.ok(!page.includes('class="demo-bar"'), `${name} has no demo bar`);
		assert.match(page, /<body data-chrome="none"[\s>]/, `${name} is marked bare`);
		assert.match(page, /<meta name="tutuca-api" content="\/api\/" \/>\s*<\/head>/);
		assert.match(page, /<div id="app">/, `${name} keeps its app`);
	}
	const html = readFileSync(new URL("../../demos/canvas/index.html", import.meta.url), "utf8");
	assert.ok(!bareShell(html).includes("tutuca-api"), "no API, no meta");
});

test("a bare demo page boots without the time travel bar", async () => {
	const window = dom('<div id="app"></div>');
	window.document.body.dataset.chrome = "none";
	startLang(window.document);
	const rootNode = window.document.getElementById("app");
	assert.equal(window.document.querySelector(".time-travel"), null);
	assert.ok(rootNode.childNodes.length > 0, "renders");
	await settle();
});

test("canvas demo: an item whose chrome is pressed comes to the front", async () => {
	const app = mountDemo(startCanvas, "http");
	const order = () => app.state().order;
	assert.equal(order().at(-1), "item-7");
	const first = app.rootNode.querySelectorAll("foreignObject")[0];
	// Its title, in its header: a press there doesn't pick it up, but brings it forward.
	app.fire("pointerdown", first.querySelector('[aria-label="Title"]'));
	assert.equal(order().at(-1), "item-1");
	assert.deepEqual(order().slice(0, -1), [
		"item-2",
		"item-3",
		"item-4",
		"item-5",
		"item-6",
		"item-7",
	]);
	// The card around another one's content.
	const second = [...app.rootNode.querySelectorAll("foreignObject")][0];
	app.fire("pointerdown", second.querySelector(".canvas-card"));
	assert.equal(order().at(-1), "item-2");
	// Pressed again, it's in front already: nothing changes.
	const before = app.state();
	const front = [...app.rootNode.querySelectorAll("foreignObject")].at(-1);
	app.fire("pointerdown", front.querySelector(".canvas-card"));
	assert.equal(app.state(), before);
	await assertClean(app);
});

test("renders demo: the other renders follow the component, story by story", async () => {
	const { start } = await import("../../demos/renders/main.js");
	const page = readFileSync(new URL("../../demos/renders/index.html", import.meta.url), "utf8");
	const window = dom(page.replace(/<script[\s\S]*?<\/script>/g, ""));
	const { document } = window;
	const demo = start(document);
	const others = () => document.getElementById("others");
	const code = () => others().querySelector("code").textContent;
	const markdown = () => others().querySelector(".render-panes pre").textContent;
	// The terminal preview's rows, as text.
	const terminal = () =>
		[...others().querySelector("tutuca-terminal").shadowRoot.querySelectorAll(".row")]
			.map((row) => row.textContent.trimEnd())
			.join("\n");
	// The host renders, and so the panels follow, in a task after the click's.
	const click = async (selector) => {
		document
			.querySelector(`#app ${selector}`)
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
		const host = demo.host();
		while (host.tasks.length > 0) host.handleTasks();
		await settle();
	};
	// A group per book; the stories that generate their state aren't offered.
	assert.deepEqual(
		[...document.querySelectorAll("#story optgroup")].map((g) => g.label),
		["Counter", "Todo list", "Cart", "Kanban", "JSON"],
	);
	assert.deepEqual(
		[...document.querySelectorAll("#story option")].map((o) => o.value).slice(0, 6),
		[
			"Counter/From zero",
			"Counter/From ten",
			"Todo list/Empty",
			"Todo list/A few items",
			"Cart/Three lines",
			"Cart/Empty",
		],
	);
	assert.ok(!document.querySelector('#story option[value="JSON/Generated document"]'));
	assert.equal(code(), "C.Counter({\n  count: 0\n})");
	assert.match(terminal(), /│ − │ 0 │ \+ │/);
	await click(".btn-primary");
	assert.equal(code(), "C.Counter({\n  count: 1\n})");
	assert.match(terminal(), /│ − │ 1 │ \+ │/, "the terminal preview follows the page");
	// And the page follows the terminal: Tab to +, Enter presses it, on the page's host.
	const screen = others().querySelector("tutuca-terminal").shadowRoot.querySelector(".screen");
	for (const key of ["Tab", "Tab", "Enter"]) {
		screen.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
		);
	}
	await settle();
	assert.equal(code(), "C.Counter({\n  count: 2\n})");
	assert.equal(document.querySelector("#app .text-2xl").textContent, "2");
	assert.match(terminal(), /│ − │ 2 │ \+ │/);
	await click(".btn");
	assert.equal(code(), "C.Counter({\n  count: 1\n})");
	assert.equal(markdown(), "Count: **1**\n");
	assert.equal(others().querySelector("md-view").getAttribute("content"), "Count: **1**\n");
	demo.open("Todo list/A few items");
	assert.equal(document.getElementById("story").value, "Todo list/A few items");
	assert.equal(
		code(),
		[
			"C.TodoList({",
			'  text: "",',
			"  items: [{",
			'    title: "Read the guide",',
			"    done: true",
			"  }, {",
			'    title: "Edit this example",',
			"    done: false",
			"  }]",
			"})",
		].join("\n"),
	);
	await click('li:nth-child(2) [type="checkbox"]');
	assert.equal(markdown(), "## Todo\n\n- [x] Read the guide\n- [x] Edit this example\n\n0 left\n");
	await settle();
});

test("renders demo: the PostScript panel prints the counter's card and previews it", async () => {
	const { start } = await import("../../demos/renders/main.js");
	const page = readFileSync(new URL("../../demos/renders/index.html", import.meta.url), "utf8");
	const window = dom(page.replace(/<script[\s\S]*?<\/script>/g, ""));
	const { document } = window;
	const demo = start(document);
	const panel = () =>
		[...document.querySelectorAll("#others .render")].find(
			(s) => s.querySelector("h2").textContent === "PostScript",
		);
	const program = () => panel().querySelector("pre").textContent;
	const shown = () => [...panel().querySelectorAll("svg.ps-page tspan")].map((t) => t.textContent);
	assert.match(program(), /^%!PS-Adobe-3\.0\n/);
	assert.match(program(), /^100 36 moveto \(0\) centershow$/m);
	assert.deepEqual(shown(), ["COUNT", "0"]);
	assert.equal(panel().querySelector("svg.ps-page").getAttribute("viewBox"), "0 0 200 120");
	document
		.querySelector("#app .btn")
		.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	const host = demo.host();
	while (host.tasks.length > 0) host.handleTasks();
	await settle();
	// Below zero it's red, and its - is Latin-1's hyphen.
	assert.match(
		program(),
		/^0\.753 0\.224 0\.169 setrgbcolor\n100 36 moveto \(\\2551\) centershow$/m,
	);
	assert.deepEqual(shown(), ["COUNT", "-1"]);
	// A component without renders.ps has no panel.
	demo.open("JSON/Null");
	assert.equal(panel(), undefined);
	await settle();
});

test("renders demo: the PDF and Word panels make their files, the Word one previewed", async () => {
	const { start } = await import("../../demos/renders/main.js");
	const page = readFileSync(new URL("../../demos/renders/index.html", import.meta.url), "utf8");
	const window = dom(page.replace(/<script[\s\S]*?<\/script>/g, ""));
	const { document } = window;
	// jsdom has no object URLs: these say what they're of.
	const made = [];
	window.URL.createObjectURL = (blob) => {
		made.push(blob);
		return `blob:${made.length}`;
	};
	window.URL.revokeObjectURL = () => {};
	const demo = start(document);
	const panel = (title) =>
		[...document.querySelectorAll("#others .render")].find(
			(s) => s.querySelector("h2").textContent === title,
		);
	const link = (title) => panel(title).querySelector("a");
	// A file's made asynchronously.
	const ready = async (title) => {
		for (let i = 0; i < 200 && link(title).hidden; i++) await settle();
		assert.equal(link(title).hidden, false, `${title} made its file`);
	};
	const bytesOf = async (title) => {
		const blob = made[Number(link(title).getAttribute("href").slice(5)) - 1];
		return new Uint8Array(await blob.arrayBuffer());
	};
	demo.open("Cart/Three lines");
	await ready("PDF");
	await ready("Word");
	assert.equal(link("PDF").getAttribute("download"), "Cart.pdf");
	assert.equal(
		panel("PDF").querySelector("iframe").getAttribute("src"),
		link("PDF").getAttribute("href"),
	);
	assert.match(new TextDecoder().decode((await bytesOf("PDF")).slice(0, 8)), /^%PDF-1\.\d/);
	assert.equal(link("Word").getAttribute("download"), "Cart.docx");
	assert.deepEqual([...(await bytesOf("Word")).slice(0, 2)], [0x50, 0x4b]);
	// The preview: the cart's table, each line's row in it.
	const rows = [...panel("Word").querySelectorAll(".docx-page tr")].map((tr) =>
		[...tr.children].map((cell) => cell.textContent),
	);
	assert.deepEqual(rows, [
		["Item", "Qty", "Price", "Subtotal"],
		["Coffee beans", "2", "$12.50", "$25.00"],
		["Filters", "1", "$3.00", "$3.00"],
		["Mug", "1", "$9.75", "$9.75"],
		["Total", "4", "", "$37.75"],
	]);
	demo.open("Todo list/A few items");
	await ready("Word");
	assert.deepEqual(
		[...panel("Word").querySelectorAll(".docx-page li")].map((li) => li.textContent),
		["☒ Read the guide", "☐ Edit this example"],
	);
	await settle();
});

test("renders demo: the LLM panels follow the state, and calling a tool changes the component", async () => {
	const { start } = await import("../../demos/renders/main.js");
	const page = readFileSync(new URL("../../demos/renders/index.html", import.meta.url), "utf8");
	const window = dom(page.replace(/<script[\s\S]*?<\/script>/g, ""));
	const { document } = window;
	const demo = start(document);
	const panel = (title) =>
		[...document.querySelectorAll("#others .render")].find(
			(s) => s.querySelector("h2").textContent === title,
		);
	const context = () => panel("LLM context").querySelector("pre").textContent;
	const tools = () => panel("LLM tools");
	const offered = () => [...tools().querySelectorAll("select option")].map((o) => o.value);
	const call = async (name, input) => {
		const select = tools().querySelector("select");
		select.value = name;
		select.dispatchEvent(new window.Event("change"));
		if (input !== undefined) tools().querySelector("textarea").value = JSON.stringify(input);
		tools()
			.querySelector("form")
			.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		await settle();
		return tools().querySelector(".render-result").textContent;
	};
	assert.equal(context(), "# Counter\n\n- **Count:** 0\n\nIt's where it starts.\n");
	// No reset at 0: there's nothing to reset.
	assert.deepEqual(offered(), ["increment", "decrement"]);
	assert.equal(await call("decrement"), "→ dec()");
	assert.equal(document.querySelector("#app .text-2xl").textContent, "-1");
	assert.match(context(), /\*\*Hint:\*\* It's below zero/);
	assert.deepEqual(offered(), ["increment", "decrement", "reset"]);
	await call("reset");
	assert.equal(document.querySelector("#app .text-2xl").textContent, "0");

	demo.open("Todo list/Empty");
	assert.deepEqual(offered(), ["add_task"]);
	assert.match(context(), /There are no tasks\.\n\n> \*\*Hint:\*\* Offer to add the first tasks\./);
	assert.equal(await call("add_task", { title: "" }), 'title is at least 1 characters, not ""');
	assert.ok(tools().querySelector(".render-result").classList.contains("render-error"));
	assert.equal(await call("add_task", { title: "Buy milk" }), '→ add("Buy milk")');
	assert.match(document.querySelector("#app li").textContent, /Buy milk/);
	assert.deepEqual(offered(), ["add_task", "toggle_task", "remove_task"]);
	const toggle = JSON.parse(tools().querySelector("pre").textContent)[1];
	assert.equal(toggle.input_schema.properties.index.description, "Which task.\n- 0: Buy milk");
	await call("toggle_task", { index: 0 });
	assert.match(context(), /\[x\] Buy milk[\s\S]*Everything is done\./);
	await settle();
});

test("renders demo: nested components render their children's renders, and a child's tools call it", async () => {
	const { start } = await import("../../demos/renders/main.js");
	const page = readFileSync(new URL("../../demos/renders/index.html", import.meta.url), "utf8");
	const window = dom(page.replace(/<script[\s\S]*?<\/script>/g, ""));
	const { document } = window;
	const demo = start(document);
	const panel = (title) =>
		[...document.querySelectorAll("#others .render")].find(
			(s) => s.querySelector("h2").textContent === title,
		);
	const code = () => panel("JavaScript").querySelector("code").textContent;
	const markdown = () => panel("Markdown").querySelector("pre").textContent;
	const terminal = () =>
		[...panel("Terminal").querySelector("tutuca-terminal").shadowRoot.querySelectorAll(".row")]
			.map((row) => row.textContent.trimEnd())
			.join("\n");
	const tools = () => panel("LLM tools");
	const offered = () => [...tools().querySelectorAll("select option")].map((o) => o.value);
	const call = async (name, input) => {
		const select = tools().querySelector("select");
		select.value = name;
		select.dispatchEvent(new window.Event("change"));
		if (input !== undefined) tools().querySelector("textarea").value = JSON.stringify(input);
		tools()
			.querySelector("form")
			.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		await settle();
		return tools().querySelector(".render-result").textContent;
	};

	// The cart: each line's row in the table, its tools among the cart's, called on that line.
	demo.open("Cart/Three lines");
	// The code that makes it, each line's in the cart's array.
	const compact = () => code().replace(/\s+/g, " ");
	assert.equal(
		compact(),
		'C.Cart({ lines: [C.Line({ name: "Coffee beans", price: 12.5, quantity: 2 }), C.Line({ name: "Filters", price: 3, quantity: 1 }), C.Line({ name: "Mug", price: 9.75, quantity: 1 })] })',
	);
	assert.match(markdown(), /\| Filters +\| +1 \| +\$3\.00 \| +\$3\.00 \|/);
	assert.match(terminal(), /Mug +\[−\] 1 \[\+\] +\$9\.75 ✕/);
	assert.deepEqual(offered(), [
		"set_coffee_beans_quantity",
		"remove_coffee_beans",
		"set_filters_quantity",
		"remove_filters",
		"set_mug_quantity",
		"remove_mug",
	]);
	assert.equal(
		await call("set_filters_quantity", { quantity: -1 }),
		"quantity is at least 0, not -1",
	);
	assert.equal(await call("set_filters_quantity", { quantity: 4 }), "→ setQuantity(4)");
	assert.match(markdown(), /\| Filters +\| +4 \|/);
	// remove notifies the cart, which takes the line out.
	await call("remove_mug");
	assert.equal(
		compact(),
		'C.Cart({ lines: [C.Line({ name: "Coffee beans", price: 12.5, quantity: 2 }), C.Line({ name: "Filters", price: 3, quantity: 4 })] })',
	);
	assert.equal(document.querySelectorAll("#app .rounded-box").length, 2);

	// The board: three levels, the board's tools and a tool per column.
	demo.open("Kanban/Board/Week");
	assert.match(
		compact(),
		/^C\.Board\(\{ columns: \[C\.Column\(\{ title: "To do", cards: \[C\.Card\(\{ id: "c00", /,
	);
	assert.match(markdown(), /- \*\*Doing\*\* \(1\)\n {2}- Review the event routing\n/);
	assert.deepEqual(offered(), [
		"move_card",
		"rename_card",
		"remove_card",
		"add_column",
		"add_card_to_to_do",
		"add_card_to_doing",
		"add_card_to_done",
	]);
	await call("add_card_to_done", { title: "Ship it" });
	assert.match(markdown(), /- \*\*Done\*\* \(1\)\n {2}- Ship it\n/);
	assert.equal(
		await call("move_card", { id: "c10", column: 2, at: 0 }),
		'→ move_card("c10", 2, 0)',
	);
	assert.match(markdown(), /- \*\*Done\*\* \(2\)\n {2}- Review the event routing\n {2}- Ship it\n/);
	assert.match(terminal(), /─ Done ─/);

	// The JSON tree: recursive renders, the editor's text as a code block.
	demo.open("JSON/Document");
	assert.match(
		compact(),
		/^C\.JsonEditor\(\{ value: C\.JsonObject\(\{ entries: \[C\.JsonEntry\(\{ key: "name", value: C\.JsonString\(\{ value: "tutuca" \}\) \}\),/,
	);
	assert.match(markdown(), /- `keywords`: _2 items_\n\n {2}0\. `"ui"`/);
	assert.match(markdown(), /```json\n\{/);
	assert.match(terminal(), / {2}"keywords": \[\n {4}"ui"\n {4}"immutable"\n {2}\]/);
	assert.match(panel("LLM context").querySelector("pre").textContent, /- \*\*Mode:\*\* view/);
	// Edit, on the page: the terminal's tree edits too.
	document
		.querySelector('#app [aria-label="Mode"] button:nth-child(2)')
		.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	const host = demo.host();
	while (host.tasks.length > 0) host.handleTasks();
	await settle();
	assert.match(terminal(), /\+ add/);
	await settle();
});
