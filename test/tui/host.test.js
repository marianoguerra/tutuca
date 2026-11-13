// tutuca's Host rendering components' renders.tui into the terminal DOM: events found by position, then
// routed by tutuca's own marker walk, and keys doing what a browser does by default.
import assert from "node:assert/strict";
import test from "node:test";
import { Counter } from "../../site/examples/counter.js";
import { TodoList } from "../../site/examples/todo-list.js";
import { lint } from "../../src/lint/index.js";
import { startTui, tuiTarget } from "../../src/tui/index.js";
import {
	component,
	each,
	enableTargets,
	eventKey,
	field,
	h,
	pushView,
	render,
	renderEach,
	send,
	sourceKey,
	t,
	targetValue,
} from "../../src/tutuca.js";

// The examples enable it too; this file says so itself.
enableTargets(tuiTarget);

// startTui with tasks run by drain(), which also paints; out() is what was written since reset.
const start = (components, root, { width = 60, height = 14 } = {}) => {
	let written = "";
	const { host, screen } = startTui({
		components,
		root,
		width,
		height,
		write: (s) => (written += s),
		schedule: () => () => {},
	});
	const drain = () => {
		while (host.tasks.length > 0) host.handleTasks();
		screen.flush();
	};
	const at = (needle) => {
		const rows = screen.toString().split("\n");
		const y = rows.findIndex((r) => r.includes(needle));
		assert.notEqual(y, -1, `${JSON.stringify(needle)} is not on screen:\n${screen.toString()}`);
		return [rows[y].indexOf(needle), y];
	};
	const click = (needle, dx = 0) => {
		const [x, y] = at(needle);
		screen.click(x + dx, y);
		drain();
	};
	const type = (text) => {
		for (const key of text) screen.key({ key });
		drain();
	};
	const key = (k, mods) => {
		screen.key({ key: k, ...mods });
		drain();
	};
	return {
		host,
		screen,
		drain,
		click,
		type,
		key,
		at,
		out: () => written,
		reset: () => (written = ""),
	};
};

test("the counter's tui renders in cells and a click on + or − sends its message", () => {
	const app = start({ Counter }, (C) => C.Counter({ count: 10 }));
	assert.equal(
		app.screen.toString(),
		["╭───╮    ╭───╮", "│ − │ 10 │ + │", "╰───╯    ╰───╯"].join("\n"),
	);
	app.reset();
	app.click("+");
	assert.equal(app.host.root.count, 11);
	assert.match(app.screen.toString(), /│ − │ 11 │ \+ │/);
	// Only what changed is written: the 1, then the focus moving to the + box (inverted).
	assert.ok(app.out().length < 60, JSON.stringify(app.out()));
	app.click("−");
	app.click("−");
	assert.equal(app.host.root.count, 9);
});

test("the counter takes Tab to focus a box and Enter or space to press it", () => {
	const app = start({ Counter }, (C) => C.Counter());
	app.key("Tab");
	app.key("Enter");
	app.key(" ");
	assert.equal(app.host.root.count, -2);
	app.key("Tab");
	app.key("Enter");
	assert.equal(app.host.root.count, -1);
	app.key("Tab", { shiftKey: true });
	app.key("Enter");
	assert.equal(app.host.root.count, -2);
});

test("the todo list's input edits, submits on Enter and clears; loop items get their key", () => {
	const app = start({ TodoList }, (C) =>
		C.TodoList({ items: [{ title: "Read the guide", done: true }] }),
	);
	assert.match(app.screen.toString(), /What needs doing\?/);
	app.key("Tab"); // The input is the first that takes focus.
	app.type("Buy milkk");
	app.key("Backspace");
	assert.equal(app.host.root.text, "Buy milk");
	assert.match(app.screen.toString(), /│ Buy milk +\[Add\] │/);
	app.key("Enter");
	assert.deepEqual(
		app.host.root.items.map((i) => i.title),
		["Read the guide", "Buy milk"],
	);
	assert.equal(app.host.root.text, "");
	assert.match(app.screen.toString(), /1 left/);
	app.click("[ ] Buy milk", 1);
	assert.equal(app.host.root.items[1].done, true);
	assert.match(app.screen.toString(), /0 left/);
	// ✕ on the first row removes the first item, and morph takes its nodes out.
	app.click("✕");
	assert.deepEqual(
		app.host.root.items.map((i) => i.title),
		["Buy milk"],
	);
	assert.doesNotMatch(app.screen.toString(), /Read the guide/);
	app.click("✕");
	assert.match(app.screen.toString(), /Nothing to do\./);
});

test("the [Add] box adds what the input holds, as the form's button does", () => {
	const app = start({ TodoList }, (C) => C.TodoList());
	app.click("What needs doing?");
	app.type("Write docs");
	app.click("[Add]");
	assert.deepEqual(
		app.host.root.items.map((i) => i.title),
		["Write docs"],
	);
});

