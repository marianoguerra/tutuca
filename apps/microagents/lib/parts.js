// The parts of a message (its child messages) as agents read and write them: by kind, with
// their data read as strings or plain values, and written back losslessly (parts that didn't
// change stay the same objects, so they encode to the same bytes).
import { fromJson, message, messages } from "../core/tdata.js";
import { parse, sameAsPart } from "./json.js";

// The child messages of the kind (or one of the kinds).
export const kidsOf = (msg, kind) => {
	const kinds = Array.isArray(kind) ? kind : [kind];
	return (msg.messages ?? []).filter((m) => kinds.includes(m.kind));
};
// msg with kids as its child messages (a data message becomes a messages one).
export const withKids = (msg, kids) =>
	msg.messages === undefined
		? messages(msg.id, msg.kind, kids, msg.meta)
		: { ...msg, messages: kids };
// The string at key of a part's data (an Object), or fallback.
export const strOf = (m, key, fallback = "") => {
	const v = m?.data instanceof Map ? m.data.get(key) : undefined;
	return typeof v === "string" ? v : fallback;
};
// m with these keys of its data (an Object) set; m itself when they're already so. A null or
// undefined value removes the key, and so does "" with dropEmpty (so a key the part never had
// isn't added empty). With m null, { data } with just these keys (for a new part).
export const withData = (m, values, { dropEmpty = false } = {}) => {
	if (m === null || m === undefined) m = { data: new Map() };
	const old = m.data instanceof Map ? m.data : new Map();
	const data = new Map(old);
	for (const [k, v] of Object.entries(values)) {
		if (v === null || v === undefined || (dropEmpty && v === "")) data.delete(k);
		else data.set(k, v);
	}
	const same = data.size === old.size && [...data].every(([k, v]) => old.get(k) === v);
	return same ? m : { ...m, data };
};
// One header of a part's meta dialect as plain JSON, or fallback.
export const headerOf = (m, dialect, key, fallback = null) => {
	const v = m?.meta?.get(dialect)?.get(key);
	if (v === undefined) return fallback;
	return typeof v === "bigint" ? Number(v) : v;
};
// msg with its part of kind and id replaced by update(part), or, when it has none, create()
// added at the end (nothing when create gives null). msg itself when nothing changed: for
// agents that edit one part (a spec, a container) next to encodeParts for the rest.
export const withPart = (msg, kind, id, update, create = () => null) => {
	const kids = msg.messages ?? [];
	const i = kids.findIndex((m) => m.kind === kind && m.id === id);
	if (i < 0) {
		const made = create();
		return made === null ? msg : withKids(msg, [...kids, made]);
	}
	const m = update(kids[i]);
	return m === kids[i] ? msg : withKids(msg, kids.with(i, m));
};
// msg with the part of kind and id holding the JSON in text: replaced when the text is JSON that
// differs from it, added at the end (with id, or newId when id is "") when there's none and the
// text is JSON, and msg as it is otherwise (text that doesn't parse changes nothing).
export const withJsonPart = (msg, { kind, id, text, newId = "p1" }) => {
	const { value, error } = parse(text);
	if (error !== "" || text.trim() === "") return msg;
	return withPart(
		msg,
		kind,
		id,
		(m) => (sameAsPart(m, text) ? m : { ...m, data: fromJson(value) }),
		() => message(id || newId, kind, fromJson(value)),
	);
};
// The first id prefix1, prefix2, … that no item has.
export const nextId = (prefix, items) => {
	const ids = new Set(items.map((x) => x.id));
	let n = items.length + 1;
	while (ids.has(`${prefix}${n}`)) n++;
	return `${prefix}${n}`;
};

// msg written from the agent's items. specs maps a part kind to { items, id?(x), same(m, x),
// update(m, x), create(x) } (one spec may serve several kinds). Per part of a spec's kind: the
// item with its id is gone → the part goes (or stays, with keepOthers: for agents that edit
// some parts of a kind); same → the part stays as it is; otherwise update. Items without a
// part are created at the end, in their order. Parts of other kinds stay put.
export const encodeParts = (msg, specs, { keepOthers = false } = {}) => {
	const seen = new Map();
	const byId = new Map();
	for (const spec of new Set(Object.values(specs))) {
		const id = spec.id ?? ((x) => x.id);
		byId.set(spec, new Map(spec.items.map((x) => [id(x), x])));
		seen.set(spec, new Set());
	}
	const kids = [];
	for (const m of msg.messages ?? []) {
		const spec = specs[m.kind];
		if (spec === undefined) {
			kids.push(m);
			continue;
		}
		const x = byId.get(spec).get(m.id);
		if (x === undefined || seen.get(spec).has(m.id)) {
			if (keepOthers) kids.push(m);
			continue;
		}
		seen.get(spec).add(m.id);
		kids.push(spec.same?.(m, x) ? m : spec.update(m, x));
	}
	for (const spec of new Set(Object.values(specs))) {
		const id = spec.id ?? ((x) => x.id);
		for (const x of spec.items) {
			if (seen.get(spec).has(id(x))) continue;
			const made = spec.create(x);
			if (made !== null && made !== undefined) kids.push(made);
		}
	}
	// A spec with ordered: true puts its parts in its items' order, in the places its parts take.
	for (const spec of new Set(Object.values(specs))) {
		if (!spec.ordered) continue;
		const id = spec.id ?? ((x) => x.id);
		const rank = new Map(spec.items.map((x, i) => [id(x), i]));
		const kinds = new Set(Object.keys(specs).filter((k) => specs[k] === spec));
		const slots = kids.flatMap((k, i) => (kinds.has(k.kind) && rank.has(k.id) ? [i] : []));
		const sorted = slots.map((i) => kids[i]).sort((a, b) => rank.get(a.id) - rank.get(b.id));
		slots.forEach((slot, j) => {
			kids[slot] = sorted[j];
		});
	}
	const unchanged =
		kids.length === (msg.messages ?? []).length && kids.every((k, i) => k === msg.messages[i]);
	return unchanged ? msg : withKids(msg, kids);
};
