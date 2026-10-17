// Paths: where a component is in the state (UpdatePath), how a message got there (DispatchPath)
// and where it goes (Selector, Target).
const jsonText = (v) => {
	try {
		return JSON.stringify(v) ?? String(v);
	} catch {
		return String(v);
	}
};
const keyText = (key) => (typeof key === "string" ? `.${key}` : `[${jsonText(key)}]`);
const opText = (op) =>
	`.${op.name}${op.t === "item" ? `[${jsonText(op.key)}]` : op.t === "seqItem" ? `[${op.keyName}]` : ""}`;
export class UpdatePath {
	constructor(keys = []) {
		this.keys = keys;
	}
	getIn(root) {
		let v = root;
		for (const key of this.keys) v = v[key];
		return v;
	}
	setIn(root, v) {
		if (this.keys.length === 0) return v;
		const parent = new UpdatePath(this.keys.slice(0, -1)).getIn(root);
		parent[this.keys.at(-1)] = v;
		return root;
	}
}
export class Frame {
	constructor(keys, item = null, provider = null, isComponent = false) {
		this.keys = keys;
		this.item = item;
		this.provider = provider;
		this.isComponent = isComponent;
	}
	get accessKeys() {
		return this.item === null ? this.keys : [...this.keys, this.item];
	}
	asComponent() {
		return new Frame(this.keys, this.item, this.provider, true);
	}
	forItem(key) {
		return new Frame(this.accessKeys, key, this.provider, false);
	}
	toMeta() {
		const { provider: p } = this;
		const base = p === null ? null : { v: p.name, d: p.depth, k: p.keys };
		return { t: "frame", p: base, k: this.keys, i: this.item };
	}
	static fromMeta({ p, k, i }) {
		const provider = p === null ? null : { name: p.v, depth: p.d, keys: p.k };
		return new Frame(k, i, provider);
	}
	// The keys and item, without the provider.
	toString() {
		return `${this.keys.map(keyText).join("")}${this.item === null ? "" : `[${jsonText(this.item)}]`}`;
	}
}
export class DispatchPath {
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
	toComponentPath() {
		let end = this.frames.length;
		while (end > 0 && !this.frames[end - 1].isComponent) end--;
		return new DispatchPath(this.frames.slice(0, end));
	}
	resolve() {
		const prefixes = [[]];
		for (const frame of this.frames) {
			const { provider } = frame;
			const start =
				provider === null ? prefixes.at(-1) : [...prefixes[provider.depth], ...provider.keys];
			prefixes.push([...start, ...frame.accessKeys]);
		}
		return new UpdatePath(prefixes.at(-1));
	}
	toUpdatePath() {
		return this.toComponentPath().resolve();
	}
	toString() {
		return this.frames.join("") || "·";
	}
	sourceKeyIn(receiver) {
		let i = receiver.frames.length;
		if (i >= this.frames.length) return null;
		while (i < this.frames.length - 1 && !this.frames[i].isComponent) i++;
		return this.frames[i].item;
	}
}
export class Selector {
	constructor(ops = []) {
		this.ops = ops;
	}
	toString() {
		return this.ops.map(opText).join("") || "·";
	}
	freeze(value) {
		const frames = [];
		for (const op of this.ops) {
			const item = op.t === "item" ? op.key : op.t === "seqItem" ? value[op.keyName] : null;
			const frame = new Frame([op.name], item ?? null, null, true);
			frames.push(frame);
			value = new UpdatePath(frame.accessKeys).getIn(value);
		}
		return frames;
	}
}
export class Target {
	constructor(base, selector = new Selector()) {
		this.base = base;
		this.selector = selector;
	}
	freeze(root) {
		return this.base.concat(this.selector.freeze(this.base.resolve().getIn(root)));
	}
}
export const routeFor = (path) => ({ path, updatePath: path.toUpdatePath() });
class PathBuilder {
	constructor() {
		this.ops = [];
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
}
export const selectorFrom = (fn, self) => {
	const pb = new PathBuilder();
	fn.call(self, pb);
	return new Selector(pb.ops);
};
