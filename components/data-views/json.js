// JSON helpers: parsing JSON text (remembered, since getters parse the same
// text on every render) and a document as rows for an indented tree, pointed to by RFC 6901
// pointers.
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const clip = (s, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);

// fn(key) with its last size results kept, oldest dropped first.
const memo = (fn, size = 128) => {
	const cache = new Map();
	return (key) => {
		if (cache.has(key)) return cache.get(key);
		if (cache.size >= size) cache.delete(cache.keys().next().value);
		const value = fn(key);
		cache.set(key, value);
		return value;
	};
};

const parseText = memo((text) => {
	try {
		return { value: JSON.parse(text), error: "" };
	} catch (error) {
		return { value: undefined, error: error.message };
	}
}, 256);
// { value, error }: text parsed as JSON. Blank text is an error when emptyError says what to
// call it. The value is shared between callers: never mutate it.
export const parse = (text, { emptyError = "" } = {}) =>
	emptyError !== "" && text.trim() === ""
		? { value: undefined, error: emptyError }
		: parseText(text);

// A key as a pointer's reference token: ~ written ~0 and / written ~1.
const escapeToken = (key) => String(key).replace(/~/g, "~0").replace(/\//g, "~1");

// --- trees --------------------------------------------------------------------------------------

// value as one row per node, depth first: { pointer, depth, key, text, type, value }. rootKey
// names the root; quoteKeys writes object keys as JSON strings; at most max rows.
export const nodes = (
	value,
	{ rootKey = "$", quoteKeys = false, max = 1500, clipAt = 80 } = {},
) => {
	const out = [];
	const walk = (v, at, key, depth) => {
		if (out.length >= max) return;
		const type = typeOf(v);
		const n = type === "array" ? v.length : type === "object" ? Object.keys(v).length : 0;
		const shown =
			type === "array" ? `[${n} items]` : type === "object" ? `{${n} keys}` : JSON.stringify(v);
		out.push({ pointer: at, depth, key, text: clip(shown ?? "undefined", clipAt), type, value: v });
		if (type === "array")
			for (const [i, x] of v.entries()) walk(x, `${at}/${i}`, `${i}`, depth + 1);
		else if (type === "object") {
			for (const [k, x] of Object.entries(v))
				walk(x, `${at}/${escapeToken(k)}`, quoteKeys ? JSON.stringify(k) : k, depth + 1);
		}
	};
	walk(value, "", rootKey, 0);
	return out;
};
// The style of a tree row at depth.
export const indent = (depth, step = 1.25) => `padding-left: ${depth * step}rem`;
