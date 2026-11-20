// The types the checker works with: plain objects whose k says the kind, a closed set.
//
//   number string boolean null undefined unknown void never
//   lit      a string, number or boolean literal type: value
//   list     elem; tuple: elems; dict: value (string keys); record: name, fields, methods
//   union    types, normalized: flat, no duplicates, literals absorbed by their base
//   ref      a named host type, resolved by the registry (records refer to each other by name)
//   handle   a host object, nominal: name; only its fields and methods reach it
//   fn       a host function or method: sigs, its overloads; only ever called
//   module   a host namespace: name; only its members reach it
//   var      a type parameter of a signature: name
//
// Containers (list, tuple, dict, record) say whether the program may change them (mut) and
// whether that holds for what they contain too (deep): a draft is deep and mutable, a read
// value deep and immutable, a fresh literal mutable at its top and holding what it was given.

export const NUMBER = Object.freeze({ k: "number" });
export const STRING = Object.freeze({ k: "string" });
export const BOOLEAN = Object.freeze({ k: "boolean" });
export const NULL = Object.freeze({ k: "null" });
export const UNDEFINED = Object.freeze({ k: "undefined" });
export const UNKNOWN = Object.freeze({ k: "unknown" });
export const VOID = Object.freeze({ k: "void" });
export const NEVER = Object.freeze({ k: "never" });
const PRIMITIVES = {
	number: NUMBER,
	string: STRING,
	boolean: BOOLEAN,
	null: NULL,
	undefined: UNDEFINED,
	unknown: UNKNOWN,
	void: VOID,
	never: NEVER,
};
export const primitive = (name) => PRIMITIVES[name];

export const lit = (value) => ({ k: "lit", value });
export const list = (elem, mut = false, deep = true) => ({ k: "list", elem, mut, deep });
export const tuple = (elems, mut = false, deep = true) => ({ k: "tuple", elems, mut, deep });
export const dict = (value, mut = false, deep = true) => ({ k: "dict", value, mut, deep });
// fields: name -> { type, optional, readonly }; methods: name -> sigs.
export const record = (name, fields, methods = {}, mut = false, deep = true) => ({
	k: "record",
	name,
	fields,
	methods,
	mut,
	deep,
});
export const ref = (name, mut = false) => ({ k: "ref", name, mut });
export const handle = (name, fields = {}, methods = {}) => ({ k: "handle", name, fields, methods });
export const fn = (sigs) => ({ k: "fn", sigs });
export const moduleType = (name) => ({ k: "module", name });
export const tvar = (name) => ({ k: "var", name });
// A signature: typeParams (names), params ({ name, type, optional, rest }), result.
export const sig = (params, result, typeParams = []) => ({ typeParams, params, result });

const CONTAINERS = new Set(["list", "tuple", "dict", "record"]);
export const isContainer = (t) => CONTAINERS.has(t.k);

// t with mutability m, for it and (lazily, as they're reached) everything in it.
export const withMut = (t, m) => {
	if (CONTAINERS.has(t.k)) return { ...t, mut: m, deep: true };
	if (t.k === "ref") return { ...t, mut: m };
	if (t.k === "union") return union(t.types.map((u) => withMut(u, m)));
	return t;
};
const inner = (container, t) => (container.deep ? withMut(t, container.mut) : t);
export const elemOf = (t) => inner(t, t.elem);
export const tupleElemOf = (t, i) => inner(t, t.elems[i]);
export const dictValueOf = (t) => inner(t, t.value);
// The type a field reads as: its type, or undefined too when it's optional.
export const fieldTypeOf = (t, field) => {
	const ty = inner(t, field.type);
	return field.optional ? union([ty, UNDEFINED]) : ty;
};

