// Field types: written as data, compiled into Type objects. A type is a kind's name ("string")
// or a record of its kind and options ({ type: "number", int: true, min: 0, default: 1 }), plain
// data a component, an interface or a meta schema says and tools read; t's builders write the
// same data, checked as it's written. compileType makes the Type a component runs with, once:
// each kind its class, constraints their checks, named checks the functions they name.
// Component specs are in ../component.js, their contracts in contract.js.
import { isComponent, specOf } from "./spec.js";

export const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// How far a field's state goes, from most to least: replicated and persisted, persisted on this
// device only, neither. A sync engine sees the fields up to its level.
export const SYNC_LEVELS = ["shared", "local", "none"];
export const syncsAt = (type, level) =>
	SYNC_LEVELS.indexOf(type.syncLevel) <= SYNC_LEVELS.indexOf(level);

// The options each kind takes besides the ones every kind takes (COMMON): what its values hold,
// then its constraints.
const KIND_OPTIONS = {
	any: [],
	string: ["minLength", "maxLength", "pattern"],
	boolean: [],
	number: ["int", "min", "max"],
	enum: ["values"],
	option: ["of"],
	array: ["of", "minLength", "maxLength"],
	map: ["of", "minLength", "maxLength"],
	record: ["fields"],
	oneOf: ["of"],
	index: ["keyOf"],
	component: ["of"],
};
export const TYPE_KINDS = Object.freeze(Object.keys(KIND_OPTIONS));
const COMMON = ["type", "default", "sync", "public", "check"];
// Each option's value, as a check of v and the words for what it must be. of and fields hold
// types, checked as they're read.
const isNames = (v) =>
	typeof v === "string" || (Array.isArray(v) && v.every((n) => typeof n === "string"));
const OPTION_VALUES = {
	sync: [(v) => SYNC_LEVELS.includes(v), `one of ${SYNC_LEVELS.join(", ")}`],
	public: [(v) => v === true, "true"],
	check: [isNames, "a check's name or an array of names"],
	int: [(v) => v === true, "true"],
	min: [(v) => typeof v === "number" && !Number.isNaN(v), "a number"],
	max: [(v) => typeof v === "number" && !Number.isNaN(v), "a number"],
	minLength: [(v) => Number.isInteger(v) && v >= 0, "an integer, 0 or more"],
	maxLength: [(v) => Number.isInteger(v) && v >= 0, "an integer, 0 or more"],
	pattern: [(v) => typeof v === "string" && isRegExpSource(v), "a regular expression's source"],
	values: [(v) => Array.isArray(v) && v.length > 0, "a non-empty array of the values it takes"],
	keyOf: [(v) => typeof v === "string" && v !== "", "the name of an array or map field"],
};
const isRegExpSource = (s) => {
	try {
		new RegExp(s);
		return true;
	} catch {
		return false;
	}
};
// What's wrong with data as a type, each problem at the path in it (a field of a record, an
// option's type): [] when nothing is.
export const typeProblems = (data, at = "") => {
	const where = at === "" ? "" : `${at}: `;
	if (typeof data === "string") {
		return Object.hasOwn(KIND_OPTIONS, data)
			? []
			: [`${where}"${data}" isn't a type's kind (${TYPE_KINDS.join(", ")})`];
	}
	if (!isRecord(data)) {
		const what = typeof data === "function" ? "a function" : (JSON.stringify(data) ?? String(data));
		return [`${where}a type is a kind's name or { type: kind, ... }, not ${what}`];
	}
	const { type: kind } = data;
	if (!Object.hasOwn(KIND_OPTIONS, kind)) {
		return [`${where}type ${JSON.stringify(kind)} isn't a kind (${TYPE_KINDS.join(", ")})`];
	}
	const problems = [];
	const allowed = [...COMMON, ...KIND_OPTIONS[kind]];
	for (const key of Object.keys(data)) {
		if (!allowed.includes(key)) {
			const takes = KIND_OPTIONS[kind].length === 0 ? "" : `: ${KIND_OPTIONS[kind].join(", ")}`;
			problems.push(
				`${where}a ${kind} doesn't take ${key} (its options${takes}, and ${COMMON.slice(1).join(", ")})`,
			);
			continue;
		}
		const rule = OPTION_VALUES[key];
		if (rule !== undefined && !rule[0](data[key])) {
			problems.push(
				`${where}${kind}'s ${key} must be ${rule[1]}, not ${JSON.stringify(data[key])}`,
			);
		}
	}
	const inner = (sub, name) =>
		problems.push(...typeProblems(sub, at === "" ? name : `${at}.${name}`));
	if (kind === "option" || kind === "array" || kind === "map") {
		if (data.of !== undefined) inner(data.of, "of");
	} else if (kind === "oneOf") {
		if (!Array.isArray(data.of) || data.of.length === 0)
			problems.push(`${where}a oneOf's of must be a non-empty array of types`);
		else for (const [i, sub] of data.of.entries()) inner(sub, `of[${i}]`);
	} else if (kind === "record") {
		if (!isRecord(data.fields)) problems.push(`${where}a record's fields must map names to types`);
		else for (const [k, sub] of Object.entries(data.fields)) inner(sub, k);
	} else if (kind === "enum" && data.values === undefined) {
		problems.push(`${where}an enum needs values, the values it takes`);
	} else if (kind === "index" && data.keyOf === undefined) {
		problems.push(`${where}an index needs keyOf, the array or map field its keys are of`);
	} else if (kind === "component" && data.of !== undefined && !isNames(data.of)) {
		problems.push(
			`${where}a component's of must be a component or interface name, or an array of them`,
		);
	}
	return problems;
};
// data, checked: a TypeError naming each problem when it isn't a type.
export const checkType = (data, at = "") => {
	const problems = typeProblems(data, at);
	if (problems.length > 0) throw new TypeError(`Not a type: ${problems.join("; ")}`);
	return data;
};
const deepFreeze = (v) => {
	if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
		Object.freeze(v);
		for (const k of Object.keys(v)) deepFreeze(v[k]);
	}
	return v;
};
// t's builders: each writes a kind's type as data, checked, frozen. The kinds that hold types
// take them first, then the options: t.array(t.string(), { minLength: 1 }).
const build = (kind, holds) => (data) => deepFreeze(checkType({ type: kind, ...holds, ...data }));
const scalar =
	(kind) =>
	(options = {}) =>
		build(kind, {})(options);
