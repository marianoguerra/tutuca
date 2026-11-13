// Textareas, selections, the clipboard and undo; border styles, per-side borders, splits and
// dividers.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { BORDER_STYLES, runTui, startTui } from "../../src/tui/index.js";
import { tuiTarget } from "../../src/tui/target.js";
import { component, enableTargets, field, h, send, t, targetValue } from "../../src/tutuca.js";

enableTargets(tuiTarget);

const start = (components, root, { width = 30, height = 8 } = {}) => {
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
	const key = (k, mods) => {
		screen.key({ key: k, ...mods });
		drain();
	};
	const type = (text) => {
		for (const k of text) screen.key({ key: k === "\n" ? "Enter" : k });
		drain();
	};
	return { host, screen, drain, key, type, out: () => written };
};

const Editor = component({
	name: "Editor",
	fields: { text: t.string(), sent: t.array(t.string()) },
	view: h("textarea", {}),
	renders: {
		tui: h(
			"box",
			{ width: "12", "on:submit": send("send") },
			h("textarea", {
				height: "3",
				value: field("text"),
				"on:input": send("setText", targetValue()),
			}),
		),
	},
	on: {
		setText(next, [text]) {
			next.text = text;
		},
		send(next) {
			next.sent.push(this.text);
		},
	},
});
const editor = (text = "") => start({ Editor }, (C) => C.Editor({ text }));
const el = (app) => app.screen.focused;

test("a textarea takes lines: Enter starts one, Up and Down keep the column, Home and End are the line's", () => {
	const app = editor();
	app.key("Tab");
	app.type("first\nsecond line\nx");
	assert.equal(app.host.root.text, "first\nsecond line\nx");
	app.key("ArrowUp");
	app.key("ArrowUp");
	assert.equal(el(app).caret, 1, "back to column 1 on the first line");
	app.key("ArrowDown");
	app.key("End");
	app.type("!");
	assert.equal(app.host.root.text, "first\nsecond line!\nx");
	app.key("Home");
	app.key("Backspace"); // Joins the line to the one before.
	assert.equal(app.host.root.text, "firstsecond line!\nx");
	app.key("Enter", { altKey: true }); // Alt+Enter submits.
	assert.deepEqual(app.host.root.sent, ["firstsecond line!\nx"]);
});

test("a textarea shows the rows around its caret, sideways too", () => {
	const app = editor("a\nb\nc\nd\ne");
	app.key("Tab");
	// 3 rows high; the caret at the end is on e.
	assert.equal(app.screen.toString(), ["c", "d", "e"].join("\n"));
	app.key("Home", { ctrlKey: true });
	assert.equal(app.screen.toString(), ["a", "b", "c"].join("\n"));
	app.key("End", { ctrlKey: true });
	app.type(" a long line that scrolls");
	// 12 columns: the last 11 and the caret after them.
	assert.equal(app.screen.toString().split("\n")[2], "hat scrolls");
});

test("Shift selects, typing and Backspace replace the selection, Ctrl+A selects all", () => {
	const app = editor("hello world");
	app.key("Tab");
	for (let i = 0; i < 5; i++) app.key("ArrowLeft", { shiftKey: true });
	assert.equal(el(app).selectedText, "world");
	app.type("there");
	assert.equal(app.host.root.text, "hello there");
	app.key("ArrowLeft", { shiftKey: true, ctrlKey: true });
	app.key("Backspace");
	assert.equal(app.host.root.text, "hello ");
	app.key("a", { ctrlKey: true });
	assert.equal(el(app).selectedText, "hello ");
	// The selection is drawn inverted; a caret isn't, while there's one.
	assert.equal(app.screen.buffer.get(0, 0).style.split(";").includes("7"), true);
	app.key("ArrowRight"); // Collapses to its end.
	assert.equal(el(app).selectionStart, el(app).selectionEnd);
});

test("Ctrl+C copies the selection (and asks the terminal to, with OSC 52), Ctrl+X cuts, Ctrl+V pastes", () => {
	const app = editor("cut me");
	app.key("Tab");
	app.key("a", { ctrlKey: true });
	app.key("c", { ctrlKey: true });
	assert.equal(app.screen.clipboard, "cut me");
	assert.match(
		app.out(),
		new RegExp(`\x1b\\]52;c;${Buffer.from("cut me").toString("base64")}\x07`),
	);
	app.key("x", { ctrlKey: true });
	assert.equal(app.host.root.text, "");
	app.key("v", { ctrlKey: true });
	app.key("v", { ctrlKey: true });
	assert.equal(app.host.root.text, "cut mecut me");
	app.screen.paste("\nand a pasted line");
	app.drain();
	assert.equal(app.host.root.text, "cut mecut me\nand a pasted line");
});

