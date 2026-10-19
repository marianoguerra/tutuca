// The plain projection of a state that sync engines store and send: JSON data where a component
// is { $: ref, ...fields }, its ref naming the scope it was made in and its name there.
import {
	AnyType,
	ArrayType,
	isComponent,
	isRecord,
	MapType,
	NoDefaultError,
	OptionType,
	RecordType,
	scopeOf,
	specOf,
	syncsAt,
	UnionType,
} from "../schema.js";
import { setOwn } from "./ops.js";

const ANY = new AnyType(null);
// The value at path in a plain value, undefined where it isn't there.
export const getIn = (value, path) => path.reduce((v, key) => v?.[key], value);
// The ref of a projected component; an engine may store it wrapped, as an object with val.
const refOf = (v) => {
	if (!isRecord(v)) return null;
	const ref = v.$;
	return typeof ref === "string" ? ref : typeof ref?.val === "string" ? ref.val : null;
};
export const isRef = (v) => refOf(v) !== null;
export const rootOf = (scope) => {
	while (scope.parent !== null) scope = scope.parent;
	return scope;
};
// A map or record type: its values' $ key is data, not a ref.
const holdsData = (type, v) => {
	const t = narrow(type, v);
	return t instanceof MapType || t instanceof RecordType;
};
// The spec and scope of a component value of type in either form, or null for plain data.
export const componentOf = (v, rootScope, type = ANY) => {
	if (isComponent(v)) return { spec: specOf(v), scope: scopeOf(v) };
	const ref = holdsData(type, v) ? null : refOf(v);
	if (ref === null) return null;
	const { scope, name } = rootScope.resolveRef(ref);
	const spec = scope.lookupByName(name);
	if (spec === null) throw new Error(`No component ${ref}`);
	return { spec, scope };
};
// The alternative of type that value takes: options and unions narrowed to it.
export const narrow = (type, value, scope) => {
	if (type instanceof OptionType)
		return value === null ? type : narrow(type.valueType, value, scope);
	if (type instanceof UnionType) {
		const alt = type.types.find((t) => t.isValid(value, scope));
		return alt === undefined ? ANY : narrow(alt, value, scope);
	}
	return type ?? ANY;
};
// The type of value[key] inside a value of type; null for a key the level doesn't see.
export const keyType = (type, value, key, level, rootScope) => {
	const component = componentOf(value, rootScope, type);
	const t = component === null ? narrow(type, value, null) : null;
	const child =
		component !== null
			? component.spec.fields[key]
			: t instanceof ArrayType || t instanceof MapType
				? t.valueType
				: t instanceof RecordType
					? t.shape[key]
					: ANY;
	if (child === undefined) return component === null ? ANY : null;
	return syncsAt(child, level) ? child : null;
};
// The keys of a record or component value the level sees, in declaration order.
export const keysOf = (value, level, rootScope, type = ANY) => {
	const component = componentOf(value, rootScope, type);
	if (component === null) return Object.keys(value);
	const { fields } = component.spec;
	return Object.keys(fields).filter((k) => syncsAt(fields[k], level));
};

const fail = (path, what) => {
	throw new Error(`can't sync ${what} at /${path.join("/")}`);
};
// The plain data of value, with the fields level sees. leaf maps each string with its type, so
// an engine can tell text from atomic strings.
export const project = (value, { level = "shared", type = ANY, leaf = null } = {}, path = []) => {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : fail(path, value);
	if (typeof value === "string") return leaf === null ? value : leaf(value, narrow(type, value));
	if (Array.isArray(value)) {
		const itemType = narrow(type, value) instanceof ArrayType ? narrow(type, value).valueType : ANY;
		return value.map((v, i) => project(v, { level, type: itemType, leaf }, [...path, i]));
	}
	if (typeof value !== "object") return fail(path, typeof value);
	const proto = Object.getPrototypeOf(value);
	const out = {};
	if (isComponent(value)) {
		const scope = scopeOf(value);
		if (scope === null) fail(path, `${specOf(value).name} made without a scope`);
		const ref = scope.refFor(specOf(value));
		out.$ = leaf === null ? ref : leaf(ref, ANY);
	} else if (proto !== Object.prototype && proto !== null) {
		return fail(path, `a ${proto.constructor?.name ?? "class"} instance`);
	} else if (Object.hasOwn(value, "$") && !holdsData(type, value)) {
		return fail(path, `a record with the reserved key $`);
	}
	const t = isComponent(value) ? null : narrow(type, value);
	const fields = isComponent(value) ? specOf(value).fields : null;
	for (const key of Object.keys(value)) {
		const child =
			fields !== null
				? fields[key]
				: t instanceof MapType
					? t.valueType
					: t instanceof RecordType
						? t.shape[key]
						: ANY;
		if (child === undefined || !syncsAt(child, level)) continue;
		setOwn(out, key, project(value[key], { level, type: child, leaf }, [...path, key]));
	}
	return out;
};

