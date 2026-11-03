// Host functions for json-schema-lab: JSON Schema 2020-12 validation with Ajv
// (Ajv2020, allErrors, not strict, ajv-formats' formats), and RFC 6901
// pointers set or removed in a JSON value (to patch a schema).
//
//   json_schema_error(schema)                   "" or why the schema doesn't compile
//   json_schema_validate(schema, value)         { valid, errors: [{ instancePath, keyword, message }] };
//                                               throws when the schema doesn't compile
//   json_schema_pointer_set(doc, pointer, value)
//                                               doc with value at pointer; throws why it can't be
//   json_schema_pointer_remove(doc, pointer)    doc without what pointer names; throws why it can't be
export const bundle = "ajv";

// --- pointers (RFC 6901) ---------------------------------------------------------------

const INDEX = /^(0|[1-9]\d*)$/;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const escapeToken = (key) => String(key).replace(/~/g, "~0").replace(/\//g, "~1");
const format = (tokens) => tokens.map((t) => `/${escapeToken(t)}`).join("");
const parsePointer = (pointer) => {
	if (pointer === "") return { tokens: [] };
	if (!pointer.startsWith("/")) return { error: 'a pointer is "" or starts with "/"' };
	const tokens = [];
	for (const [i, raw] of pointer.slice(1).split("/").entries()) {
		if (/~([^01]|$)/.test(raw)) return { error: `segment ${i + 1} ("${raw}") has a ~ that isn't ~0 (for ~) or ~1 (for /)` };
		tokens.push(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
	}
	return { tokens };
};

// doc changed at pointer by change(parent, key) on a copy; throws why it can't be. The parent
// must exist: a pointer doesn't make the objects on its way, and the error says which one to
// set whole instead.
const changeAt = (doc, pointer, change, removing) => {
	const { tokens, error } = parsePointer(pointer);
	if (error) throw new Error(error);
	const verb = removing ? "remove" : "set";
	const root = structuredClone(doc);
	let at = root;
	for (const [i, token] of tokens.slice(0, -1).entries()) {
		const where = format(tokens.slice(0, i)) || "the document";
		const missing = format(tokens.slice(0, i + 1));
		const inside = JSON.stringify(tokens.slice(i + 1).join("/"));
		const items = (n) => `${n} item${n === 1 ? "" : "s"}`;
		if (Array.isArray(at)) {
			if (!INDEX.test(token) || Number(token) >= at.length)
				throw new Error(`${where} is an array of ${items(at.length)}, with no item ${JSON.stringify(token)}${removing ? ": there is nothing to remove" : ` to set ${inside} inside`}`);
			at = at[Number(token)];
		} else if (isObject(at)) {
			if (!Object.hasOwn(at, token))
				throw new Error(
					removing
						? `${where} has no key ${JSON.stringify(token)}: there is nothing to remove`
						: `${where} has no key ${JSON.stringify(token)}, and a pointer doesn't make the objects on its way: set ${missing} to the whole object (or array) holding ${inside} instead`,
				);
			at = at[token];
		} else {
			throw new Error(`${where} is a ${typeOf(at)}, not an object or an array: there is nothing inside it to ${verb}`);
		}
	}
	if (at === null || typeof at !== "object") {
		const where = format(tokens.slice(0, -1)) || "the document";
		throw new Error(`${where} is a ${typeOf(at)}, not an object or an array: there is nothing inside it to ${verb}`);
	}
	const failed = change(at, tokens.at(-1));
	if (failed) throw new Error(failed);
	return root;
};

const pointerSet = (doc, pointer, value) =>
	pointer === ""
		? value
		: changeAt(doc, pointer, (parent, key) => {
				if (Array.isArray(parent)) {
					const n = key === "-" ? parent.length : INDEX.test(key) ? Number(key) : -1;
					if (n < 0 || n > parent.length) return `${JSON.stringify(key)} isn't an index of the array (it has ${parent.length} items)`;
					parent[n] = value;
				} else parent[key] = value;
				return "";
			});

const pointerRemove = (doc, pointer) => {
	if (pointer === "") throw new Error("the empty pointer is the whole document");
	return changeAt(
		doc,
		pointer,
		(parent, key) => {
			if (!Object.hasOwn(parent, key) || (Array.isArray(parent) && !INDEX.test(key))) return `there is no ${JSON.stringify(key)} to remove`;
			if (Array.isArray(parent)) parent.splice(Number(key), 1);
			else delete parent[key];
			return "";
		},
		true,
	);
};

// --- validation ------------------------------------------------------------------------

export const make = ({ Ajv2020, addFormats }) => {
	// { validate, error } by the schema's JSON text: a fresh Ajv each (a schema's $id may only
	// be added once to an Ajv).
	const cache = new Map();
	const compile = (schema) => {
		const key = JSON.stringify(schema) ?? "null";
		if (!cache.has(key)) {
			if (cache.size > 32) cache.clear();
			try {
				const ajv = new Ajv2020({ allErrors: true, strict: false });
				addFormats(ajv);
				cache.set(key, { validate: ajv.compile(schema), error: "" });
			} catch (error) {
				cache.set(key, { validate: null, error: error.message });
			}
		}
		return cache.get(key);
	};
	return {
		json_schema_error: (schema) => compile(schema).error,
		json_schema_validate: (schema, value) => {
			const { validate, error } = compile(schema);
			if (validate === null) throw new Error(error);
			const valid = validate(value);
			const errors = (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({ instancePath, keyword, message: message ?? "" }));
			return { valid, errors };
		},
		json_schema_pointer_set: (doc, pointer, value) => pointerSet(doc, pointer, value),
		json_schema_pointer_remove: (doc, pointer) => pointerRemove(doc, pointer),
	};
};
