// A node's identity (spec/tree's ι): a number fresh for each node made, kept by the copies an
// update makes of it, so updates keep it and only making a node (or returning a new one) gives
// a new one. A value with an identity is a node: what an address can reach.
export const idSym = Symbol("TutucaId");
export const idOf = (v) => v?.[idSym];
export const isNode = (v) => idOf(v) !== undefined;
let nextId = 1;
// Gives obj a fresh identity, and returns it.
export const mint = (obj) => {
	obj[idSym] = nextId++;
	return obj;
};
// A copy of v in which every node is a new one (spec/tree's M8 copy): the same prototype and
// data, its own symbols (a component's scope) kept, and a fresh identity for each node at any
// depth. Arrays, plain objects, Maps and Sets holding a node are rebuilt around its copy; data
// holding none is shared, as an update shares it. What was frozen is frozen. Sharing v instead
// would put two nodes with one identity in the tree, and an address would reach either.
export const copy = (v) => {
	const copied = copyNodes(v);
	return copied === undefined ? v : copied;
};
// The copy of v, or undefined when v holds no node.
const copyNodes = (v) => {
	if (v === null || typeof v !== "object") return undefined;
	if (v instanceof Map) {
		const entries = [...v].map(([k, x]) => [k, copyNodes(x) ?? x]);
		if (entries.every(([k, x]) => x === v.get(k))) return undefined;
		return seal(v, new Map(entries));
	}
	if (v instanceof Set) {
		const before = [...v];
		const items = before.map((x) => copyNodes(x) ?? x);
		if (items.every((x, i) => x === before[i])) return undefined;
		return seal(v, new Set(items));
	}
	const node = isNode(v);
	const keys = Object.keys(v);
	const values = keys.map((k) => copyNodes(v[k]));
	if (!node && values.every((x) => x === undefined)) return undefined;
	const out = Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v));
	keys.forEach((k, i) => {
		out[k] = values[i] ?? v[k];
	});
	// Symbols (a component's scope) are the node's, not its data: kept as they are.
	for (const k of Object.getOwnPropertySymbols(v)) if (k !== idSym) out[k] = v[k];
	return seal(v, node ? mint(out) : out);
};
const seal = (from, out) => (Object.isFrozen(from) ? Object.freeze(out) : out);
