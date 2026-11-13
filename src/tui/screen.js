// A Screen: a terminal DOM, its layout and paint into a CellBuffer, and the events a terminal
// sends turned into DOM-like events on the elements under them. A mouse event's target is found
// by position (hitTest: the deepest box under the cell); from the target, tutuca's events.js
// finds the component and handler by walking parentNode and the marker comments, as it does in
// a browser. Keys go to the focused element, and do what a browser does by default when no
// handler prevents it: Tab moves focus, Enter and space click, an input edits its value at its
// caret, and the wheel, arrows and page keys scroll a scroll container.
import { bufferToAnsi, CellBuffer, patchesToAnsi } from "./buffer.js";
import { editKey, insert, isEditable, offsetAt } from "./editing.js";
import { absolutize, borderOf, calculateLayout, clipsOf, layoutTree, paddingOf } from "./layout.js";
import { paintScreen, spanAt } from "./paint.js";
import { makeEvent, TDocument } from "./tdom.js";
import { graphemeWidth, readGrapheme, stringWidth } from "./text.js";

const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// Whether x, y is where a box that clips shows its children: inside its content box on each
// axis it clips.
function reachesChildren(layout, x, y) {
	const props = layout.node.props;
	const clips = clipsOf(props);
	if (!clips.x && !clips.y) return true;
	const { rect } = layout;
	const b = borderOf(props);
	const pad = paddingOf(props);
	const left = rect.x + b + pad.left;
	const top = rect.y + b + pad.top;
	const right = rect.x + rect.w - b - pad.right;
	const bottom = rect.y + rect.h - b - pad.bottom;
	return (!clips.x || (x >= left && x < right)) && (!clips.y || (y >= top && y < bottom));
}

// The element under x, y in an absolutized layout, or null. Later siblings paint over earlier
// ones, so they're tried first; a box that clips (overflow hidden, scroll or auto) hides its
// children outside its content box, as a scroll container hides what's scrolled out of view.
export function hitTest(layout, x, y) {
	if (reachesChildren(layout, x, y)) {
		for (let i = layout.children.length - 1; i >= 0; i--) {
			const hit = hitTest(layout.children[i], x, y);
			if (hit) return hit;
		}
	}
	if (!inside(layout.rect, x, y)) return null;
	return (layout.node.spans && spanElementAt(layout, x, y)) ?? layout.node.el ?? null;
}

// The element of the span drawn at x, y in a text with spans, or null past its text.
function spanElementAt(layout, x, y) {
	const row = layout.rows[y - layout.rect.y];
	if (!row) return null;
	const { spans, props } = layout.node;
	const content = props.children;
	let col = layout.rect.x;
	for (const seg of row) {
		if (seg.text !== undefined) {
			const w = stringWidth(seg.text);
			if (x < col + w) return spanAt(spans, seg.at).el;
			col += w;
			continue;
		}
		for (let at = seg.start; at < seg.end; ) {
			const g = readGrapheme(content, at);
			if (g === null) break;
			const w = graphemeWidth(g.segment);
			if (x < col + w) return spanAt(spans, at).el;
			col += w;
			at = g.end;
		}
	}
	return null;
}

// The elements that take focus, in tree order.
export function focusables(el, out = []) {
	for (const child of el.childNodes) {
		if (child.nodeType !== 1) continue;
		if (child.focusable) out.push(child);
		focusables(child, out);
	}
	return out;
}

// el or its nearest ancestor that scrolls, or null.
const scrollerOf = (el) => {
	for (let n = el; n !== null && n.nodeType === 1; n = n.parentNode) if (n.scrolls) return n;
	return null;
};

const WHEEL_ROWS = 3;

// The OSC 52 sequence that puts text on the system clipboard, in the terminals that allow it.
const base64 = (text) =>
	typeof Buffer !== "undefined"
		? Buffer.from(text, "utf8").toString("base64")
		: btoa(String.fromCharCode(...new TextEncoder().encode(text)));
export const osc52 = (text) => `\x1b]52;c;${base64(text)}\x07`;