export const t = {
	any: scalar("any"),
	string: scalar("string"),
	boolean: scalar("boolean"),
	number: scalar("number"),
	// A number with int: true.
	int: (options = {}) => build("number", { int: true })(options),
	enum: (values, options = {}) => build("enum", { values })(options),
	option: (of, options = {}) => build("option", { of })(options),
	array: (of = "any", options = {}) => build("array", { of })(options),
	map: (of = "any", options = {}) => build("map", { of })(options),
	record: (fields, options = {}) => build("record", { fields })(options),
	oneOf: (of, options = {}) => build("oneOf", { of })(options),
	index: (keyOf, options = {}) => build("index", { keyOf })(options),
	component: (of, options = {}) => build("component", of === undefined ? {} : { of })(options),
};

// make throws it for state it can't default: a missing value, not a bug in the component.
export class NoDefaultError extends Error {}
// error with prefix before its message, so nested failures read as a path (Root.child: Child.item:
// ...); still a NoDefaultError if it was one.
export const prefixed = (prefix, error) => {
	const Wrapped = error instanceof NoDefaultError ? NoDefaultError : Error;
	return new Wrapped(`${prefix}: ${error.message}`, { cause: error });
};
// What make() returns, or what otherwise() does when it throws a NoDefaultError.
export const unlessNoDefault = (make, otherwise) => {
	try {
		return make();
	} catch (error) {
		if (error instanceof NoDefaultError) return otherwise(error);
		throw error;
	}
};

const lengthOf = (v) =>
	typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length : v.length;