// value made to fit type where a container holds it, as applyFitting fits an op's value: one
// the type rejects takes its default; one without a default is left for its container's type.
const fitIn = (type, value, scope) => {
	if (type === ANY) return value;
	try {
		return type.make(value, scope, undefined);
	} catch (error) {
		if (error instanceof NoDefaultError) return value;
		throw error;
	}
};
// The state plain projects: components made through their scopes with their fields, so the
// fields the projection lacks take their defaults, and the values their types reject inside
// arrays, maps and records take theirs. scope is any scope of the tree.
export const hydrate = (plain, scope, type = ANY) => {
	const rootScope = rootOf(scope);
	const build = (v, t, s) => {
		if (v === null || typeof v !== "object") return v;
		if (Array.isArray(v)) {
			const n = narrow(t, v);
			const itemType = n instanceof ArrayType ? n.valueType : ANY;
			return v.map((item) => fitIn(itemType, build(item, itemType, s), s));
		}
		const component = componentOf(v, rootScope, t);
		if (component !== null) {
			const { spec, scope: own } = component;
			const args = {};
			for (const key in spec.fields) {
				if (Object.hasOwn(v, key)) args[key] = build(v[key], spec.fields[key], own);
			}
			return spec.make(args, own);
		}
		const out = {};
		for (const key of Object.keys(v)) {
			const child = keyType(t, v, key, "none", rootScope) ?? ANY;
			setOwn(out, key, fitIn(child, build(v[key], child, s), s));
		}
		return out;
	};
	return build(plain, type, scope);
};

// base, a projection at another level, with over's data on top: over, at level, wins, but the
// fields level doesn't see (another level's) come from base, inside the same components, records
// and maps. An array keeps base's items under over's only when both hold the same refs at the
// same places; otherwise base's fields there are lost and take their defaults.
export const overlay = (base, over, scope, level = "shared") => {
	const rootScope = rootOf(scope);
	const merge = (b, o, type) => {
		if (Array.isArray(b) && Array.isArray(o)) {
			if (b.length !== o.length || b.some((item, i) => refOf(item) !== refOf(o[i]))) return o;
			return o.map((item, i) => merge(b[i], item, keyType(type, o, i, "none", rootScope)));
		}
		if (!isRecord(b) || !isRecord(o) || refOf(b) !== refOf(o)) return o;
		const out = {};
		for (const key of Object.keys(o)) {
			const t = keyType(type, o, key, "none", rootScope);
			setOwn(out, key, Object.hasOwn(b, key) && t !== null ? merge(b[key], o[key], t) : o[key]);
		}
		for (const key of Object.keys(b)) {
			if (Object.hasOwn(o, key)) continue;
			const t = keyType(type, b, key, "none", rootScope);
			if (t !== null && !syncsAt(t, level)) setOwn(out, key, b[key]);
		}
		return out;
	};
	return merge(base, over, ANY);
};

// The type and scope at path in root, a state or a projection, walking through components.
export const typeAt = (root, path, scope, level = "none") => {
	const rootScope = rootOf(scope);
	let type = ANY;
	let value = root;
	let at = scope;
	for (const key of path) {
		const component = componentOf(value, rootScope, type);
		if (component !== null) at = component.scope;
		type = keyType(type, value, key, level, rootScope) ?? ANY;
		value = value?.[key];
	}
	return { type, scope: at, value };
};