// Unions.
const isLiteralOf = (l, base) => l.k === "lit" && typeof l.value === base.k;
export const union = (types) => {
	const flat = [];
	for (const t of types) {
		if (t.k === "union") flat.push(...t.types);
		else if (t.k !== "never") flat.push(t);
	}
	if (flat.some((t) => t.k === "unknown")) return UNKNOWN;
	const out = [];
	const keys = new Map();
	for (const t of flat) {
		const key = typeKey(t);
		const at = keys.get(key);
		if (at !== undefined) {
			// The same type twice: what may change only when both may.
			if (CONTAINERS.has(t.k) || t.k === "ref") out[at] = { ...out[at], mut: out[at].mut && t.mut };
			continue;
		}
		keys.set(key, out.length);
		out.push(t);
	}
	const bases = new Set(
		out.filter((t) => t.k === "number" || t.k === "string" || t.k === "boolean").map((t) => t.k),
	);
	let result = out.filter((t) => !(t.k === "lit" && bases.has(typeof t.value)));
	const hasTrue = result.some((t) => t.k === "lit" && t.value === true);
	const hasFalse = result.some((t) => t.k === "lit" && t.value === false);
	if (hasTrue && hasFalse) {
		result = result.filter((t) => !(t.k === "lit" && typeof t.value === "boolean"));
		result.push(BOOLEAN);
	}
	if (result.length === 0) return NEVER;
	if (result.length === 1) return result[0];
	return { k: "union", types: result };
};
export const members = (t) => (t.k === "union" ? t.types : t.k === "never" ? [] : [t]);
export const filterUnion = (t, keep) => union(members(t).filter(keep));

export const widen = (t) => {
	if (t.k === "lit") return PRIMITIVES[typeof t.value];
	if (t.k === "union") return union(t.types.map(widen));
	return t;
};
export const isNullish = (t) => t.k === "null" || t.k === "undefined" || t.k === "void";
export const hasNullish = (t) => members(t).some(isNullish);
export const removeNullish = (t) => filterUnion(t, (u) => !isNullish(u));
const isBooleanish = (t) =>
	members(t).every((u) => u.k === "boolean" || (u.k === "lit" && typeof u.value === "boolean"));
// A test (if, ?:, !, the left of && and ||) takes a boolean or a value that may be null or
// undefined, so that no number or string is converted to a boolean behind the program's back.
export const isTestable = (t) =>
	t.k === "never" || (t.k !== "unknown" && (isBooleanish(t) || hasNullish(t)));
export const isPrimitive = (t) =>
	members(t).every(
		(u) => u.k === "number" || u.k === "string" || u.k === "boolean" || u.k === "lit",
	);
export const isNumberish = (t) =>
	members(t).every((u) => u.k === "number" || (u.k === "lit" && typeof u.value === "number"));
export const isStringish = (t) =>
	members(t).every((u) => u.k === "string" || (u.k === "lit" && typeof u.value === "string"));

// What a value of type t can be falsy as, and what it is when it's truthy.
const canBeFalsy = (u) =>
	isNullish(u) ||
	u.k === "boolean" ||
	u.k === "number" ||
	u.k === "string" ||
	(u.k === "lit" && !u.value);
export const narrowTruthy = (t, sense) =>
	sense
		? filterUnion(t, (u) => !isNullish(u) && !(u.k === "lit" && !u.value))
		: filterUnion(t, canBeFalsy);

// typeof's answer for a type, or null when it may be several.
const typeofTag = (u) => {
	switch (u.k) {
		case "number":
		case "string":
		case "boolean":
		case "undefined":
			return u.k;
		case "void":
			return "undefined";
		case "lit":
			return typeof u.value;
		case "null":
		case "list":
		case "tuple":
		case "dict":
		case "record":
		case "ref":
		case "handle":
			return "object";
		case "fn":
			return "function";
		default:
			return null;
	}
};
export const narrowTypeof = (t, tag, sense) => {
	if (t.k === "unknown") {
		if (!sense) return t;
		if (tag === "string") return STRING;
		if (tag === "number") return NUMBER;
		if (tag === "boolean") return BOOLEAN;
		if (tag === "undefined") return UNDEFINED;
		return t;
	}
	return filterUnion(t, (u) => {
		const ut = typeofTag(u);
		if (ut === null) return true;
		return sense ? ut === tag : ut !== tag;
	});
};
// x === v and x !== v, for v a literal, null or undefined.
export const narrowEquals = (t, v, sense) => {
	if (t.k === "unknown") return sense ? v : t;
	if (sense) {
		return filterUnion(
			union(
				members(t).map((u) => {
					if (v.k === "lit" && u.k === typeof v.value) return v;
					return u;
				}),
			),
			(u) => typeKey(u) === typeKey(v) || (u.k === "void" && v.k === "undefined"),
		);
	}
	return filterUnion(
		t,
		(u) => !(typeKey(u) === typeKey(v) || (u.k === "void" && v.k === "undefined")),
	);
};

