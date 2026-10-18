// The plain projection of a state that sync engines store and send: JSON data where a component
// is { $: ref, ...fields }, its ref naming the scope it was made in and its name there.
import {
	AnyType,
	ArrayType,
	isComponent,
	isRecord,
	MapType,
	OptionType,
	RecordType,
	scopeOf,
	specOf,
	syncsAt,
	UnionType,
} from "../schema.js";

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
		out[key] = project(value[key], { level, type: child, leaf }, [...path, key]);
	}
	return out;
};

// The state plain projects: components made through their scopes with their fields, so the
// fields the projection lacks take their defaults. scope is any scope of the tree.
export const hydrate = (plain, scope, type = ANY) => {
	const rootScope = rootOf(scope);
	const build = (v, t) => {
		if (v === null || typeof v !== "object") return v;
		if (Array.isArray(v)) {
			const n = narrow(t, v);
			return v.map((item) => build(item, n instanceof ArrayType ? n.valueType : ANY));
		}
		const component = componentOf(v, rootScope, t);
		if (component !== null) {
			const { spec, scope: s } = component;
			const args = {};
			for (const key in spec.fields) {
				if (Object.hasOwn(v, key)) args[key] = build(v[key], spec.fields[key]);
			}
			return spec.make(args, s);
		}
		const out = {};
		for (const key of Object.keys(v))
			out[key] = build(v[key], keyType(t, v, key, "none", rootScope));
		return out;
	};
	return build(plain, type);
};

// base with over's data on top: over wins, except inside the same component, where the fields
// over lacks (another level's) come from base.
export const overlay = (base, over) => {
	if (!isRef(base) || refOf(base) !== refOf(over)) return over;
	const out = { ...base };
	for (const key of Object.keys(over)) {
		out[key] = Object.hasOwn(base, key) ? overlay(base[key], over[key]) : over[key];
	}
	return out;
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
