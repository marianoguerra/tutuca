import assert from "node:assert/strict";
import test from "node:test";
import {
	fitText,
	graphemes,
	padText,
	sliceColumns,
	stringWidth,
	stripControls,
	truncateText,
} from "../../src/tui/index.js";

test("widths count cells: ASCII 1, CJK and emoji 2, combining marks and joiners 0", () => {
	assert.equal(stringWidth("hello"), 5);
	assert.equal(stringWidth("日本"), 4);
	assert.equal(stringWidth("👍"), 2);
	assert.equal(stringWidth("👨‍👩‍👧"), 2); // One ZWJ family.
	assert.equal(stringWidth("é"), 1); // e + combining acute.
	assert.equal(stringWidth("🇦🇷"), 2); // A flag: two regional indicators.
	assert.equal(stringWidth("✓"), 1); // Ambiguous width stays one cell.
});

test("graphemes keep clusters whole", () => {
	assert.deepEqual([...graphemes("aé👨‍👩‍👧b")], ["a", "é", "👨‍👩‍👧", "b"]);
});

test("stripControls drops escape sequences and controls but keeps newlines; tabs become spaces", () => {
	assert.equal(stripControls("a\x1b[31mred\x1b[0m\x1b]0;title\x07\tb\nc\x07"), "ared b\nc");
	assert.equal(stripControls("unterminated \x1b]8;;http://x"), "unterminated ");
});

test("sliceColumns never cuts a wide grapheme in half", () => {
	assert.equal(sliceColumns("日本語", 0, 3), "日");
	assert.equal(sliceColumns("日本語", 1, 6), "本語");
	assert.equal(sliceColumns("abcdef", 2, 4), "cd");
});

test("fitText wraps at words, splits words wider than the line, and truncates by mode", () => {
	assert.deepEqual(fitText("the quick brown fox", 10), ["the quick", "brown fox"]);
	assert.deepEqual(fitText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
	assert.deepEqual(fitText("one\ntwo", 10), ["one", "two"]);
	assert.deepEqual(fitText("abcdefghij", 5, "truncate"), ["abcd…"]);
	assert.deepEqual(fitText("abcdefghij", 5, "truncate-start"), ["…ghij"]);
	assert.deepEqual(fitText("abcdefghij", 5, "truncate-middle"), ["ab…ij"]);
});

test("truncateText and padText fit text to a number of cells", () => {
	assert.equal(truncateText("日本語です", 5), "日本…");
	assert.equal(padText("ab", 5, "right"), "   ab");
	assert.equal(padText("ab", 5, "center"), " ab  ");
	assert.equal(padText("abcdef", 3), "abc");
});

test("carets move by grapheme and by word, and map to and from columns", async () => {
	const { caretAtColumn, columnOf, nextBoundary, nextWord, previousBoundary, previousWord } =
		await import("../../src/tui/index.js");
	const s = "ab👍 cd  ef";
	assert.equal(nextBoundary(s, 2), 4); // Past the whole emoji (two code units).
	assert.equal(previousBoundary(s, 4), 2);
	assert.equal(previousWord(s, s.length), 9);
	assert.equal(previousWord(s, 9), 5);
	assert.equal(nextWord(s, 0), 4);
	assert.equal(nextWord(s, 4), 7);
	assert.equal(columnOf(s, 4), 4); // a b and a two-cell emoji.
	assert.equal(caretAtColumn(s, 3), 4); // The right half of the emoji is after it.
	assert.equal(caretAtColumn(s, 2), 2);
	assert.equal(caretAtColumn(s, 99), s.length);
});
