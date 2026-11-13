// Editing an <input> or <textarea> at its selection: what a key does to its value and selection,
// readline's keys and a page's together, and its undo history. editKey says what happened; the
// screen sends the events that follows (input, submit) and keeps the clipboard.
//
// Offsets are UTF-16, as selectionStart is, always on grapheme boundaries.
import {
	caretAtColumn,
	nextBoundary,
	nextWord,
	previousBoundary,
	previousWord,
	stringWidth,
	stripControls,
} from "./text.js";

export const isEditable = (el) =>
	el?.nodeType === 1 && (el.localName === "input" || el.localName === "textarea");
const isMultiline = (el) => el.localName === "textarea";

// The lines of a value, as { start, end } offsets (end before its newline); an input's is one.
export function linesOf(value, multiline = true) {
	if (!multiline) return [{ start: 0, end: value.length }];
	const lines = [];
	let start = 0;
	for (;;) {
		const nl = value.indexOf("\n", start);
		if (nl === -1) {
			lines.push({ start, end: value.length });
			return lines;
		}
		lines.push({ start, end: nl });
		start = nl + 1;
	}
}
export const lineIndexAt = (lines, at) => {
	let i = lines.length - 1;
	while (i > 0 && lines[i].start > at) i--;
	return i;
};
// The column of an offset in its line, as it's drawn.
export const columnIn = (value, line, at) =>
	stringWidth(stripControls(value.slice(line.start, at)));

// The offset at a column of a row of el's value, as a click there puts the caret.
export function offsetAt(el, column, row = 0) {
	const value = el.value;
	const lines = linesOf(value, isMultiline(el));
	const line = lines[Math.max(0, Math.min(lines.length - 1, row))];
	return line.start + caretAtColumn(value.slice(line.start, line.end), Math.max(0, column));
}

// --- undo ------------------------------------------------------------------------------------

const LIMIT = 200;
// el's history, started again when its value changed from elsewhere (a render from the state).
function historyOf(el) {
	let h = el._history;
	if (h === undefined || h.value !== el.value) {
		h = { undo: [], redo: [], value: el.value, kind: null };
		el._history = h;
	}
	return h;
}
const snapshot = (el) => ({ value: el.value, anchor: el._anchor, focus: el._focus });
// Before an edit of kind: a run of typing (insert) is one step back, as are other edits each.
// Returns the history, for the edit to record the value it makes.
function remember(el, kind) {
	const h = historyOf(el);
	if (kind !== "insert" || h.kind !== "insert") h.undo.push(snapshot(el));
	if (h.undo.length > LIMIT) h.undo.shift();
	h.redo = [];
	h.kind = kind;
	return h;
}
function restore(el, from, to) {
	const h = historyOf(el);
	const step = from.pop();
	if (step === undefined) return false;
	to.push(snapshot(el));
	el.value = step.value;
	el.select(step.anchor, step.focus);
	h.value = el.value;
	h.kind = null;
	return true;
}
export const undo = (el) => restore(el, historyOf(el).undo, historyOf(el).redo);
export const redo = (el) => restore(el, historyOf(el).redo, historyOf(el).undo);

// value's from up to to replaced by text, the caret after it; kind for the history.
export function replace(el, from, to, text, kind = "edit") {
	const value = el.value;
	const next = value.slice(0, from) + text + value.slice(to);
	if (next === value) return false;
	// Taken before the value changes: after, it would look changed from elsewhere, and start over.
	const h = remember(el, kind);
	el.value = next;
	el.select(from + text.length);
	h.value = el.value;
	el._goal = null;
	return true;
}
// The selection replaced by text (typed or pasted); newlines become spaces in an input.
export function insert(el, text, kind = "insert") {
	const clean = isMultiline(el) ? text.replace(/\r\n?/g, "\n") : text.replace(/[\r\n]+/g, " ");
	return replace(el, el.selectionStart, el.selectionEnd, clean, kind);
}

// --- keys ------------------------------------------------------------------------------------

