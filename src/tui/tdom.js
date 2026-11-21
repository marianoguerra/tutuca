// A retained terminal DOM: the part of the DOM that src/vdom's morph builds and patches and
// src/core/host/events.js walks (parentNode, previousSibling, a comment's data, data-eid), so a
// tutuca Host renders into it and routes its events unchanged. Layout and paint read the element
// tree from it; comments, which hold tutuca's component and loop markers, take no space.
import { HTML_NS } from "../vdom/index.js";

class TNode {
	constructor(ownerDocument) {
		this.ownerDocument = ownerDocument;
		this.parentNode = null;
		this.childNodes = [];
	}
	sibling(offset) {
		const siblings = this.parentNode?.childNodes;
		return siblings ? (siblings[siblings.indexOf(this) + offset] ?? null) : null;
	}
	get nextSibling() {
		return this.sibling(1);
	}
	get previousSibling() {
		return this.sibling(-1);
	}
	// A fragment inserts its children and is left empty, as the DOM's is.
	insertBefore(node, ref) {
		const nodes = node.nodeType === 11 ? node.childNodes.splice(0) : [node];
		for (const n of nodes) {
			n.parentNode?.detach(n);
			n.parentNode = this;
		}
		const at = ref === null ? this.childNodes.length : this.childNodes.indexOf(ref);
		if (at === -1) throw new Error("insertBefore: the reference node is not a child");
		this.childNodes.splice(at, 0, ...nodes);
		this.changed();
		return node;
	}
	appendChild(node) {
		return this.insertBefore(node, null);
	}
	removeChild(node) {
		if (node.parentNode !== this) throw new Error("removeChild: not a child");
		this.detach(node);
		this.changed();
		return node;
	}
	replaceChild(node, old) {
		this.insertBefore(node, old);
		return this.removeChild(old);
	}
	replaceChildren(...nodes) {
		for (const n of this.childNodes.splice(0)) n.parentNode = null;
		for (const n of nodes) this.appendChild(n);
		this.changed();
	}
	contains(node) {
		for (let n = node; n; n = n.parentNode) if (n === this) return true;
		return false;
	}
	detach(node) {
		this.childNodes.splice(this.childNodes.indexOf(node), 1);
		node.parentNode = null;
		this.ownerDocument?.removed(node);
	}
	changed() {
		this.ownerDocument?.invalidate();
	}
	get textContent() {
		return this.childNodes.map((c) => c.textContent).join("");
	}
}

class TCharacterData extends TNode {
	constructor(doc, data) {
		super(doc);
		this._data = String(data);
	}
	get data() {
		return this._data;
	}
	set data(v) {
		this._data = String(v);
		this.changed();
	}
	get textContent() {
		return this._data;
	}
}
export class TText extends TCharacterData {
	nodeType = 3;
}
export class TComment extends TCharacterData {
	nodeType = 8;
	get textContent() {
		return "";
	}
}
export class TFragment extends TNode {
	nodeType = 11;
}