// Constraints narrow a type; each one checks values that already have the right kind. check
// holds the named checks it runs, { name, test, description }.
const CHECKS = {
	int: (v) => Number.isInteger(v),
	min: (v, min) => v >= min,
	max: (v, max) => v <= max,
	minLength: (v, n) => lengthOf(v) >= n,
	maxLength: (v, n) => lengthOf(v) <= n,
	pattern: (v, re) => re.test(v),
	check: (v, checks) => checks.every(({ test }) => test(v)),
};
// What every compiled type shares: its data, a default, constraints, a generator and a sync
// level, and make/isValid. Each kind's class extends it; its static kind is the data's type.
export class Type {
	constructor(defaultValue) {
		this.data = null; // What it was compiled from, normalized: what tools print and compare.
		this.defaultValue = defaultValue;
		this.constraints = {};
		this.generator = undefined; // (fc, A) => arbitrary, a named check's, for pbt.js.
		this.syncLevel = "shared";
		this.isPublic = false; // A public field is also a read-only query of the same name.
	}
	// The type as data, as text (typeText), for modules that can't import this one.
	text() {
		return typeText(this);
	}
	children() {
		return [];
	}
	// owner is the component holding the field, for types that depend on its other fields.
	// A default that breaks the constraints, like [] for minLength: 1, makes the field required.
	make(value, scope, owner) {
		if (this.isValid(value, scope, owner)) return value;
		const made = this.makeDefault(scope, owner);
		if (!this.meetsConstraints(made))
			throw new NoDefaultError("has no default that meets its constraints");
		return made;
	}
	makeDefault(_scope, _owner) {
		const v = this.defaultValue; // Copy so instances don't share a mutable default.
		if (Array.isArray(v)) return [...v];
		return v !== null && typeof v === "object" ? { ...v } : v;
	}
	isValid(value, scope, owner) {
		if (value === undefined) return false; // Missing values take the default.
		return this.isValidValue(value, scope, owner) && this.meetsConstraints(value);
	}
	meetsConstraints(value) {
		for (const key in this.constraints) {
			if (!CHECKS[key](value, this.constraints[key])) return false;
		}
		return true;
	}
	isValidValue(_value, _scope, _owner) {
		return true;
	}
}
// Any value.
export class AnyType extends Type {
	static kind = "any";
	constructor() {
		super(null);
	}
}
export class StringType extends Type {
	static kind = "string";
	constructor() {
		super("");
	}
	isValidValue(value) {
		return typeof value === "string";
	}
}
export class BooleanType extends Type {
	static kind = "boolean";
	constructor() {
		super(false);
	}
	isValidValue(value) {
		return typeof value === "boolean";
	}
}
export class NumberType extends Type {
	static kind = "number";
	constructor() {
		super(0);
	}
	isValidValue(value) {
		return Number.isFinite(value);
	}
}
export class EnumType extends Type {
	static kind = "enum";
	constructor(members) {
		super(members[0]);
		this.members = members;
	}
	isValidValue(value) {
		return this.members.includes(value);
	}
}
// A type holding values of one inner type: an option, an array or a map.
class ContainerType extends Type {
	constructor(defaultValue, valueType) {
		super(defaultValue);
		this.valueType = valueType;
	}
	children() {
		return [this.valueType];
	}
}
// Null or a valid inner value; nullability is a type, not a flag on every type.
export class OptionType extends ContainerType {
	static kind = "option";
	constructor(valueType) {
		super(null, valueType);
	}
	isValidValue(value, scope, owner) {
		return value === null || this.valueType.isValid(value, scope, owner);
	}
}
export class ArrayType extends ContainerType {
	static kind = "array";
	constructor(valueType) {
		super([], valueType);
	}
	isValidValue(value, scope, owner) {
		return Array.isArray(value) && value.every((v) => this.valueType.isValid(v, scope, owner));
	}
}
// A record with arbitrary string keys and values of one type.
export class MapType extends ContainerType {
	static kind = "map";
	constructor(valueType) {
		super({}, valueType);
	}
	isValidValue(value, scope, owner) {
		return (
			isRecord(value) && Object.values(value).every((v) => this.valueType.isValid(v, scope, owner))
		);
	}
}
// A record with exactly the keys of shape, each of its own type.
export class RecordType extends Type {
	static kind = "record";
	constructor(shape) {
		super(undefined); // Undefined builds the default from the shape's defaults.
		this.shape = shape;
	}
	children() {
		return Object.values(this.shape);
	}
	// Each key is made like a field, so its default must meet its constraints too.
	makeDefault(scope, owner) {
		if (this.defaultValue !== undefined) return super.makeDefault(scope, owner);
		const entries = Object.entries(this.shape).map(([k, type]) => {
			try {
				return [k, type.make(undefined, scope, owner)];
			} catch (error) {
				throw prefixed(k, error);
			}
		});
		return Object.fromEntries(entries);
	}
	isValidValue(value, scope, owner) {
		if (!isRecord(value)) return false;
		if (Object.keys(value).some((k) => !Object.hasOwn(this.shape, k))) return false;
		return Object.entries(this.shape).every(([k, type]) => type.isValid(value[k], scope, owner));
	}
}
export class OneOfType extends Type {
	static kind = "oneOf";
	constructor(types) {
		super(undefined); // Undefined makes the first alternative with no value.
		this.types = types;
	}
	children() {
		return this.types;
	}
	makeDefault(scope, owner) {
		if (this.defaultValue !== undefined) return super.makeDefault(scope, owner);
		return this.types[0].make(undefined, scope, owner);
	}
	isValidValue(value, scope, owner) {
		return this.types.some((type) => type.isValid(value, scope, owner));
	}
}
// A key of the array or map in the owner's field, such as a selected index.
export class IndexType extends Type {
	static kind = "index";
	constructor(fieldName) {
		super(undefined);
		this.fieldName = fieldName;
	}
	keysIn(owner) {
		const items = owner?.[this.fieldName];
		if (Array.isArray(items)) return items.map((_, i) => i);
		return isRecord(items) ? Object.keys(items) : [];
	}
	makeDefault(_scope, owner) {
		const [first] = this.keysIn(owner);
		if (first === undefined) {
			throw new NoDefaultError(
				`${this.fieldName} has no key for a required index, make it an option`,
			);
		}
		return first;
	}
	// Without an owner only the kind of key is checked.
	isValidValue(value, _scope, owner) {
		if (owner === undefined) return Number.isInteger(value) || typeof value === "string";
		return this.keysIn(owner).includes(value);
	}
}
// A component registered under name, or one of names, in the scope the owner is made in, so
// a scope can swap it. A name the scope has an interface under takes any component
// implementing it. Without names any component is valid.
export class ComponentType extends Type {
	static kind = "component";
	constructor(names) {
		super(undefined);
		this.names = names;
	}
	get name() {
		return this.names[0];
	}
	makeDefault(scope) {
		if (this.name === undefined) {
			throw new NoDefaultError(
				"a required component with no name has no default, pass one or name it",
			);
		}
		if (scope === null) {
			throw new NoDefaultError(
				`no scope to make ${this.name} in, use scope.components to create it`,
			);
		}
		if (scope.lookupInterface(this.name) !== null) {
			throw new NoDefaultError(
				`${this.name} is an interface, so it has no default: pass a component`,
			);
		}
		return scope.make(this.name);
	}
	isValidValue(value, scope) {
		if (!isComponent(value)) return false;
		if (this.names.length === 0) return true;
		return this.names.some((name) => {
			if (scope === null) return true;
			const iface = scope.lookupInterface(name);
			if (iface !== null) return scope.implementsInterface(value, iface);
			return scope.lookupSpec(name) === specOf(value);
		});
	}
}
// The type an option wraps, or type itself.
export const unwrapOption = (type) =>
	type instanceof OptionType ? unwrapOption(type.valueType) : type;