const Item = component({
	name: "Item",
	fields: { label: t.string() },
	view: h("li", {}, field("label")),
	renders: {
		tui: { main: h("text", {}, "- ", field("label")), short: h("text", {}, field("label")) },
	},
	views: { short: h("b", {}, field("label")) },
});
const Other = component({ name: "Other", fields: {}, view: h("p", {}, "plain view") });
const List = component({
	name: "List",
	fields: {
		items: t.array(t.component("Item")),
		plain: t.array(t.record({ v: t.string() })),
		other: t.component("Other"),
	},
	view: h("ul", {}, renderEach(field("items"))),
	renders: {
		tui: h(
			"box",
			{},
			renderEach(field("items")),
			pushView("short", h("box", {}, renderEach(field("items")))),
			// A component without a tui renders its view in a terminal.
			render(field("other")),
			h(
				"box",
				{ flexDirection: "row", gap: "1" },
				each(field("plain"), h("text", { "on:click": send("drop", sourceKey()) }, field("v"))),
			),
		),
	},
	on: {
		drop(next, [i]) {
			next.plain.splice(i, 1);
		},
	},
});

test("a terminal renders renders.tui by view name, falling back to its main, and views of components without one", () => {
	const app = start({ Item, Other, List }, (C) =>
		C.List({
			items: [C.Item({ label: "a" }), C.Item({ label: "b" })],
			plain: [{ v: "x" }, { v: "y" }],
			other: C.Other(),
		}),
	);
	assert.equal(app.screen.toString(), ["- a", "- b", "a", "b", "plain view", "x y"].join("\n"));
	app.click("y");
	assert.deepEqual(app.host.root.plain, [{ v: "x" }]);
});

test("component() wants a main view in renders.tui; lint lints them, named as tui views", () => {
	assert.throws(
		() =>
			component({
				name: "Bad",
				fields: {},
				view: h("p", {}),
				renders: { tui: { short: h("text", {}) } },
			}),
		/Component Bad renders tui views but no main one/,
	);
	const Typo = component({
		name: "Typo",
		fields: { count: t.number() },
		view: h("p", {}, field("count")),
		renders: { tui: h("text", {}, field("cuont")) },
	});
	const issues = lint([Typo], ["Typo"]);
	assert.deepEqual(
		issues.map((i) => [i.code, i.view]),
		[["unknown-field", "tui main"]],
	);
});

test("unsafe text in the state can't write escape sequences to the terminal", () => {
	const Echo = component({
		name: "Echo",
		fields: { s: t.string() },
		view: h("p", {}),
		renders: { tui: h("text", {}, field("s")) },
	});
	const app = start({ Echo }, (C) => C.Echo({ s: "hi\x1b[2J\x1b]0;pwned\x07!" }));
	assert.equal(app.screen.toString(), "hi!");
	assert.doesNotMatch(app.out(), /pwned/);
	// The one clear is the first paint's own.
	assert.equal(app.out().split("\x1b[2J").length, 2);
});

const Field = component({
	name: "Field",
	fields: { text: t.string() },
	view: h("input", { value: field("text") }),
	renders: {
		tui: h(
			"box",
			{ width: "8" },
			h("input", { value: field("text"), "on:input": send("setText", targetValue()) }),
		),
	},
	on: {
		setText(next, [text]) {
			next.text = text;
		},
	},
});

test("an input edits at its caret: arrows, Home, End, words and readline's keys", () => {
	const app = start({ Field }, (C) => C.Field());
	app.key("Tab");
	app.type("helo");
	app.key("ArrowLeft");
	app.type("l");
	assert.equal(app.host.root.text, "hello");
	app.key("Home");
	app.type(">");
	app.key("End");
	app.type(" world");
	assert.equal(app.host.root.text, ">hello world");
	app.key("Backspace", { ctrlKey: true }); // A word back.
	assert.equal(app.host.root.text, ">hello ");
	app.key("ArrowLeft", { ctrlKey: true }); // To the start of >hello, one word.
	app.key("ArrowRight");
	app.key("Delete");
	assert.equal(app.host.root.text, ">ello ");
	app.key("u", { ctrlKey: true });
	assert.equal(app.host.root.text, "ello ");
	app.key("k", { ctrlKey: true });
	assert.equal(app.host.root.text, "");
	app.screen.paste("pasted\ntext");
	app.drain();
	assert.equal(app.host.root.text, "pasted text");
});

test("a long value scrolls sideways to keep the caret in view; a click puts the caret there", () => {
	const app = start({ Field }, (C) => C.Field());
	app.key("Tab");
	app.type("abcdefghijkl");
	// 8 columns: the last 7 and the caret after them.
	assert.equal(app.screen.toString(), "fghijkl");
	app.key("Home");
	assert.equal(app.screen.toString(), "abcdefgh");
	app.screen.click(3, 0);
	app.type("X");
	assert.equal(app.host.root.text, "abcXdefghijkl");
});