// Attributes are strings in a Map. morph's setProp assigns a name that is `in` the node and sets
// the attribute when that throws or the name isn't there: value, checked, scrollTop and
// scrollLeft, as on a page, are the ones a view can set. What layout and the element itself keep
// (rect, layout, viewport, scrollHeight, clientHeight, attributes, listeners) is read only, so a
// view's attribute of one of those names is an attribute.
export class TElement extends TNode {
	nodeType = 1;
	namespaceURI = HTML_NS;
	constructor(doc, tag) {
		super(doc);
		this.localName = tag.toLowerCase();
		this.tagName = tag.toUpperCase();
		this._attributes = new Map();
		this._listeners = new Map();
		// What each layout places it at (place, placeScroll): rect is { x, y, w, h } in screen
		// cells, layout its layout, and for a scroll container the rest.
		this._placed = { rect: null, layout: null, scrollHeight: 0, clientHeight: 0, viewport: null };
		this._value = "";
		this._checked = false;
		// An input's or textarea's selection: where it started (anchor) and where it's moved to
		// (focus, where the caret is); a caret is a selection with both at one offset.
		this._anchor = 0;
		this._focus = 0;
		this._scrollTop = 0; // Rows a scroll container's content is scrolled up by.
		this._scrollLeft = 0; // Columns an input's value is scrolled left by, to show its caret.
	}
	get attributes() {
		return this._attributes;
	}
	get listeners() {
		return this._listeners;
	}
	get rect() {
		return this._placed.rect;
	}
	get layout() {
		return this._placed.layout;
	}
	get scrollHeight() {
		return this._placed.scrollHeight;
	}
	get clientHeight() {
		return this._placed.clientHeight;
	}
	// A scroll container's content box on the screen, { x, y, w, h }.
	get viewport() {
		return this._placed.viewport;
	}
	// Where layout put it: its layout, absolutized (its rect is layout.rect).
	place(layout) {
		this._placed.rect = layout.rect;
		this._placed.layout = layout;
	}
	// A scroll container's sizes and viewport, from its layout.
	placeScroll(scrollHeight, clientHeight, viewport) {
		Object.assign(this._placed, { scrollHeight, clientHeight, viewport });
	}
	getAttribute(name) {
		return this.attributes.get(name) ?? null;
	}
	setAttribute(name, value) {
		const v = String(value);
		if (this.attributes.get(name) === v) return;
		this.attributes.set(name, v);
		this.changed();
	}
	removeAttribute(name) {
		if (this.attributes.delete(name)) this.changed();
	}
	hasAttribute(name) {
		return this.attributes.has(name);
	}
	get value() {
		return this._value;
	}
	// A new value puts the caret at its end, as on a page; setting the value it has keeps it.
	set value(v) {
		const s = v == null ? "" : String(v);
		if (s === this._value) return;
		this._value = s;
		this._anchor = this._focus = s.length;
		this.changed();
	}
	get selectionStart() {
		return Math.min(this._anchor, this._focus);
	}
	get selectionEnd() {
		return Math.max(this._anchor, this._focus);
	}
	// Where the caret is: the end of the selection that moves.
	get caret() {
		return this._focus;
	}
	// Where the selection started: the end that stays as the caret moves.
	get anchor() {
		return this._anchor;
	}
	set selectionStart(at) {
		this.setSelectionRange(at, Math.max(at, this.selectionEnd));
	}
	set selectionEnd(at) {
		this.setSelectionRange(Math.min(this.selectionStart, at), at);
	}
	// n as a position in the value.
	_clamp(n) {
		return Math.max(0, Math.min(this._value.length, Math.trunc(n) || 0));
	}
	// As on a page: start to end, the caret at end unless direction is backward. Clamped to the
	// value.
	setSelectionRange(start, end, direction = "forward") {
		const [a, b] = [this._clamp(start), this._clamp(Math.max(start, end))];
		this.select(direction === "backward" ? b : a, direction === "backward" ? a : b);
	}
	// The selection from anchor to focus, the caret at focus; select(at, at) is a caret.
	select(anchor, focus = anchor) {
		const [a, f] = [this._clamp(anchor), this._clamp(focus)];
		if (a === this._anchor && f === this._focus) return;
		this._anchor = a;
		this._focus = f;
		this.changed();
	}
	get selectedText() {
		return this._value.slice(this.selectionStart, this.selectionEnd);
	}
	get scrollTop() {
		return this._scrollTop;
	}
	// Clamped to what there is to scroll (scrollHeight - clientHeight) once laid out; layout
	// clamps one set before.
	set scrollTop(v) {
		const max = this.layout ? Math.max(0, this.scrollHeight - this.clientHeight) : Infinity;
		const top = Math.max(0, Math.min(max, Math.trunc(Number(v)) || 0));
		if (top === this._scrollTop) return;
		this._scrollTop = top;
		this.changed();
	}
	get scrollLeft() {
		return this._scrollLeft;
	}
	set scrollLeft(v) {
		const left = Math.max(0, Math.trunc(Number(v)) || 0);
		if (left === this._scrollLeft) return;
		this._scrollLeft = left;
		this.changed();
	}
	// Sets where it's scrolled to without asking for a paint: for layout and paint, which clamp it
	// and keep the caret in view while they make one. Each is left as it is when not given.
	settleScroll({ top = this._scrollTop, left = this._scrollLeft }) {
		this._scrollTop = top;
		this._scrollLeft = left;
	}
	// Whether its content scrolls: overflow or overflowY scroll (or auto).
	get scrolls() {
		const y = this.getAttribute("overflowY") ?? this.getAttribute("overflow");
		return y === "scroll" || y === "auto";
	}
	get checked() {
		return this._checked;
	}
	set checked(v) {
		this._checked = !!v;
		this.changed();
	}
	get type() {
		return this.getAttribute("type") ?? "";
	}
	get innerHTML() {
		return "";
	}
	set innerHTML(_html) {
		throw new Error("a terminal element has no innerHTML: dangerouslySetInnerHTML is for pages");
	}
	// An input, or anything marked focusable, takes focus: by Tab, or by a click on it.
	get focusable() {
		return (
			this.localName === "input" ||
			this.localName === "textarea" ||
			(this.hasAttribute("focusable") && this.getAttribute("focusable") !== "false")
		);
	}
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(listener);
	}
	removeEventListener(type, listener) {
		this.listeners.get(type)?.delete(listener);
	}
	// Bubbles from the target up; no capture phase, since tutuca listens on the root only and
	// finds the handler itself. Returns false when a listener called preventDefault.
	dispatchEvent(event) {
		for (let n = event.target; n && !event.propagationStopped; n = n.parentNode) {
			event.currentTarget = n;
			for (const l of n.listeners?.get(event.type) ?? []) {
				if (typeof l === "function") l(event);
				else l.handleEvent(event);
			}
		}
		return !event.defaultPrevented;
	}
}

export class TDocument {
	constructor(rootTag = "box") {
		this.dirty = true;
		// Called once each time the tree goes from painted to changed: a terminal schedules a
		// paint with it.
		this.onInvalidate = null;
		this.activeElement = null;
		this.root = this.createElement(rootTag);
	}
	createElement(tag) {
		return new TElement(this, tag);
	}
	createElementNS(_ns, tag) {
		return new TElement(this, tag);
	}
	createTextNode(text) {
		return new TText(this, text);
	}
	createComment(text) {
		return new TComment(this, text);
	}
	createDocumentFragment() {
		return new TFragment(this);
	}
	invalidate() {
		if (this.dirty) return;
		this.dirty = true;
		this.onInvalidate?.();
	}
	// Focus leaves an element morph took out of the tree.
	removed(node) {
		if (this.activeElement !== null && node.contains(this.activeElement)) this.activeElement = null;
	}
}

// An event as the DOM makes one: type and target, preventDefault and stopPropagation, and the
// rest (key, x, y, button, ...) from fields.
export function makeEvent(type, target, fields = {}) {
	return {
		type,
		target,
		currentTarget: target,
		defaultPrevented: false,
		propagationStopped: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopPropagation() {
			this.propagationStopped = true;
		},
		...fields,
	};
}
