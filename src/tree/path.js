// Paths: where a node is in the state (KeyPath), how a message got there (DispatchPath), and
// where one goes before it is fixed (Selector, Target). spec/tree's path steps are (field f),
// (index f i) and (key f κ), a frame here; a written path can also hold (sel f g), a seqItem op.
import { jsonText, keyText } from "./text.js";

// The keys from the root to a value.
export class KeyPath {
	constructor(keys = []) {
		this.keys = keys;
	}
	// undefined past a missing key, instead of a TypeError on reading it.
	getIn(root) {
		let v = root;
		for (const key of this.keys) v = v?.[key];
		return v;
	}
	// Sets the value at the path in root, a mutable draft, and returns the root.
	setIn(root, v) {
		if (this.keys.length === 0) return v;
		const parent = new KeyPath(this.keys.slice(0, -1)).getIn(root);
		parent[this.keys.at(-1)] = v;
		return root;
	}
	toString() {
		return this.keys.map(keyText).join("") || "·";
	}
}
// One step of a DispatchPath: keys into the value, then the item of a collection there, if any.
// A frame with a provider starts from the frame at the provider's depth, plus its keys, instead
// of from the frame before it: what a node reads from an ancestor that provides it.
// isNode marks the frames that reach a node.
export class Frame {
	constructor(keys, item = null, provider = null, isNode = false) {
		this.keys = keys;
		this.item = item;
		this.provider = provider;
		this.isNode = isNode;
	}
	get accessKeys() {
		return this.item === null ? this.keys : [...this.keys, this.item];
	}
	asNode() {
		return new Frame(this.keys, this.item, this.provider, true);
	}
	forItem(key) {
		return new Frame(this.accessKeys, key, this.provider, false);
	}
	// The keys and item, without the provider.
	toString() {
		return `${this.keys.map(keyText).join("")}${this.item === null ? "" : `[${jsonText(this.item)}]`}`;
	}
}
// What tells two frames apart: where each starts, its keys and its item.
const frameText = ({ provider: p, keys, item }) =>
	JSON.stringify([p === null ? null : [p.name, p.depth, p.keys], keys, item]);
// The frames a message went through from the root: spec/tree's π.
export class DispatchPath {
	/** @param {Frame[]} frames */
	constructor(frames = []) {
		this.frames = frames;
	}
	get isRootPath() {
		return this.frames.length === 0;
	}
	concat(frames) {
		return new DispatchPath([...this.frames, ...frames]);
	}
	toParentPath() {
		return new DispatchPath(this.frames.slice(0, -1));
	}
	// Up to the last frame that reaches a node.
	toNodePath() {
		let end = this.frames.length;
		while (end > 0 && !this.frames[end - 1].isNode) end--;
		return new DispatchPath(this.frames.slice(0, end));
	}
	// The keys to where the last frame leads, its item included.
	toKeyPath() {
		const prefixes = [[]];
		for (const frame of this.frames) {
			const { provider } = frame;
			const start =
				provider === null ? prefixes.at(-1) : [...prefixes[provider.depth], ...provider.keys];
			prefixes.push([...start, ...frame.accessKeys]);
		}
		return new KeyPath(prefixes.at(-1));
	}
	// The keys to the node the path reaches: what an address checks.
	toNodeKeyPath() {
		return this.toNodePath().toKeyPath();
	}
	toString() {
		return this.frames.join("") || "·";
	}
	// Whether prefix's frames start this path's: it reached prefix on the way here.
	startsWith(prefix) {
		if (prefix.frames.length > this.frames.length) return false;
		return prefix.frames.every((f, i) => frameText(f) === frameText(this.frames[i]));
	}
	// The key of the child of receiver this path goes through; null when it doesn't go through
	// receiver to one of its children (the receiver itself or an ancestor of it sent, or a
	// component in another branch).
	sourceKeyIn(receiver) {
		let i = receiver.frames.length;
		if (i >= this.frames.length || !this.startsWith(receiver)) return null;
		while (i < this.frames.length - 1 && !this.frames[i].isNode) i++;
		return this.frames[i].item;
	}
}
// Paths print their ops as .name, .name[item] or .name[keyName], with · for the root.
const opText = (op) =>
	`.${op.name}${op.t === "item" ? `[${jsonText(op.key)}]` : op.t === "seqItem" ? `[${op.keyName}]` : ""}`;
// A written path, relative to a node: field (field f), item (index f i) or (key f κ), and
// seqItem (sel f g), the item of f at the key in the node's g. fix(value) turns it into frames
// against the value it starts from. item, field and seqItem add an op and return the selector,
// so a selector fn writes one as sel.field("items").item("items", 3).
export class Selector {
	constructor(ops = []) {
		this.ops = ops;
	}
	item(name, key) {
		return this.add({ t: "item", name, key });
	}
	field(name) {
		return this.add({ t: "field", name });
	}
	seqItem(name, keyName) {
		return this.add({ t: "seqItem", name, keyName });
	}
	add(op) {
		this.ops.push(op);
		return this;
	}
	toString() {
		return this.ops.map(opText).join("") || "·";
	}
	fix(value) {
		const frames = [];
		for (const op of this.ops) {
			const item = op.t === "item" ? op.key : op.t === "seqItem" ? value[op.keyName] : null;
			const frame = new Frame([op.name], item ?? null, null, true);
			frames.push(frame);
			value = new KeyPath(frame.accessKeys).getIn(value);
		}
		return frames;
	}
}
// Where a message goes before it is sent: a selector from a base path.
export class Target {
	/** @param {DispatchPath} base @param {Selector} selector */
	constructor(base, selector = new Selector()) {
		this.base = base;
		this.selector = selector;
	}
	fix(root) {
		return this.base.concat(this.selector.fix(this.base.toKeyPath().getIn(root)));
	}
}
// The selector fn writes, called with self as this.
export const selectorFrom = (fn, self) => {
	const selector = new Selector();
	fn.call(self, selector);
	return selector;
};
