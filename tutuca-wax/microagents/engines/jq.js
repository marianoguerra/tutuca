// Host functions for jq-lab: jq filters (jq-wasm, jq 1.8), run synchronously
// once loadJq has resolved.
//
//   jq_error(filter)                  "" or the filter's compile error
//   jq_run(filter, input, max)        { outputs (a list, or null on an error), error, more }:
//                                     at most max outputs (the filter runs in limit(max + 1; …))
//   jq_same(a, b)                     whether two JSON values are equal, object keys in any order
//   jq_shape(value)                   a compact type sketch: {a: number, items: [{id: string}]}
//   jq_pointer(value, pointer)        { value } at an RFC 6901 pointer, or { error }
//   jq_parse(text)                    { value } of JSON text, or { error }
export const bundle = "jq";

const MAX = 100;

// A Map used as a cache of at most n entries (cleared when full).
const memo = (n, f) => {
	const cache = new Map();
	return (key) => {
		if (!cache.has(key)) {
			if (cache.size >= n) cache.clear();
			cache.set(key, f(key));
		}
		return cache.get(key);
	};
};

const cleanError = (text) => text.replace(/^jq: error \(at [^)]*\): /, "").trim();

const sortKeys = (v) =>
	Array.isArray(v)
		? v.map(sortKeys)
		: v !== null && typeof v === "object"
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, sortKeys(v[k])]),
				)
			: v;
const canon = (v) => JSON.stringify(sortKeys(v));

const shapeOf = (v, depth = 0) => {
	if (v === null) return "null";
	if (Array.isArray(v)) {
		if (v.length === 0) return "[]";
		if (depth > 6) return "[…]";
		const kinds = [...new Set(v.slice(0, 50).map((x) => shapeOf(x, depth + 1)))];
		return `[${kinds.slice(0, 4).join(" | ")}${kinds.length > 4 ? " | …" : ""}]`;
	}
	if (typeof v === "object") {
		if (depth > 6) return "{…}";
		const keys = Object.keys(v);
		const items = keys.slice(0, 40).map((k) => `${k}: ${shapeOf(v[k], depth + 1)}`);
		return `{${items.join(", ")}${keys.length > 40 ? ", …" : ""}}`;
	}
	return typeof v;
};

const resolvePointer = (value, pointer) => {
	if (pointer === "") return { value };
	if (!pointer.startsWith("/")) return { error: `nothing at ${pointer}: a pointer starts with "/"` };
	let at = value;
	for (const raw of pointer.slice(1).split("/")) {
		const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
		if (Array.isArray(at)) {
			if (!/^(0|[1-9][0-9]*)$/.test(token) || Number(token) >= at.length)
				return { error: `nothing at ${pointer}: no index ${token} in an array of ${at.length}` };
			at = at[Number(token)];
		} else if (at !== null && typeof at === "object") {
			if (!Object.hasOwn(at, token)) return { error: `nothing at ${pointer}: no key ${JSON.stringify(token)}` };
			at = at[token];
		} else return { error: `nothing at ${pointer}: ${JSON.stringify(token)} goes into a ${at === null ? "null" : typeof at}` };
	}
	return { value: at };
};

export const make = async (engine) => {
	const jq = await engine.loadJq();
	const compileError = memo(512, (filter) => {
		if (filter.trim() === "") return "the filter is empty";
		const r = jq.raw("null", filter);
		return /compile error/.test(r.stderr) ? r.stderr.trim() : "";
	});
	// key: max \0 filter \0 input text.
	const run = memo(2000, (key) => {
		const [max, filter, text] = key.split("\u0000");
		const error = compileError(filter);
		if (error) return { outputs: null, error, more: false };
		const n = Number(max);
		try {
			const outputs = jq.json(text, `limit(${n + 1};\n${filter}\n)`);
			const more = outputs.length > n;
			return { outputs: more ? outputs.slice(0, n) : outputs, error: "", more };
		} catch (e) {
			return { outputs: null, error: cleanError(e.message ?? String(e)), more: false };
		}
	});
	return {
		jq_error: (filter) => compileError(filter),
		jq_run: (filter, input, max) =>
			run(`${Math.max(0, Math.min(max || MAX, MAX))}\u0000${filter}\u0000${JSON.stringify(input ?? null)}`),
		jq_same: (a, b) => canon(a) === canon(b),
		jq_shape: (value) => shapeOf(value),
		jq_pointer: (value, pointer) => resolvePointer(value, pointer),
		jq_parse: (text) => {
			try {
				return { value: JSON.parse(text) };
			} catch (e) {
				return { error: e.message };
			}
		},
	};
};
