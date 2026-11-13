// A terminal's Screen on a page, without a terminal emulator: its cells drawn as styled text
// (a row a <div>, a run of cells with one style a <span>) and the page's keys, mouse and paste
// sent to it as the events input.js parses from a terminal. What runs is the same Screen a
// terminal shows: hit testing, focus, inputs and scrolling are its own, not the browser's.
//
// No ANSI goes through: the cells' styles (SGR parameters, buffer.js's sgr) become CSS here, and
// the colors are the truecolor ones a cell keeps. The 16 colors and the default ones are CSS
// variables, --tui-color-0 to --tui-color-15, --tui-fg and --tui-bg, for a page to theme.
import { rgbOf256 } from "./buffer.js";

const UNDERLINE_STYLES = { 1: "solid", 2: "double", 3: "wavy", 4: "dotted", 5: "dashed" };
const palette = (n) => (n < 16 ? `var(--tui-color-${n})` : `rgb(${rgbOf256(n).join(", ")})`);

const cssCache = new Map();
// The CSS of a cell's style, the SGR parameters joined with ; ("1;38;2;255;128;0"), as the
// style attribute of what draws it; "" for none.
export function sgrCss(style) {
	if (style === "") return "";
	let out = cssCache.get(style);
	if (out !== undefined) return out;
	let fg = null;
	let bg = null;
	let decorationColor = null;
	let underline = null;
	const on = new Set();
	const params = style.split(";");
	for (let i = 0; i < params.length; i++) {
		const [code, sub] = params[i].split(":");
		const n = Number(code);
		if (n === 38 || n === 48 || n === 58) {
			let color = null;
			if (params[i + 1] === "2") {
				color = `rgb(${params.slice(i + 2, i + 5).join(", ")})`;
				i += 4;
			} else if (params[i + 1] === "5") {
				color = palette(Number(params[i + 2]));
				i += 2;
			}
			if (n === 38) fg = color;
			else if (n === 48) bg = color;
			else decorationColor = color;
		} else if (n === 4) underline = UNDERLINE_STYLES[sub ?? "1"] ?? "solid";
		else if (n >= 30 && n <= 37) fg = palette(n - 30);
		else if (n >= 90 && n <= 97) fg = palette(n - 82);
		else if (n >= 40 && n <= 47) bg = palette(n - 40);
		else if (n >= 100 && n <= 107) bg = palette(n - 92);
		else on.add(n);
	}
	if (on.has(7)) [fg, bg] = [bg ?? "var(--tui-bg)", fg ?? "var(--tui-fg)"];
	const css = [];
	if (fg !== null) css.push(`color: ${fg}`);
	if (bg !== null) css.push(`background-color: ${bg}`);
	if (on.has(1)) css.push("font-weight: bold");
	if (on.has(2)) css.push("opacity: 0.6");
	if (on.has(3)) css.push("font-style: italic");
	const lines = [underline !== null && "underline", on.has(9) && "line-through"].filter(Boolean);
	if (lines.length > 0) css.push(`text-decoration-line: ${lines.join(" ")}`);
	if (underline !== null && underline !== "solid") css.push(`text-decoration-style: ${underline}`);
	if (decorationColor !== null) css.push(`text-decoration-color: ${decorationColor}`);
	out = css.join("; ");
	if (cssCache.size >= 512) cssCache.delete(cssCache.keys().next().value);
	cssCache.set(style, out);
	return out;
}

// One row of cells as a <div class="row">: text without a style as it is, a run with one as a
// <span style>, and a wide grapheme in a <span class="wide"> two cells wide, so a font whose
// glyph for it isn't keeps the columns after it in place.
export function drawRow(document, row) {
	const div = document.createElement("div");
	div.className = "row";
	let text = "";
	let style = "";
	const flush = () => {
		if (text === "") return;
		if (style === "") div.append(text);
		else {
			const span = document.createElement("span");
			span.setAttribute("style", sgrCss(style));
			span.textContent = text;
			div.append(span);
		}
		text = "";
	};
	for (let x = 0; x < row.length; x++) {
		const c = row[x];
		if (c.wide) continue;
		if (row[x + 1]?.wide) {
			flush();
			const span = document.createElement("span");
			span.className = "wide";
			const css = sgrCss(c.style);
			if (css !== "") span.setAttribute("style", css);
			span.textContent = c.char;
			div.append(span);
			continue;
		}
		if (c.style !== style) {
			flush();
			style = c.style;
		}
		text += c.char;
	}
	flush();
	return div;
}

// Draws buffer into node, a row a child; drawn, the signatures of the rows it shows (from a
// last draw, [] for none), so only the rows that changed are drawn again. Returns them.
export function drawBuffer(document, node, buffer, drawn = []) {
	const signatures = [];
	for (let y = 0; y < buffer.height; y++) {
		const signature = buffer.signature(y);
		signatures.push(signature);
		const shown = node.children[y];
		if (shown !== undefined && drawn[y] === signature) continue;
		const row = drawRow(document, buffer.rows[y]);
		if (shown === undefined) node.append(row);
		else shown.replaceWith(row);
	}
	while (node.children.length > buffer.height) node.lastElementChild.remove();
	return signatures;
}