export class Screen {
	// write(ansi) gets what changed on each flush; terminal is what it shows ({ colors, unicode },
	// capabilities.js's detectTerminal), everything by default.
	constructor({
		width = 80,
		height = 24,
		write = () => {},
		document = new TDocument(),
		terminal = { colors: "truecolor", unicode: true },
		onCopy = null,
	} = {}) {
		this.terminal = terminal;
		this.document = document;
		this.rootNode = document.root;
		this.width = width;
		this.height = height;
		this.write = write;
		this.buffer = null; // What the terminal shows, to diff the next paint against.
		this.layout = null;
		this.pressed = null; // The element a mouse button went down on, for the click on release.
		this.selecting = null; // The input or textarea a drag selects in.
		this.clipboard = ""; // What Ctrl+C or Ctrl+X took last, for Ctrl+V.
		// Gets what's copied; asks the terminal to put it on the system clipboard by default.
		this.onCopy = onCopy ?? ((text) => this.write(osc52(text)));
		this.reveal = null; // The element focus moved to, for the next layout to scroll into view.
		// The modals open, bottom to top, each with what had focus before it, to give it back.
		this.modals = [];
	}
	get focused() {
		return this.document.activeElement;
	}
	focus(el) {
		if (this.document.activeElement === el) return;
		this.document.activeElement = el;
		this.reveal = el;
		this.document.invalidate();
	}
	// Lays out what morph left in the tree and paints it; returns the new buffer.
	render() {
		const tree = layoutTree(this.rootNode);
		tree.props = { ...tree.props, width: this.width, height: this.height };
		this.layout = absolutize(calculateLayout(tree, this.width, this.height));
		this.trapFocus();
		if (this.reveal !== null && this.reveal === this.focused && this.scrollIntoView(this.reveal)) {
			absolutize(this.layout);
		}
		this.reveal = null;
		const buffer = new CellBuffer(this.width, this.height);
		paintScreen(buffer, this.layout, this.focused);
		return buffer;
	}
	// The layers that are modal (a fixed element with modal), bottom to top.
	modalLayers() {
		return (this.layout?.layers ?? [])
			.map((layer) => layer.node.el)
			.filter((el) => el?.hasAttribute("modal") && el.getAttribute("modal") !== "false");
	}
	// What focus can move in: the top modal, or everything.
	get focusScope() {
		return this.modals.at(-1)?.modal ?? this.rootNode;
	}
	// A modal that opened takes focus, to its first element that takes it; one that closed gives
	// it back to what had it before, if that's still there. Writes past focus(), as layout does.
	trapFocus() {
		const open = this.modalLayers();
		while (this.modals.length > 0 && !open.includes(this.modals.at(-1).modal)) {
			const { previous } = this.modals.pop();
			const scope = this.focusScope;
			const back = previous !== null && scope.contains(previous) ? previous : null;
			this.document.activeElement = back;
			this.reveal = back;
		}
		for (const modal of open) {
			if (this.modals.some((m) => m.modal === modal)) continue;
			this.modals.push({ modal, previous: this.focused });
			const first = modal.focusable ? modal : (focusables(modal)[0] ?? null);
			this.document.activeElement = first;
			this.reveal = first;
		}
	}
	// The element under x, y: on the top layer that has it, else in the tree. While a modal is
	// open, what's under it and outside it is the modal's: it can't be clicked through.
	hitAt(x, y) {
		const layers = this.layout.layers ?? [];
		const top = this.modals.at(-1)?.modal ?? null;
		for (let i = layers.length - 1; i >= 0; i--) {
			const layer = layers[i];
			const hit = hitTest(layer, x, y);
			if (hit) return hit;
			if (layer.node.el === top) return top;
		}
		return top ?? hitTest(this.layout, x, y);
	}
	// Scrolls the scroll containers around el, innermost first, so it's in view; whether any
	// moved. Writes past the setter, as layout does: render lays out again after.
	scrollIntoView(el) {
		let moved = false;
		let { y, h } = el.rect ?? { y: 0, h: 0 };
		for (let c = scrollerOf(el.parentNode); c !== null; c = scrollerOf(c.parentNode)) {
			const view = c.viewport;
			if (!view) continue;
			let delta = 0;
			if (y < view.y) delta = y - view.y;
			else if (y + h > view.y + view.h) delta = Math.min(y - view.y, y + h - (view.y + view.h));
			const max = Math.max(0, c.scrollHeight - c.clientHeight);
			const top = Math.max(0, Math.min(max, c._scrollTop + delta));
			if (top !== c._scrollTop) {
				y -= top - c._scrollTop;
				c._scrollTop = top;
				moved = true;
			}
			// What has to be in view of the next one out is this container, as far as it shows el.
			y = Math.max(y, view.y);
			h = Math.min(h, view.h);
		}
		return moved;
	}
	// Paints, if anything changed, and writes the cells that differ from what's shown.
	flush() {
		if (!this.document.dirty) return;
		this.document.dirty = false;
		const next = this.render();
		const { terminal } = this;
		if (this.buffer === null) {
			this.write(`\x1b[H\x1b[2J${bufferToAnsi(next, terminal).replaceAll("\n", "\r\n")}`);
		} else this.write(patchesToAnsi(this.buffer.diff(next), next.width, terminal));
		this.buffer = next;
	}
	resize(width, height) {
		this.width = width;
		this.height = height;
		this.buffer = null; // Repaints everything.
		this.document.dirty = true;
		this.flush();
	}
	dispatch(type, target, fields) {
		const event = makeEvent(type, target, fields);
		this.rootNode.dispatchEvent(event);
		return event;
	}
	// Scrolls el (a scroll container) by rows, and sends scroll when it moved.
	scrollBy(el, rows) {
		const before = el.scrollTop;
		el.scrollTop = before + rows;
		if (el.scrollTop !== before) this.dispatch("scroll", el, {});
		return el.scrollTop !== before;
	}
	// A mouse event from input.js: mousedown on press (which focuses what takes focus and puts an
	// input's caret where it was pressed), mouseup and then click on release over what it went
	// down on, wheel for scrolling (which scrolls the scroll container under it unless
	// prevented), mousemove for the rest. offsetX and offsetY are relative to the target's box.
	mouse({ x, y, button, action, ctrlKey = false, altKey = false, shiftKey = false }) {
		if (this.layout === null) this.render();
		const target = this.hitAt(x, y) ?? this.rootNode;
		const r = target.rect ?? { x: 0, y: 0 };
		const fields = {
			x,
			y,
			clientX: x,
			clientY: y,
			offsetX: x - r.x,
			offsetY: y - r.y,
			button,
			ctrlKey,
			altKey,
			shiftKey,
		};
		if (button === "scroll-up" || button === "scroll-down") {
			const deltaY = button === "scroll-up" ? -WHEEL_ROWS : WHEEL_ROWS;
			const event = this.dispatch("wheel", target, { ...fields, deltaY });
			if (event.defaultPrevented) return event;
			// The innermost container under it that can still scroll that way takes it.
			for (let c = scrollerOf(target); c !== null; c = scrollerOf(c.parentNode)) {
				if (this.scrollBy(c, deltaY)) break;
			}
			return event;
		}
		if (action === "click") {
			this.pressed = target;
			// Focus goes to the innermost element that takes it around the target, or nowhere.
			let owner = target;
			while (owner !== null && !(owner.nodeType === 1 && owner.focusable)) owner = owner.parentNode;
			this.focus(owner);
			// In an input or textarea a press puts the caret there (Shift selects to there), and
			// dragging selects from it.
			if (isEditable(owner) && owner === target) {
				const at = this.offsetUnder(owner, x, y);
				owner.select(shiftKey ? owner._anchor : at, at);
				owner._goal = null;
				this.selecting = owner;
			}
			return this.dispatch("mousedown", target, fields);
		}
		if (action === "release") {
			this.selecting = null;
			const up = this.dispatch("mouseup", target, fields);
			const pressed = this.pressed;
			this.pressed = null;
			if (
				pressed !== null &&
				(pressed === target || pressed.contains(target) || target.contains(pressed))
			) {
				return this.dispatch("click", pressed.contains(target) ? target : pressed, fields);
			}
			return up;
		}
		if (action === "drag" && this.selecting !== null) {
			const el = this.selecting;
			el.select(el._anchor, this.offsetUnder(el, x, y));
		}
		return this.dispatch("mousemove", target, fields);
	}
	// The offset of el's value drawn at x, y (or nearest it), its scroll counted.
	offsetUnder(el, x, y) {
		const r = el.rect ?? { x: 0, y: 0 };
		return offsetAt(el, x - r.x + el.scrollLeft, y - r.y + el._scrollTop);
	}
	// A press and release at x, y: what a click is.
	click(x, y) {
		this.mouse({ x, y, button: "left", action: "click" });
		return this.mouse({ x, y, button: "left", action: "release" });
	}
	// A wheel tick at x, y: down, or up with up true.
	wheel(x, y, up = false) {
		return this.mouse({ x, y, button: up ? "scroll-up" : "scroll-down", action: "click" });
	}
	// A key from input.js, as keydown on the focused element (the root when nothing is); then,
	// unless a listener prevented it, what the key does by default.
	key({ key, ctrlKey = false, altKey = false, shiftKey = false }) {
		const target = this.focused ?? this.focusScope;
		const event = this.dispatch("keydown", target, { key, ctrlKey, altKey, shiftKey });
		if (event.defaultPrevented) return event;
		if (key === "Tab") this.moveFocus(shiftKey ? -1 : 1);
		else if (
			isEditable(target) &&
			this.afterEdit(
				target,
				editKey(target, { key, ctrlKey, altKey, shiftKey }, this.clipboard),
				key,
			)
		) {
			// Done: the input or textarea took it.
		} else if (this.scrollKey(target, key)) {
			// Done: a scroll container took it.
		} else if ((key === "Enter" || key === " ") && target !== this.rootNode) {
			this.dispatch("click", target, {});
		}
		return event;
	}
	// The arrows, PageUp, PageDown, Home and End scroll the focused scroll container; PageUp and
	// PageDown also scroll the one around what has focus. Whether one took the key.
	scrollKey(target, key) {
		const own = target.scrolls ? target : null;
		const el = own ?? (key === "PageUp" || key === "PageDown" ? scrollerOf(target) : null);
		if (el === null) return false;
		const page = Math.max(1, el.clientHeight - 1);
		const rows = {
			ArrowUp: -1,
			ArrowDown: 1,
			PageUp: -page,
			PageDown: page,
			Home: -el.scrollHeight,
			End: el.scrollHeight,
		}[key];
		if (rows === undefined) return false;
		this.scrollBy(el, rows);
		return true;
	}
	// Text pasted into the focused input or textarea, over its selection.
	paste(text) {
		const el = this.focused;
		if (!isEditable(el)) return;
		this.afterEdit(el, { handled: true, changed: insert(el, text, "edit") }, text);
	}
	moveFocus(step) {
		const all = focusables(this.focusScope);
		if (all.length === 0) return;
		const at = all.indexOf(this.focused);
		const next =
			at === -1 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length;
		this.focus(all[next]);
	}
	// What an edit did, as events: input when the value changed, submit, and copy.
	afterEdit(el, result, data) {
		if (result.copy) this.copy(result.copy);
		if (result.changed) this.dispatch("input", el, { data: data ?? null });
		if (result.submit) this.dispatch("submit", el, {});
		return result.handled;
	}
	// Puts text on the clipboard: Ctrl+V pastes it into an input or textarea, and onCopy(text)
	// gets it, which by default asks the terminal to put it on the system's (OSC 52).
	copy(text) {
		this.clipboard = text;
		this.onCopy(text);
	}
	// Whether the focused element has a selection to copy: Ctrl+C copies it instead of quitting.
	get hasSelection() {
		const el = this.focused;
		return isEditable(el) && el.selectionStart !== el.selectionEnd;
	}
	// What the screen shows, as plain text: for tests.
	toString() {
		return (this.buffer ?? this.render()).toString();
	}
}