const Log = component({
	name: "Log",
	fields: { lines: t.array(t.record({ n: t.number() })), picked: t.number() },
	view: h("ul", {}),
	renders: {
		tui: h(
			"box",
			{ borderStyle: "single", height: "6", overflowY: "auto", focusable: "true" },
			each(
				field("lines"),
				h("box", { focusable: "true", "on:click": send("pick", sourceKey()) }, "line ", field("n")),
			),
		),
	},
	on: {
		pick(next, [i]) {
			next.picked = i;
		},
	},
});
const lines = (n) => Array.from({ length: n }, (_, i) => ({ n: i }));

test("a scroll container shows what fits, scrolls by wheel and keys, and draws its thumb", () => {
	const app = start({ Log }, (C) => C.Log({ lines: lines(20), picked: -1 }), {
		width: 12,
		height: 8,
	});
	const rows = () => app.screen.toString().split("\n");
	assert.deepEqual(rows().slice(1, 5), ["│line 0 ┃", "│line 1 │", "│line 2 │", "│line 3 │"]);
	app.screen.wheel(3, 2);
	app.drain();
	assert.equal(rows()[1], "│line 3 │");
	const log = app.screen.rootNode.childNodes.find((n) => n.nodeType === 1);
	assert.equal(log.scrollTop, 3);
	app.click("line 4");
	assert.equal(app.host.root.picked, 4, "a click on a scrolled row picks that row");
	// The arrows scroll the focused container; End goes to the bottom, where the thumb is too.
	app.screen.focus(log);
	app.key("ArrowDown");
	assert.equal(log.scrollTop, 4);
	app.key("End");
	assert.equal(log.scrollTop, 16);
	assert.deepEqual(rows().slice(1, 5), ["│line 16│", "│line 17│", "│line 18│", "│line 19┃"]);
	app.screen.wheel(3, 2);
	app.drain();
	assert.equal(log.scrollTop, 16, "it doesn't scroll past its end");
});

test("Tab scrolls what it focuses into view; what's scrolled out of view can't be clicked", () => {
	const app = start({ Log }, (C) => C.Log({ lines: lines(20), picked: -1 }), {
		width: 12,
		height: 8,
	});
	const log = app.screen.rootNode.childNodes.find((n) => n.nodeType === 1);
	for (let i = 0; i < 7; i++) app.key("Tab"); // The log, then line 0 to line 5.
	assert.equal(app.screen.focused.textContent, "line 5");
	assert.equal(log.scrollTop, 2);
	app.key("Tab", { shiftKey: true });
	app.key("Tab", { shiftKey: true });
	app.key("Tab", { shiftKey: true });
	assert.equal(app.screen.focused.textContent, "line 2");
	assert.equal(log.scrollTop, 2, "already in view: no scroll");
	// Line 1 is scrolled up under the top border: a click there hits the log, not line 1.
	app.screen.click(3, 0);
	app.drain();
	assert.equal(app.host.root.picked, -1);
});

const Keys = component({
	name: "Keys",
	fields: { pressed: t.array(t.string()) },
	view: h("p", {}),
	renders: {
		tui: h("box", { focusable: "true", "on:keydown": send("press", eventKey()) }, field("pressed")),
	},
	on: {
		press(next, [key]) {
			next.pressed.push(key);
		},
	},
});

test("eventKey() is the key a keydown is for; lint wants it in key events only", () => {
	const app = start({ Keys }, (C) => C.Keys());
	app.key("Tab");
	app.key("a");
	app.key("ArrowUp");
	app.key("Enter");
	assert.deepEqual(app.host.root.pressed, ["a", "ArrowUp", "Enter"]);
	const Wrong = component({
		name: "Wrong",
		fields: {},
		view: h("button", { "on:click": send("press", eventKey()) }),
		on: { press() {} },
	});
	assert.deepEqual(
		lint([Wrong], ["Wrong"]).map((i) => i.code),
		["event-key-outside-key-event"],
	);
	assert.equal(lint([Keys], ["Keys"]).length, 0);
});

test("an input looks like a field: underlined across its width, its placeholder dim and italic", () => {
	const app = start({ TodoList }, (C) => C.TodoList());
	const [x, y] = app.at("What needs doing?");
	const cell = (dx) => app.screen.buffer.get(x + dx, y);
	assert.equal(cell(0).style, "2;3;4"); // Dim, italic, underlined: the placeholder.
	assert.equal(cell(30).char, " ");
	assert.equal(cell(30).style, "2;3;4", "the line runs past the text, to the field's end");
	app.key("Tab");
	app.type("milk");
	assert.equal(cell(0).style, "4", "a value is underlined, not dim");
	assert.equal(cell(4).style, "7", "the caret, after it, is the one inverted cell");
	assert.equal(cell(5).style, "4");
});