// --- input -----------------------------------------------------------------------------------

const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn"]);
const FUNCTION_KEY = /^F\d{1,2}$/;
const BUTTONS = ["left", "middle", "right"];
// The button a move with e.buttons held drags with, or none.
const heldButton = (buttons) =>
	buttons & 1 ? "left" : buttons & 4 ? "middle" : buttons & 2 ? "right" : "none";
const modifiersOf = (e) => ({ ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey });

// A KeyboardEvent as the key event input.js parses from a terminal, or null for one the page
// keeps: a modifier alone, one held with Meta (the browser's and the system's shortcuts), the
// keys an input method composes with, and Ctrl+C with text selected, to copy it.
export function keyOf(e, { hasSelection = false } = {}) {
	if (MODIFIERS.has(e.key) || e.metaKey || e.isComposing) return null;
	if (e.key === "Dead" || e.key === "Process" || e.key === "Unidentified") return null;
	if (e.ctrlKey && e.key.toLowerCase() === "c" && hasSelection) return null;
	if (e.ctrlKey && e.key.toLowerCase() === "v") return null; // The paste event brings it.
	const key = e.ctrlKey && e.key.length === 1 ? e.key.toLowerCase() : e.key;
	return { kind: "key", key, ...modifiersOf(e) };
}

// Sends what's done on node, the element a Screen is drawn in, to screen: keydown as its keys,
// paste as pasted text, and the mouse as its mouse events at the cell cellAt(e) says ({ x, y },
// 0-based), as a terminal with mouse reporting sends them. A press with Shift is the page's,
// to select text, as terminals do. Returns what stops it.
export function bindScreen(node, screen, { cellAt, rowHeight = () => 16 }) {
	// What an input or textarea copies goes on the page's clipboard, where Ctrl+V's paste gets it.
	screen.onCopy = (text) => node.ownerDocument.defaultView?.navigator?.clipboard?.writeText(text);
	let last = null; // The cell the mouse last moved over, to send one move per cell.
	let wheel = 0; // The wheel's pixels not scrolled yet: a tick is 3 rows of them.
	const hasSelection = () => {
		const selection = node.ownerDocument.getSelection?.();
		return selection !== null && selection !== undefined && !selection.isCollapsed;
	};
	const listeners = {
		keydown(e) {
			const key = keyOf(e, { hasSelection: hasSelection() });
			if (key === null) return;
			const event = screen.key(key);
			// A function key nothing took stays the page's (F5 reloads, F12 opens devtools).
			if (FUNCTION_KEY.test(key.key) && !event.defaultPrevented) return;
			e.preventDefault();
		},
		paste(e) {
			const text = e.clipboardData?.getData("text/plain") ?? "";
			if (text === "") return;
			e.preventDefault();
			screen.paste(text);
		},
		mousedown(e) {
			if (e.shiftKey) return;
			e.preventDefault(); // No text selection; focus is given below.
			node.focus({ preventScroll: true });
			const button = BUTTONS[e.button];
			if (button !== undefined)
				screen.mouse({ ...cellAt(e), button, action: "click", ...modifiersOf(e) });
		},
		mouseup(e) {
			const button = BUTTONS[e.button];
			if (button !== undefined && !e.shiftKey) {
				screen.mouse({ ...cellAt(e), button, action: "release", ...modifiersOf(e) });
			}
		},
		mousemove(e) {
			const cell = cellAt(e);
			if (last !== null && last.x === cell.x && last.y === cell.y) return;
			last = cell;
			const button = heldButton(e.buttons);
			const action = button === "none" ? "move" : "drag";
			screen.mouse({ ...cell, button, action, ...modifiersOf(e) });
		},
		mouseleave() {
			last = null;
		},
		wheel(e) {
			e.preventDefault();
			const unit = e.deltaMode === 1 ? rowHeight() : e.deltaMode === 2 ? rowHeight() * 24 : 1;
			wheel += e.deltaY * unit;
			const tick = rowHeight() * 3;
			const cell = cellAt(e);
			while (Math.abs(wheel) >= tick) {
				const up = wheel < 0;
				wheel += up ? tick : -tick;
				screen.mouse({
					...cell,
					button: up ? "scroll-up" : "scroll-down",
					action: "click",
					...modifiersOf(e),
				});
			}
		},
		contextmenu(e) {
			if (!e.shiftKey) e.preventDefault(); // A right click is the app's.
		},
	};
	for (const [type, fn] of Object.entries(listeners)) {
		node.addEventListener(type, fn, type === "wheel" ? { passive: false } : undefined);
	}
	return () => {
		for (const [type, fn] of Object.entries(listeners)) node.removeEventListener(type, fn);
	};
}
