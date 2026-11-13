import assert from "node:assert/strict";
import test from "node:test";
import { parseInput } from "../../src/tui/index.js";

const keys = (data) => parseInput(data).map((e) => [e.key, e.ctrlKey, e.altKey, e.shiftKey]);

test("characters, control keys and Ctrl+letters are keys", () => {
	assert.deepEqual(keys("a日\r\t\x7f\x03 "), [
		["a", false, false, false],
		["日", false, false, false],
		["Enter", false, false, false],
		["Tab", false, false, false],
		["Backspace", false, false, false],
		["c", true, false, false],
		[" ", false, false, false],
	]);
});

test("escape sequences are named keys, with xterm's modifiers", () => {
	assert.deepEqual(keys("\x1b[A\x1bOB\x1b[1;5C\x1b[3~\x1b[6;2~\x1b[Z\x1b[15~"), [
		["ArrowUp", false, false, false],
		["ArrowDown", false, false, false],
		["ArrowRight", true, false, false],
		["Delete", false, false, false],
		["PageDown", false, false, true],
		["Tab", false, false, true],
		["F5", false, false, false],
	]);
	assert.deepEqual(keys("\x1bx\x1b"), [
		["x", false, true, false],
		["Escape", false, false, false],
	]);
});

test("SGR mouse reports are mouse events at 0-based cells", () => {
	const [press, release, wheel] = parseInput("\x1b[<0;5;3M\x1b[<0;5;3m\x1b[<65;1;1M");
	assert.deepEqual(
		{ ...press },
		{
			kind: "mouse",
			x: 4,
			y: 2,
			button: "left",
			action: "click",
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
		},
	);
	assert.equal(release.action, "release");
	assert.equal(wheel.button, "scroll-down");
	const [drag] = parseInput("\x1b[<48;2;2M"); // Motion with left held, and ctrl.
	assert.equal(drag.action, "drag");
	assert.equal(drag.ctrlKey, true);
});

test("a bracketed paste is one paste, whatever it holds", () => {
	assert.deepEqual(parseInput("\x1b[200~a\x1b[Ab\x1b[201~c"), [
		{ kind: "paste", text: "a\x1b[Ab" },
		{ kind: "key", key: "c", ctrlKey: false, altKey: false, shiftKey: false },
	]);
});