// A check a type names: a function testing a value, or { test, arb, description }, arb being
// a pbt generator of values that pass ((fc, A) => arbitrary) and description words for an
// agent or an error. One with no test only says how pbt generates the type's values.
const checkOf = (name, checks) => {
	const c = checks?.[name];
	if (typeof c === "function") return { name, test: c, description: name, arb: undefined };
	if (isRecord(c) && (c.test === undefined || typeof c.test === "function")) {
		return { name, test: c.test ?? (() => true), description: c.description ?? name, arb: c.arb };
	}
	const known = Object.keys(checks ?? {});
	const has = known.length === 0 ? "there are none" : `there are ${known.join(", ")}`;
	throw new TypeError(
		`No check ${name}: checks has a function or { test, arb, description } for each name a type checks (${has})`,
	);
};
const CLASSES = {
	any: () => new AnyType(),
	string: () => new StringType(),
	boolean: () => new BooleanType(),
	number: () => new NumberType(),
	enum: (d) => new EnumType([...d.values]),
	option: (d, inner) => new OptionType(inner(d.of, "of")),
	array: (d, inner) => new ArrayType(inner(d.of ?? "any", "of")),
	map: (d, inner) => new MapType(inner(d.of ?? "any", "of")),
	record: (d, inner) =>
		new RecordType(Object.fromEntries(Object.entries(d.fields).map(([k, f]) => [k, inner(f, k)]))),
	oneOf: (d, inner) => new OneOfType(d.of.map((f, i) => inner(f, `of[${i}]`))),
	index: (d) => new IndexType(d.keyOf),
	component: (d) => new ComponentType(d.of === undefined ? [] : [d.of].flat()),
};
// The Type data says, with the named checks it uses from checks (name -> a check). A
// TypeError when data isn't a type or names a check checks doesn't have.
export const compileType = (data, checks = undefined) => {
	checkType(data);
	return compile(data, checks);
};
const compile = (data, checks) => {
	const d = typeof data === "string" ? { type: data } : data;
	const type = CLASSES[d.type](d, (sub) => compile(sub, checks));
	type.data = deepFreeze(typeof data === "string" ? data : { ...d });
	const constraints = {};
	for (const key of ["int", "min", "max", "minLength", "maxLength"]) {
		if (d[key] !== undefined) constraints[key] = d[key];
	}
	if (d.pattern !== undefined) constraints.pattern = new RegExp(d.pattern);
	if (d.check !== undefined) {
		constraints.check = [d.check].flat().map((name) => checkOf(name, checks));
		type.generator = constraints.check.findLast((c) => c.arb !== undefined)?.arb;
	}
	type.constraints = constraints;
	if (d.default !== undefined) type.defaultValue = d.default;
	// A number's bounds pull its zero default in, so { type: "number", min: 1 } is valid made empty.
	else if (d.type === "number") type.defaultValue = clamp(0, d.min, d.max);
	if (d.sync !== undefined) type.syncLevel = d.sync;
	if (d.public === true) type.isPublic = true;
	return type;
};
const clamp = (v, min, max) => {
	if (min !== undefined && v < min) return min;
	return max !== undefined && v > max ? max : v;
};
// A record of types (fields, a meta schema's shape) compiled with checks.
export const compileShape = (shape, checks = undefined, label = "fields") => {
	if (!isRecord(shape)) throw new TypeError(`${label} must map names to types`);
	const out = {};
	for (const [name, data] of Object.entries(shape)) {
		const problems = typeProblems(data, `${label}.${name}`);
		if (problems.length > 0) throw new TypeError(`Not a type: ${problems.join("; ")}`);
		try {
			out[name] = compile(data, checks);
		} catch (error) {
			throw new TypeError(`${label}.${name}: ${error.message}`, { cause: error });
		}
	}
	return out;
};