// A short text that is the same for types that are the same (mutability aside).
const typeKey = (t) => typeToString(t);

const needsParens = (t) => t.k === "union" || t.k === "fn";
export const sigToString = (s, arrow = true) => {
	const tp = s.typeParams.length > 0 ? `<${s.typeParams.join(", ")}>` : "";
	const params = s.params
		.map((p) => `${p.rest ? "..." : ""}${p.name}${p.optional ? "?" : ""}: ${typeToString(p.type)}`)
		.join(", ");
	return `${tp}(${params})${arrow ? " =>" : ":"} ${typeToString(s.result)}`;
};
export const typeToString = (t) => {
	switch (t.k) {
		case "lit":
			return typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
		case "list": {
			const e = typeToString(t.elem);
			return needsParens(t.elem) ? `(${e})[]` : `${e}[]`;
		}
		case "tuple":
			return `[${t.elems.map(typeToString).join(", ")}]`;
		case "dict":
			return `{ [key: string]: ${typeToString(t.value)} }`;
		case "record": {
			if (t.name !== null) return t.name;
			const fields = Object.entries(t.fields).map(
				([n, f]) =>
					`${f.readonly ? "readonly " : ""}${n}${f.optional ? "?" : ""}: ${typeToString(f.type)}`,
			);
			const methods = Object.entries(t.methods).flatMap(([n, sigs]) =>
				sigs.map((s) => `${n}${sigToString(s, false)}`),
			);
			const all = [...fields, ...methods];
			return all.length === 0 ? "{}" : `{ ${all.join("; ")} }`;
		}
		case "union":
			return t.types.map(typeToString).join(" | ");
		case "ref":
		case "handle":
		case "var":
			return t.name;
		case "fn":
			return t.sigs.map((s) => sigToString(s)).join(" & ");
		case "module":
			return `the module ${t.name}`;
		default:
			return t.k;
	}
};

// Type parameters replaced by what they are bound to (unknown when they aren't).
export const subst = (t, bindings) => {
	switch (t.k) {
		case "var":
			return bindings.get(t.name) ?? t;
		case "list":
			return { ...t, elem: subst(t.elem, bindings) };
		case "tuple":
			return { ...t, elems: t.elems.map((e) => subst(e, bindings)) };
		case "dict":
			return { ...t, value: subst(t.value, bindings) };
		case "union":
			return union(t.types.map((u) => subst(u, bindings)));
		case "record": {
			if (t.name !== null) return t;
			const fields = {};
			for (const [n, f] of Object.entries(t.fields))
				fields[n] = { ...f, type: subst(f.type, bindings) };
			return { ...t, fields };
		}
		case "fn":
			return { ...t, sigs: t.sigs.map((s) => substSig(s, bindings)) };
		default:
			return t;
	}
};
// t with the type parameters nothing bound replaced by unknown.
export const ground = (t) => subst(t, { get: () => UNKNOWN });
const substSig = (s, bindings) => ({
	typeParams: s.typeParams.filter((p) => bindings.get(p) === undefined),
	params: s.params.map((p) => ({ ...p, type: subst(p.type, bindings) })),
	result: subst(s.result, bindings),
});
export const hasVars = (t) => {
	switch (t.k) {
		case "var":
			return true;
		case "list":
			return hasVars(t.elem);
		case "tuple":
			return t.elems.some(hasVars);
		case "dict":
			return hasVars(t.value);
		case "union":
			return t.types.some(hasVars);
		case "fn":
			return t.sigs.some((s) => s.params.some((p) => hasVars(p.type)) || hasVars(s.result));
		default:
			return false;
	}
};