// What a key did: handled (the element took it), changed (its value), submit, and copy, the
// text to put on the clipboard (Ctrl+C, Ctrl+X). clipboard is what Ctrl+V pastes.
//
// Moving: arrows (with Ctrl or Alt by word), Home and End (a line's in a textarea, the value's
// with Ctrl), Up and Down between a textarea's lines, Ctrl+E to the end; with Shift each one
// selects, and Ctrl+A selects all. Deleting: Backspace and Delete (a word with Ctrl or Alt, the
// selection when there is one), Ctrl+W, Ctrl+U and Ctrl+K (to the start and the end of the line).
// Ctrl+Z undoes and Ctrl+Y redoes. Enter submits an input and starts a line in a textarea,
// which Alt+Enter submits.
export function editKey(
	el,
	{ key, ctrlKey = false, altKey = false, shiftKey = false },
	clipboard = "",
) {
	const value = el.value;
	const multiline = isMultiline(el);
	const lines = linesOf(value, multiline);
	const caret = el.caret;
	const [start, end] = [el.selectionStart, el.selectionEnd];
	const selected = start !== end;
	const line = lines[lineIndexAt(lines, caret)];
	const word = ctrlKey || altKey;
	const done = (changed = false, extra = {}) => ({ handled: true, changed, ...extra });
	// Moves the caret to `to`, selecting from the anchor with Shift; keeps the goal column on
	// vertical moves.
	const move = (to, vertical = false) => {
		if (!vertical) el._goal = null;
		el.select(shiftKey ? el._anchor : to, to);
		return done();
	};
	const removeRange = (from, to) =>
		done(replace(el, Math.min(from, to), Math.max(from, to), "", "delete"));
	const removeOr = (range) => (selected ? removeRange(start, end) : removeRange(...range()));

	switch (key) {
		case "Enter":
			if (multiline && !altKey) return done(insert(el, "\n", "edit"));
			return done(false, { submit: true });
		case "Backspace":
			return removeOr(() => [
				word ? previousWord(value, caret) : previousBoundary(value, caret),
				caret,
			]);
		case "Delete":
			return removeOr(() => [caret, word ? nextWord(value, caret) : nextBoundary(value, caret)]);
		case "ArrowLeft":
			if (selected && !shiftKey) return move(start);
			return move(word ? previousWord(value, caret) : previousBoundary(value, caret));
		case "ArrowRight":
			if (selected && !shiftKey) return move(end);
			return move(word ? nextWord(value, caret) : nextBoundary(value, caret));
		case "Home":
			return move(ctrlKey || !multiline ? 0 : line.start);
		case "End":
			return move(ctrlKey || !multiline ? value.length : line.end);
		case "ArrowUp":
		case "ArrowDown": {
			if (!multiline) return { handled: false };
			const i = lineIndexAt(lines, caret);
			const to = i + (key === "ArrowUp" ? -1 : 1);
			if (to < 0) return move(0, true);
			if (to >= lines.length) return move(value.length, true);
			el._goal ??= columnIn(value, line, caret);
			const target = lines[to];
			return move(
				target.start + caretAtColumn(value.slice(target.start, target.end), el._goal),
				true,
			);
		}
	}
	if (ctrlKey && !altKey) {
		switch (key) {
			case "a":
				el._goal = null;
				el.select(0, value.length);
				return done();
			case "e":
				return move(multiline ? line.end : value.length);
			case "b":
				return move(previousBoundary(value, caret));
			case "f":
				return move(nextBoundary(value, caret));
			case "u":
				return removeOr(() => [multiline ? line.start : 0, caret]);
			case "k":
				return removeOr(() => [caret, multiline ? line.end : value.length]);
			case "w":
				return removeOr(() => [previousWord(value, caret), caret]);
			case "h":
				return removeOr(() => [previousBoundary(value, caret), caret]);
			case "d":
				return removeOr(() => [caret, nextBoundary(value, caret)]);
			case "z":
				return done(undo(el));
			case "y":
				return done(redo(el));
			case "c":
				return selected ? done(false, { copy: el.selectedText }) : { handled: false };
			case "x":
				return selected
					? done(removeRange(start, end).changed, { copy: el.selectedText })
					: { handled: false };
			case "v":
				return clipboard ? done(insert(el, clipboard, "edit")) : done();
		}
		return { handled: false };
	}
	if (altKey || [...key].length === 0 || /^[A-Z][a-zA-Z0-9]+$/.test(key)) return { handled: false };
	return done(insert(el, key));
}
