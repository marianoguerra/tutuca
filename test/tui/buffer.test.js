import assert from "node:assert/strict";
import test from "node:test";
import { bufferToAnsi, CellBuffer, colorToSgr, patchesToAnsi, sgr } from "../../src/tui/index.js";

test("styles are SGR parameters: named, bright, hex and 256-color colors and attributes", () => {
	assert.equal(colorToSgr("red"), "31");
	assert.equal(colorToSgr("cyanBright"), "96");
	assert.equal(colorToSgr("blue", true), "44");
	assert.equal(colorToSgr("#ff8000"), "38;2;255;128;0");
	assert.equal(colorToSgr("200", true), "48;5;200");
	assert.equal(colorToSgr("no such color"), "");
	assert.equal(sgr({ bold: true, color: "green", underline: "curly" }), "1;4:3;32");
	assert.equal(sgr({}), "");
});

test("a wide grapheme takes two cells, and overwriting either half clears both", () => {
	const b = new CellBuffer(4, 1);
	b.writeString(0, 0, "日x");
	assert.equal(b.get(0, 0).char, "日");
	assert.equal(b.get(1, 0).wide, true);
	assert.equal(b.toString(), "日x");
	b.writeChar(1, 0, "a");
	assert.equal(b.get(0, 0).char, " ");
	assert.equal(b.toString(), " ax");
	// One that doesn't fit at the edge isn't written.
	b.writeChar(3, 0, "本");
	assert.equal(b.get(3, 0).char, " ");
});

test("diff lists the cells that changed and patchesToAnsi writes them with as few moves as it can", () => {
	const a = new CellBuffer(10, 2);
	a.writeString(0, 0, "hello");
	const b = new CellBuffer(10, 2);
	b.writeString(0, 0, "help!");
	b.writeString(2, 1, "ok", sgr({ bold: true }));
	const patches = a.diff(b);
	assert.deepEqual(
		patches.map((p) => [p.x, p.y, p.cell.char]),
		[
			[3, 0, "p"],
			[4, 0, "!"],
			[2, 1, "o"],
			[3, 1, "k"],
		],
	);
	assert.equal(patchesToAnsi(patches, 10), "\x1b[1;4Hp!\x1b[2;3H\x1b[0;1mok\x1b[0m");
	assert.deepEqual(b.diff(b), []);
});

test("bufferToAnsi prints the whole buffer, styles reset where they change", () => {
	const b = new CellBuffer(6, 2);
	b.writeString(0, 0, "ab", sgr({ color: "red" }));
	b.writeString(0, 1, "cd");
	assert.equal(bufferToAnsi(b), "\x1b[0;31mab\x1b[0m\ncd");
});
