// Builders for states of the tree spec written by hand, in the JSON shape spec/tree/export.rkt
// writes, so an explanation can show any state, not only the ones a scenario reaches:
//
//   state({
//     tree: inst("Items", 0, { slots: [list("items", inst("Item", 3, { locals: { label: 20 } }))] }),
//     inflight: [response("fetch", 2, "ok 100", at(0), at(1, "items[0]"))],
//   })
//
// worldOf (model.js) turns one into a World.

// "panel", "items[0]" or 'named["a"]': a step from a parent to a child.
const step = (text) => {
	const m = /^([^[]+)\[(.*)\]$/.exec(text);
	if (m === null) return { slot: text, key: "", text };
	const key = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2];
	return { slot: m[1], key, text };
};

export const inst = (kind, id, { locals = {}, slots = [], control = "" } = {}) => ({
	kind,
	id,
	locals: Object.entries(locals).map(([name, value]) => ({ name, value: String(value) })),
	slots,
	control,
});
// A field holding node.
export const field = (name, node) => ({
	name,
	type: "field",
	items: [{ key: "", cleared: false, node }],
});
// A list of nodes; null is a cleared place.
export const list = (name, ...nodes) => ({
	name,
	type: "list",
	items: nodes.map((node, i) => ({ key: String(i), cleared: node === null, node })),
});
// A map from keys to nodes; null is a cleared place.
export const map = (name, entries) => ({
	name,
	type: "map",
	items: Object.entries(entries).map(([key, node]) => ({ key, cleared: node === null, node })),
});

export const HOST = { host: true };
// The address of instance id, recorded at the path the steps spell from the root.
export const at = (id, ...steps) => ({ host: false, id, path: steps.map(step), anchor: null });
// A send-at's address: also its sender and the path relative to it.
export const anchored = (address, sender, ...rel) => ({
	...address,
	anchor: { sender, rel: rel.map(step) },
});

const message = (
	mode,
	name,
	from,
	to,
	{ args = [], request = null, urgent = false, result = null, hop = false, expected = null } = {},
) => ({
	mode,
	name,
	args: args.map(String),
	request,
	urgent,
	result,
	from,
	to,
	hop,
	expected,
});
export const send = (name, from, to, args = []) => message("send", name, from, to, { args });
// A notification on its way up: last is where it is (its sender, before the first hop).
export const notify = (name, from, last = from, args = []) =>
	message("notify", name, from, last, { args, hop: true });
export const request = (name, ρ, from, last = from, { args = [], urgent = false } = {}) =>
	message("request", name, from, last, { args, request: ρ, urgent, hop: true });
// result is "ok 1", "error 2" or "unhandled".
export const response = (name, ρ, result, from, to, { urgent = false } = {}) => {
	const [kind, ...value] = result.split(" ");
	return message("response", name, from, to, {
		request: ρ,
		urgent,
		result: { kind, value: value.join(" ") },
	});
};

// bad marks an observation that breaks a property.
export const obs = (kind, text, bad = false) => ({ kind, text, bad });

export const state = ({
	tree,
	queue = [],
	inflight = [],
	script = [],
	obs = [],
	quiescent = false,
}) => ({
	tree,
	queue,
	inflight,
	script,
	obs,
	quiescent,
});
