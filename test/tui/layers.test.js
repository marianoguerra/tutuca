// Styled spans, layers and modals, and what the output does for terminals with fewer colors or
// without Unicode.
import assert from "node:assert/strict";
import test from "node:test";
import {
	asciiOf,
	CellBuffer,
	detectColors,
	detectUnicode,
	fitSegments,
	patchesToAnsi,
	reduceStyle,
	startTui,
} from "../../src/tui/index.js";
import { tuiTarget } from "../../src/tui/target.js";
import { $if, component, enableTargets, eventKey, field, h, send, t } from "../../src/tutuca.js";

enableTargets(tuiTarget);

const start = (components, root, { width = 40, height = 10, terminal } = {}) => {
	let written = "";
	const { host, screen } = startTui({
		components,
		root,
		width,
		height,
		terminal,
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
	const click = (needle) => {
		const [x, y] = at(needle);
		screen.click(x, y);
		drain();
	};
	const key = (k, mods) => {
		screen.key({ key: k, ...mods });
		drain();
	};
	return { host, screen, drain, at, click, key, out: () => written };
};

// --- spans -----------------------------------------------------------------------------------

test("fitSegments wraps and cuts as ranges of the text, so styles can follow them", () => {
	const text = "the quick brown fox";
	assert.deepEqual(fitSegments(text, 10), [[{ start: 0, end: 9 }], [{ start: 10, end: 19 }]]);
	assert.deepEqual(fitSegments("abcdefghij", 5, "truncate-middle"), [
		[
			{ start: 0, end: 2 },
			{ text: "…", at: 2 },
			{ start: 8, end: 10 },
		],
	]);
});

const Note = component({
	name: "Note",
	fields: { clicked: t.number() },
	view: h("p", {}),
	renders: {
		tui: h(
			"box",
			{ width: "14" },
			h(
				"text",
				{ color: "green" },
				"plain ",
				h(
					"text",
					{ bold: "true", color: "red" },
					"bold red ",
					h("text", { underline: "true" }, "under"),
				),
				" and a ",
				h("text", { color: "cyan", "on:click": send("follow") }, "link"),
			),
		),
	},
	on: {
		follow(next) {
			next.clicked++;
		},
	},
});

test("elements in a text style the text in them, nested over outer, across wrapped rows", () => {
	const app = start({ Note }, (C) => C.Note());
	assert.equal(app.screen.toString(), ["plain bold red", "under and a", "link"].join("\n"));
	const style = (x, y) => app.screen.buffer.get(x, y).style;
	assert.equal(style(0, 0), "32"); // plain: the text's green.
	assert.equal(style(6, 0), "1;31"); // bold red.
	assert.equal(style(0, 1), "1;4;31"); // under: bold red, and underlined.
	assert.equal(style(6, 1), "32"); // and a.
	assert.equal(style(0, 2), "36"); // link: cyan.
});

test("a click on a span reaches its element, and its handler", () => {
	const app = start({ Note }, (C) => C.Note());
	app.click("link");
	assert.equal(app.host.root.clicked, 1);
	app.click("plain");
	assert.equal(app.host.root.clicked, 1);
});

// --- layers and modals -----------------------------------------------------------------------

const Page = component({
	name: "Page",
	fields: { open: t.boolean(), saved: t.number(), clicks: t.number() },
	view: h("p", {}),
	renders: {
		tui: h(
			"box",
			{ overflow: "hidden", width: "40", height: "10" },
			h("box", { focusable: "true", "on:click": send("hit") }, "[Open] under"),
			h("box", { focusable: "true", "on:click": send("show") }, "[Show]"),
			h("box", { position: "fixed", right: "0", top: "0", zIndex: "2" }, "toast"),
			$if(
				field("open"),
				// A backdrop over the whole screen, centering its dialog, as a modal is on a page.
				h(
					"box",
					{
						position: "fixed",
						modal: "true",
						width: "100%",
						height: "100%",
						justifyContent: "center",
						alignItems: "center",
						"on:keydown": send("key", eventKey()),
					},
					h(
						"box",
						{ borderStyle: "single", paddingX: "1", gap: "1", flexDirection: "row" },
						h("box", { focusable: "true", "on:click": send("save") }, "[Save]"),
						h("box", { focusable: "true", "on:click": send("close") }, "[Cancel]"),
					),
				),
				null,
			),
		),
	},
	on: {
		hit(next) {
			next.clicks++;
		},
		show(next) {
			next.open = true;
		},
		save(next) {
			next.saved++;
			next.open = false;
		},
		close(next) {
			next.open = false;
		},
		key(next, [key]) {
			if (key === "Escape") next.open = false;
		},
	},
});

test("a fixed element is on a layer: over the rest, not clipped by its ancestors, placed on the screen", () => {
	const app = start({ Page }, (C) => C.Page());
	const rows = app.screen.toString().split("\n");
	assert.equal(rows[0], `[Open] under${" ".repeat(23)}toast`);
});

test("a modal draws over the page, takes focus and the clicks around it, and gives focus back", () => {
	const app = start({ Page }, (C) => C.Page());
	app.key("Tab");
	app.key("Tab"); // [Show]
	assert.equal(app.screen.focused.textContent, "[Show]");
	app.key("Enter");
	assert.equal(app.host.root.open, true);
	// Centered on the screen, and the first thing in it that takes focus has it.
	const [x, y] = app.at("[Save]");
	assert.deepEqual([x, y], [12, 4]);
	assert.equal(app.screen.focused.textContent, "[Save]");
	// Tab stays in the modal.
	app.key("Tab");
	assert.equal(app.screen.focused.textContent, "[Cancel]");
	app.key("Tab");
	assert.equal(app.screen.focused.textContent, "[Save]");
	// The page under the backdrop can't be clicked.
	app.screen.click(0, 0);
	app.drain();
	assert.equal(app.host.root.clicks, 0);
	app.click("[Save]");
	assert.equal(app.host.root.saved, 1);
	assert.equal(app.host.root.open, false);
	assert.equal(app.screen.focused.textContent, "[Show]", "focus is back where it was");
	assert.doesNotMatch(app.screen.toString(), /Save/);
	// Escape, read with eventKey() by the backdrop's keydown, closes it too.
	app.key("Enter");
	assert.equal(app.host.root.open, true);
	app.key("Escape");
	assert.equal(app.host.root.open, false);
	assert.equal(app.screen.focused.textContent, "[Show]");
});

// --- terminals -------------------------------------------------------------------------------

test("colors come from the environment: NO_COLOR, FORCE_COLOR, COLORTERM, TERM and known terminals", () => {
	assert.equal(detectColors({ NO_COLOR: "1", COLORTERM: "truecolor" }), 0);
	assert.equal(detectColors({ FORCE_COLOR: "2", NO_COLOR: "1" }), 256);
	assert.equal(detectColors({ COLORTERM: "truecolor", TERM: "xterm" }), "truecolor");
	assert.equal(detectColors({ TERM: "xterm-256color" }), 256);
	assert.equal(detectColors({ TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }), 256);
	assert.equal(detectColors({ KITTY_WINDOW_ID: "1", TERM: "xterm-kitty" }), "truecolor");
	assert.equal(detectColors({ TERM: "xterm" }), 16);
	assert.equal(detectColors({ TERM: "dumb" }), 0);
	assert.equal(detectUnicode({ TERM: "linux", LANG: "en_US.UTF-8" }), false);
	assert.equal(detectUnicode({ TERM: "xterm", LANG: "C" }), false);
	assert.equal(detectUnicode({ TERM: "xterm", LANG: "en_US.UTF-8" }), true);
});

test("output reduces colors to what the terminal has and draws ASCII without Unicode", () => {
	assert.equal(reduceStyle("1;38;2;255;128;0;48;5;196", 256), "1;38;5;208;48;5;196");
	assert.equal(reduceStyle("1;38;2;255;128;0;48;5;196", 16), "1;33;101");
	assert.equal(reduceStyle("1;31;44;4:3", 0), "1;4:3");
	assert.equal(asciiOf("╭"), "+");
	const b = new CellBuffer(3, 1);
	b.writeString(0, 0, "╭─╮", "38;2;0;0;255");
	const patches = new CellBuffer(3, 1).diff(b);
	assert.equal(
		patchesToAnsi(patches, 3, { colors: 16, unicode: false }),
		"\x1b[1;1H\x1b[0;34m+-+\x1b[0m",
	);
});

test("a screen writes for its terminal, its cells keeping the full style", () => {
	const Box = component({
		name: "Box",
		fields: {},
		view: h("p", {}),
		renders: {
			tui: h(
				"box",
				{ borderStyle: "round", color: "#ff8000" },
				h("text", { color: "#ff8000" }, "hi"),
			),
		},
	});
	const app = start({ Box }, (C) => C.Box(), { terminal: { colors: 0, unicode: false } });
	assert.match(app.out(), /\+--\+/);
	assert.doesNotMatch(app.out(), /╭|38;/);
	assert.equal(app.screen.buffer.get(1, 1).style, "38;2;255;128;0");
});