test("Ctrl+Z undoes a run of typing as one step and each other edit as one; Ctrl+Y redoes", () => {
	const app = editor();
	app.key("Tab");
	app.type("one two");
	app.key("Backspace", { ctrlKey: true });
	assert.equal(app.host.root.text, "one ");
	app.key("z", { ctrlKey: true });
	assert.equal(app.host.root.text, "one two");
	app.key("z", { ctrlKey: true });
	assert.equal(app.host.root.text, "");
	app.key("y", { ctrlKey: true });
	app.key("y", { ctrlKey: true });
	assert.equal(app.host.root.text, "one ");
});

test("a drag selects in a textarea, and Shift+click selects to where it's clicked", () => {
	const app = editor("abcdef\nghij");
	app.screen.mouse({ x: 1, y: 0, button: "left", action: "click" });
	app.screen.mouse({ x: 2, y: 1, button: "left", action: "drag" });
	app.screen.mouse({ x: 2, y: 1, button: "left", action: "release" });
	app.drain();
	assert.equal(el(app).selectedText, "bcdef\ngh");
	app.screen.click(0, 0);
	app.screen.mouse({ x: 3, y: 0, button: "left", action: "click", shiftKey: true });
	app.drain();
	assert.equal(el(app).selectedText, "abc");
});

test("in a terminal, Ctrl+C copies a selection and quits without one", async () => {
	const input = new PassThrough();
	const output = Object.assign(new PassThrough(), { columns: 30, rows: 8 });
	output.resume();
	const { host, screen, done } = runTui({
		input,
		output,
		components: { Editor },
		root: (C) => C.Editor({ text: "copy" }),
		terminal: { colors: "truecolor", unicode: true },
	});
	const wait = () => new Promise((resolve) => setTimeout(resolve, 20));
	input.write("\t\x01"); // Tab, Ctrl+A.
	await wait();
	input.write("\x03");
	await wait();
	assert.equal(screen.clipboard, "copy");
	assert.notEqual(host.root, null, "still running");
	input.write("\x1b[C\x03"); // Right collapses the selection, then Ctrl+C quits.
	await done;
	assert.equal(host.root, null);
});

// --- borders, splits and dividers --------------------------------------------------------------

const Frames = component({
	name: "Frames",
	fields: {},
	view: h("p", {}),
	renders: {
		tui: h(
			"box",
			{},
			h(
				"box",
				{ flexDirection: "row", borderStyle: "round", split: "true", width: "20" },
				h("box", { flexGrow: "1" }, "left"),
				h("box", {}, "right"),
			),
			h(
				"box",
				{ borderStyle: "single", split: "true", width: "8", borderTopColor: "red" },
				h("text", {}, "one"),
				h("text", {}, "two"),
			),
			h("divider", { title: "Mid", width: "16" }),
			h("box", { flexDirection: "row", gap: "1" }, "a", h("divider", { color: "blue" }), "b"),
			h("box", { borderStyle: "dashedHeavy", width: "6" }, "x"),
		),
	},
});

test("every tuiuiu border style draws, sides take their own colors, splits join the border", () => {
	assert.equal(Object.keys(BORDER_STYLES).length, 34);
	const app = start({ Frames }, (C) => C.Frames(), { width: 24, height: 14 });
	assert.equal(
		app.screen.toString(),
		[
			"╭────────────┬─────╮",
			"│left        │right│",
			"╰────────────┴─────╯",
			"┌──────┐",
			"│one   │",
			"├──────┤",
			"│two   │",
			"└──────┘",
			"───── Mid ──────",
			"a │ b",
			"┏╍╍╍╍┓",
			"╏x   ╏",
			"┗╍╍╍╍┛",
		].join("\n"),
	);
	const style = (x, y) => app.screen.buffer.get(x, y).style;
	assert.equal(style(1, 3), "31", "the top side's own color");
	assert.equal(style(0, 4), "", "the others keep theirs");
	assert.equal(style(2, 9), "34", "the vertical divider's color");
});