// A type's data as text, in JavaScript's object syntax, to show and compare: "number", { type:
// "number", int: true, min: 0, default: 0 }.
export const dataText = (data) => {
	if (typeof data === "string") return JSON.stringify(data);
	if (Array.isArray(data)) return `[${data.map(dataText).join(", ")}]`;
	if (!isRecord(data)) return JSON.stringify(data) ?? String(data);
	const keys = Object.keys(data);
	if (keys.length === 1 && keys[0] === "type" && typeof data.type === "string")
		return JSON.stringify(data.type);
	const entries = keys.map(
		(k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${dataText(data[k])}`,
	);
	return `{ ${entries.join(", ")} }`;
};
// A type, compiled or as data, as text.
export const typeText = (type) => dataText(type instanceof Type ? type.data : type);
// A type's text without what doesn't change what it accepts (its default, sync level and
// whether it's public): its signature, as an interface compares it.
export const signatureText = (type) => dataText(signatureOf(type.data));
const signatureOf = (data) => {
	if (!isRecord(data)) return data;
	const { default: _d, sync: _s, public: _p, ...rest } = data;
	if (rest.of !== undefined)
		rest.of =
			Array.isArray(rest.of) && rest.type === "oneOf"
				? rest.of.map(signatureOf)
				: signatureOf(rest.of);
	if (rest.fields !== undefined)
		rest.fields = Object.fromEntries(
			Object.entries(rest.fields).map(([k, v]) => [k, signatureOf(v)]),
		);
	return Object.keys(rest).length === 1 ? rest.type : rest;
};
