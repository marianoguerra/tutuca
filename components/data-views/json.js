// JSON helpers: parsing JSON text (remembered, since getters parse the same
// text on every render), pointers (RFC 6901) and a document as rows for an indented tree.
export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
export const pretty = (value) => JSON.stringify(value, null, 2);
export const clip = (s, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);
export const preview = (v, n = 80) => clip(JSON.stringify(v) ?? "undefined", n);
// "object" or "array" when v is a string holding JSON text for one (a model sending a value
// encoded as a string), else "".
export const jsonTextKind = (v) => {
	if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return "";
	try {
		const value = JSON.parse(v);
		return Array.isArray(value) ? "array" : isObject(value) ? "object" : "";
	} catch {
		return "";
	}
};

// fn(key) with its last size results kept, oldest dropped first.
export const memo = (fn, size = 128) => {
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

// parse, with a value of its own: for values kept in state or changed.
export const parseFresh = (text, options) => {
	const r = parse(text, options);
	return r.error === "" ? { value: structuredClone(r.value), error: "" } : r;
};

// --- pointers (RFC 6901) ------------------------------------------------------------------------

// A key as a reference token: ~ written ~0 and / written ~1.
export const escapeToken = (key) => String(key).replace(/~/g, "~0").replace(/\//g, "~1");
export const format = (tokens) => tokens.map((t) => `/${escapeToken(t)}`).join("");
// { tokens } or { error, segment } (segment counts from 1; 0 is the pointer as a whole).
export const parsePointer = (pointer) => {
	if (pointer === "") return { tokens: [] };
	if (!pointer.startsWith("/")) return { error: 'a pointer is "" or starts with "/"', segment: 0 };
	const tokens = [];
	for (const [i, raw] of pointer.slice(1).split("/").entries()) {
		if (/~([^01]|$)/.test(raw)) {
			return {
				error: `segment ${i + 1} ("${raw}") has a ~ that isn't ~0 (for ~) or ~1 (for /)`,
				segment: i + 1,
				tokens,
			};
		}
		tokens.push(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
	}
	return { tokens };
};
const INDEX = /^(0|[1-9]\d*)$/;

// Where pointer leads in doc: { resolves: true, tokens, value } or { resolves: false, tokens,
// segment, reason }, the reason saying what is there instead.
export const resolve = (doc, pointer) => {
	const parsed = parsePointer(pointer);
	if (parsed.error)
		return {
			resolves: false,
			tokens: parsed.tokens ?? [],
			segment: parsed.segment,
			reason: parsed.error,
		};
	const { tokens } = parsed;
	let at = doc;
	for (const [i, token] of tokens.entries()) {
		const fail = (reason) => ({
			resolves: false,
			tokens,
			segment: i + 1,
			reason: `segment ${i + 1}: ${reason}`,
		});
		if (Array.isArray(at)) {
			if (token === "-") return fail(`"-" names the item after the last one, which doesn't exist`);
			if (!INDEX.test(token))
				return fail(`"${token}" isn't an array index (the array has ${at.length} items)`);
			if (Number(token) >= at.length)
				return fail(`index ${token} is out of range (the array has ${at.length} items)`);
			at = at[Number(token)];
		} else if (isObject(at)) {
			if (!Object.hasOwn(at, token)) {
				const keys = Object.keys(at);
				const some = keys.slice(0, 8).map((k) => JSON.stringify(k));
				return fail(
					`the object has no key ${JSON.stringify(token)} (its keys: ${some.join(", ")}${keys.length > 8 ? ", …" : ""})`,
				);
			}
			at = at[token];
		} else return fail(`can't look up ${JSON.stringify(token)} in a ${typeOf(at)}`);
	}
	return { resolves: true, tokens, value: at };
};

// doc changed at pointer by change(parent, key) on a copy: { value } or { error }. The parent
// must exist: a pointer doesn't make the objects on its way, and the error says which one to set
// whole instead.
const changeAt = (doc, pointer, change, { removing = false } = {}) => {
	const { tokens, error } = parsePointer(pointer);
	if (error) return { error };
	const root = structuredClone(doc);
	let at = root;
	for (const [i, token] of tokens.slice(0, -1).entries()) {
		const where = format(tokens.slice(0, i)) || "the document";
		const missing = format(tokens.slice(0, i + 1));
		const inside = JSON.stringify(tokens.slice(i + 1).join("/"));
		const items = (n) => `${n} item${n === 1 ? "" : "s"}`;
		if (Array.isArray(at)) {
			if (!INDEX.test(token) || Number(token) >= at.length)
				return {
					error: `${where} is an array of ${items(at.length)}, with no item ${JSON.stringify(token)}${removing ? ": there is nothing to remove" : ` to set ${inside} inside`}`,
				};
			at = at[Number(token)];
		} else if (isObject(at)) {
			if (!Object.hasOwn(at, token))
				return {
					error: removing
						? `${where} has no key ${JSON.stringify(token)}: there is nothing to remove`
						: `${where} has no key ${JSON.stringify(token)}, and a pointer doesn't make the objects on its way: set ${missing} to the whole object (or array) holding ${inside} instead`,
				};
			at = at[token];
		} else {
			return {
				error: `${where} is a ${typeOf(at)}, not an object or an array: there is nothing inside it to ${removing ? "remove" : "set"}`,
			};
		}
	}
	if (at === null || typeof at !== "object") {
		const where = format(tokens.slice(0, -1)) || "the document";
		return {
			error: `${where} is a ${typeOf(at)}, not an object or an array: there is nothing inside it to ${removing ? "remove" : "set"}`,
		};
	}
	const failed = change(at, tokens.at(-1));
	return failed ? { error: failed } : { value: root };
};
// doc with value at pointer: { value } or { error }. In an array the last token is an index up
// to its length, or "-" to append. The empty pointer replaces the whole document.
export const set = (doc, pointer, value) =>
	pointer === ""
		? { value }
		: changeAt(doc, pointer, (parent, key) => {
				if (Array.isArray(parent)) {
					const n = key === "-" ? parent.length : INDEX.test(key) ? Number(key) : -1;
					if (n < 0 || n > parent.length)
						return `${JSON.stringify(key)} isn't an index of the array (it has ${parent.length} items)`;
					parent[n] = value;
				} else parent[key] = value;
				return "";
			});
// doc without what pointer names: { value } or { error }.
export const remove = (doc, pointer) =>
	pointer === ""
		? { error: "the empty pointer is the whole document" }
		: changeAt(
				doc,
				pointer,
				(parent, key) => {
					if (!Object.hasOwn(parent, key) || (Array.isArray(parent) && !INDEX.test(key)))
						return `there is no ${JSON.stringify(key)} to remove`;
					if (Array.isArray(parent)) parent.splice(Number(key), 1);
					else delete parent[key];
					return "";
				},
				{ removing: true },
			);

export const pointer = { escape: escapeToken, format, parse: parsePointer, resolve, set, remove };

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