// Assignability: whether a value of type s may go where t is expected. Mutability is not part
// of it: a value is a value; what may change is decided at the place that changes it.
// registry resolves refs; bindings, when given, binds type parameters of t as it goes.
export class Relation {
	constructor(registry, bindings = null) {
		this.registry = registry;
		this.bindings = bindings;
		this.assuming = new Set();
	}
	resolve(t0) {
		let t = t0;
		while (t.k === "ref") t = this.registry.resolve(t);
		return t;
	}
	assignable(s0, t0) {
		const s = this.resolve(s0);
		const t = this.resolve(t0);
		if (t.k === "var") {
			if (this.bindings === null) return s.k === "var" && s.name === t.name;
			const bound = this.bindings.get(t.name);
			if (bound === undefined) {
				this.bindings.set(t.name, widen(s));
				return true;
			}
			if (this.assignable(s, bound)) return true;
			// A later argument may widen what an earlier one bound: [] then [1].
			if (this.assignable(bound, widen(s))) {
				this.bindings.set(t.name, widen(s));
				return true;
			}
			return false;
		}
		if (s.k === "never") return true;
		if (t.k === "unknown")
			return s.k !== "handle" && s.k !== "fn" && s.k !== "module" && s.k !== "void";
		if (s.k === "union") return s.types.every((u) => this.assignable(u, t));
		if (t.k === "union") return t.types.some((u) => this.assignable(s, u));
		switch (t.k) {
			case "number":
			case "string":
			case "boolean":
				return s.k === t.k || isLiteralOf(s, t);
			case "null":
			case "undefined":
				return s.k === t.k;
			case "void":
				return s.k === "void" || s.k === "undefined";
			case "lit":
				return s.k === "lit" && s.value === t.value;
			case "list":
				if (s.k === "list") return this.assignable(elemOf(s), elemOf(t));
				if (s.k === "tuple")
					return s.elems.every((_, i) => this.assignable(tupleElemOf(s, i), elemOf(t)));
				return false;
			case "tuple":
				return (
					s.k === "tuple" &&
					s.elems.length === t.elems.length &&
					s.elems.every((_, i) => this.assignable(tupleElemOf(s, i), tupleElemOf(t, i)))
				);
			case "dict":
				if (s.k === "dict") return this.assignable(dictValueOf(s), dictValueOf(t));
				if (s.k === "record")
					return (
						Object.keys(s.methods).length === 0 &&
						Object.values(s.fields).every((f) => this.assignable(fieldTypeOf(s, f), dictValueOf(t)))
					);
				return false;
			case "record":
				return s.k === "record" && this.recordAssignable(s, t);
			case "handle":
				return s.k === "handle" && s.name === t.name;
			default:
				return false;
		}
	}
	recordAssignable(s, t) {
		if (s.name !== null && s.name === t.name) return true;
		const key = `${typeKey(s)}<:${typeKey(t)}`;
		if (this.assuming.has(key)) return true;
		this.assuming.add(key);
		try {
			for (const [name, tf] of Object.entries(t.fields)) {
				const sf = s.fields[name];
				if (sf === undefined) {
					if (!tf.optional) return false;
					continue;
				}
				if (sf.optional && !tf.optional) return false;
				if (!this.assignable(fieldTypeOf(s, sf), fieldTypeOf(t, tf))) return false;
			}
			for (const name of Object.keys(t.methods)) if (s.methods[name] === undefined) return false;
			return true;
		} finally {
			this.assuming.delete(key);
		}
	}
	// t with what its references name followed, through unions: an alias of a union (type T =
	// "a" | "b") is its members, as a comparison sees them.
	expand(t, seen = new Set()) {
		return union(
			members(t).flatMap((m) => {
				if (m.k !== "ref" || seen.has(m.name)) return [m];
				const r = this.resolve(m);
				return r.k === "union" ? members(this.expand(r, new Set([...seen, m.name]))) : [r];
			}),
		);
	}
	// Whether === between the two can ever be true: TypeScript rejects a comparison that can't.
	comparable(a0, b0) {
		const a = this.expand(a0);
		const b = this.expand(b0);
		if (
			hasNullish(a) ||
			hasNullish(b) ||
			a.k === "unknown" ||
			b.k === "unknown" ||
			a.k === "never" ||
			b.k === "never"
		)
			return true;
		return members(a).some((x) =>
			members(b).some((y) => this.overlap(this.resolve(x), this.resolve(y))),
		);
	}
	overlap(x, y) {
		if (x.k === "lit" && y.k === "lit") return x.value === y.value;
		if (x.k === "lit") return typeof x.value === y.k;
		if (y.k === "lit") return typeof y.value === x.k;
		return this.assignable(x, y) || this.assignable(y, x);
	}
}
