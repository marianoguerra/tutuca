// Terminal input as events shaped like the DOM's: parseInput(chunk) splits what the terminal
// sent into { kind: "key", key, ctrlKey, altKey, shiftKey }, { kind: "mouse", x, y, button,
// action, ctrlKey, altKey, shiftKey } and { kind: "paste", text }. key is a KeyboardEvent.key:
// "a", " ", "Enter", "Tab", "Backspace", "Escape", "ArrowUp", "PageDown", "F5", ...
// The mouse decoder is ported from tuiuiu.js (core/mouse-protocol.ts; MIT, see LICENSE.tuiuiu).
import { graphemes } from "./text.js";

export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

// --- mouse -----------------------------------------------------------------------------------

// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences start with ESC.
const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences start with ESC.
const X10_MOUSE = /^\x1b\[M([\x00-\xff])([\x00-\xff])([\x00-\xff])/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences start with ESC.
const URXVT_MOUSE = /^\x1b\[(\d+);(\d+);(\d+)M/;

// A button code and 1-based cell as { x, y, button, action, ...modifiers }, x and y 0-based;
// button is left, middle, right, scroll-up, scroll-down or none, action click, drag, release or
// move.
function decodeMouse(code, x, y, released) {
	if (!Number.isSafeInteger(code) || code < 0 || !(x >= 1) || !(y >= 1)) return null;
	const base = code & 0b11;
	const motion = (code & 0b100000) !== 0;
	let button;
	let action;
	if ((code & 0b1000000) !== 0) {
		button = (code & 1) === 0 ? "scroll-up" : "scroll-down";
		action = "click";
	} else {
		button = ["left", "middle", "right", "none"][base];
		if (motion && base === 3) action = "move";
		else if (released || base === 3) action = "release";
		else action = motion ? "drag" : "click";
	}
	return {
		kind: "mouse",
		x: x - 1,
		y: y - 1,
		button,
		action,
		shiftKey: (code & 0b100) !== 0,
		altKey: (code & 0b1000) !== 0,
		ctrlKey: (code & 0b10000) !== 0,
	};
}

// The mouse event data starts with, and its length, or null.
export function parseMouse(data) {
	let m = SGR_MOUSE.exec(data);
	if (m) {
		const event = decodeMouse(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === "m");
		return event && { event, length: m[0].length };
	}
	m = X10_MOUSE.exec(data);
	if (m) {
		const [b, x, y] = [m[1], m[2], m[3]].map((c) => c.charCodeAt(0) - 32);
		const event = decodeMouse(b, x, y, false);
		return event && { event, length: m[0].length };
	}
	m = URXVT_MOUSE.exec(data);
	if (m) {
		const event = decodeMouse(Number(m[1]) - 32, Number(m[2]), Number(m[3]), false);
		return event && { event, length: m[0].length };
	}
	return null;
}

// --- keys ------------------------------------------------------------------------------------

const key = (name, mods = {}) => ({
	kind: "key",
	key: name,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...mods,
});

// CSI and SS3 finals, and CSI n ~ codes, by key.
const FINALS = {
	A: "ArrowUp",
	B: "ArrowDown",
	C: "ArrowRight",
	D: "ArrowLeft",
	H: "Home",
	F: "End",
	P: "F1",
	Q: "F2",
	R: "F3",
	S: "F4",
	Z: "Tab",
};
const TILDES = {
	1: "Home",
	2: "Insert",
	3: "Delete",
	4: "End",
	5: "PageUp",
	6: "PageDown",
	7: "Home",
	8: "End",
	11: "F1",
	12: "F2",
	13: "F3",
	14: "F4",
	15: "F5",
	17: "F6",
	18: "F7",
	19: "F8",
	20: "F9",
	21: "F10",
	23: "F11",
	24: "F12",
};
// xterm's modifier parameter: 1 + shift(1) + alt(2) + ctrl(4).
const modifiers = (param) => {
	const m = Math.max(0, (Number(param) || 1) - 1);
	return { shiftKey: (m & 1) !== 0, altKey: (m & 2) !== 0, ctrlKey: (m & 4) !== 0 };
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences start with ESC.
const CSI = /^\x1b\[([0-9;]*)([A-Za-z~])/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences start with ESC.
const SS3 = /^\x1bO([A-Za-z])/;

// A control character as a key: Enter, Tab, Backspace, or Ctrl+letter.
function controlKey(c) {
	const code = c.charCodeAt(0);
	if (c === "\r" || c === "\n") return key("Enter");
	if (c === "\t") return key("Tab");
	if (code === 0x7f || code === 0x08) return key("Backspace");
	if (code === 0) return key(" ", { ctrlKey: true });
	if (code <= 26) return key(String.fromCharCode(code + 96), { ctrlKey: true });
	return null;
}

function parseEscape(data) {
	let m = CSI.exec(data);
	if (m) {
		const [, params, final] = m;
		const parts = params.split(";");
		if (final === "~") {
			const name = TILDES[parts[0]];
			return { event: name ? key(name, modifiers(parts[1])) : null, length: m[0].length };
		}
		const name = FINALS[final];
		const mods = final === "Z" ? { shiftKey: true } : modifiers(parts[1]);
		return { event: name ? key(name, mods) : null, length: m[0].length };
	}
	m = SS3.exec(data);
	if (m) return { event: FINALS[m[1]] ? key(FINALS[m[1]]) : null, length: 3 };
	if (data.length === 1) return { event: key("Escape"), length: 1 };
	if (data[1] === "\x1b") return { event: key("Escape", { altKey: true }), length: 2 };
	// ESC then a character: that character with Alt.
	const [next] = graphemes(data.slice(1));
	const ctrl = controlKey(next);
	return {
		event: ctrl ? { ...ctrl, altKey: true } : key(next, { altKey: true }),
		length: 1 + next.length,
	};
}

// The events in a chunk of terminal input, in order. Unknown escape sequences are dropped.
export function parseInput(data) {
	const events = [];
	let i = 0;
	while (i < data.length) {
		const rest = data.slice(i);
		if (rest.startsWith(PASTE_START)) {
			const end = rest.indexOf(PASTE_END);
			const stop = end === -1 ? rest.length : end;
			events.push({ kind: "paste", text: rest.slice(PASTE_START.length, stop) });
			i += end === -1 ? rest.length : end + PASTE_END.length;
			continue;
		}
		if (rest[0] === "\x1b") {
			const mouse = parseMouse(rest);
			const parsed = mouse ?? parseEscape(rest);
			if (parsed.event) events.push(parsed.event);
			i += parsed.length;
			continue;
		}
		const [g] = graphemes(rest);
		events.push(controlKey(g) ?? key(g));
		i += g.length;
	}
	return events;
}
