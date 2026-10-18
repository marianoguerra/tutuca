// Field, invariant and message schemas of components, and the checks that use them.
export const specSym = Symbol("TutucaSpec");
export const scopeSym = Symbol("TutucaScope");
export const specOf = (v) => v?.[specSym];
// Whether fn returns truthy without throwing.
function holds(fn) {
	try {
		return Boolean(fn());
	} catch {
		return false;
	}
}
export const scopeOf = (v) => v?.[scopeSym] ?? null;
export const isComponent = (v) => specOf(v) !== undefined;
// The names of the invariants instance breaks; a throwing invariant counts as broken.
const brokenInvariants = (instance) => {
	const { invariants } = specOf(instance);
	return Object.keys(invariants).filter((name) => !holds(() => invariants[name].call(instance)));
};
// Dev mode: the fields of the components in value that don't match their schema, as
// { path, component, field, value, reason }. Broken invariants report the component
// itself with field null and reason "invariant:<name>". Subtrees shared with prev are
// skipped, so after a task only what it changed is walked. check picks what to report.
export const findInvalidFields = (value, prev, check = { fields: true, invariants: true }) =>
	collectInvalid(value, prev, check, [], []);
const collectInvalid = (value, prev, check, issues, path) => {
	if (value === prev || value === null || typeof value !== "object") return issues;
	const prevAt = (key) => (prev !== null && typeof prev === "object" ? prev[key] : undefined);
	if (!isComponent(value)) {
		for (const key of Object.keys(value)) {
			collectInvalid(value[key], prevAt(key), check, issues, [...path, key]);
		}
		return issues;
	}
	const { name: component, fields } = specOf(value);
	const scope = scopeOf(value);
	const report = (field, reason) =>
		issues.push({ path: [...path, field], component, field, value: value[field], reason });
	for (const field of check.fields ? Object.keys(value) : []) {
		if (!Object.hasOwn(fields, field)) report(field, "undeclared");
	}
	for (const field in fields) {
		if (check.fields && !fields[field].isValid(value[field], scope, value))
			report(field, "invalid");
		collectInvalid(value[field], prevAt(field), check, issues, [...path, field]);
	}
	for (const name of check.invariants ? brokenInvariants(value) : []) {
		issues.push({ path, component, field: null, value, reason: `invariant:${name}` });
	}
	return issues;
};
const lengthOf = (v) =>
	typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length : v.length;
// Constraints narrow a type; each one checks values that already have the right kind.
const CHECKS = {
	int: (v) => Number.isInteger(v),
	min: (v, min) => v >= min,
	max: (v, max) => v <= max,
	minLength: (v, n) => lengthOf(v) >= n,
	maxLength: (v, n) => lengthOf(v) <= n,
	pattern: (v, re) => re.test(v),
	where: (v, preds) => preds.every(({ pred }) => pred(v)),
};
// make throws it for state it can't default: a missing value, not a bug in the component.
export class NoDefaultError extends Error {}
// How far a field's state goes, from most to least: replicated and persisted, persisted on this
// device only, neither. A sync engine sees the fields up to its level.
export const SYNC_LEVELS = ["shared", "local", "none"];
export const syncsAt = (type, level) =>
	SYNC_LEVELS.indexOf(type.syncLevel) <= SYNC_LEVELS.indexOf(level);
export class AnyType {
	static kind = "any"; // The t builder name, for tools that print or derive types.
	constructor(defaultValue) {
		this.defaultValue = defaultValue;
		this.constraints = {};
		this.generator = undefined; // (fc, A) => arbitrary, overrides the derived one in pbt.js.
		this.syncLevel = "shared";
	}
	// Types are immutable: modifiers return a changed copy.
	with(changes) {
		return Object.assign(Object.create(Object.getPrototypeOf(this)), this, changes);
	}
	constrain(changes) {
		return this.with({ constraints: { ...this.constraints, ...changes } });
	}
	default(defaultValue) {
		return this.with({ defaultValue });
	}
	int() {
		return this.constrain({ int: true });
	}
	min(min) {
		return this.constrain({ min });
	}
	max(max) {
		return this.constrain({ max });
	}
	len(minLength, maxLength = Infinity) {
		return this.constrain({ minLength, maxLength });
	}
	match(pattern) {
		return this.constrain({ pattern });
	}
	where(pred, name = pred.name) {
		return this.constrain({ where: [...(this.constraints.where ?? []), { pred, name }] });
	}
	arb(generator) {
		return this.with({ generator });
	}
	sync(level) {
		if (!SYNC_LEVELS.includes(level)) {
			throw new Error(`sync level must be one of ${SYNC_LEVELS.join(", ")}, got ${String(level)}`);
		}
		return this.with({ syncLevel: level });
	}
	children() {
		return [];
	}
	// owner is the component holding the field, for types that depend on its other fields.
	// A default that breaks the constraints, like [] for .len(1), makes the field required.
	make(value, scope, owner) {
		if (this.isValid(value, scope, owner)) return value;
		const made = this.makeDefault(scope, owner);
		if (!this.meetsConstraints(made))
			throw new NoDefaultError("has no default that meets its constraints");
		return made;
	}
	makeDefault(_scope, _owner) {
		const v = this.defaultValue; // Copy so instances don't share a mutable default.
		if (typeof v === "function") return v();
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
export class StringType extends AnyType {
	static kind = "string";
	constructor(defaultValue = "") {
		super(defaultValue);
	}
	isValidValue(value) {
		return typeof value === "string";
	}
}
export class BooleanType extends AnyType {
	static kind = "boolean";
	constructor(defaultValue = false) {
		super(defaultValue);
	}
	isValidValue(value) {
		return typeof value === "boolean";
	}
}
export class NumberType extends AnyType {
	static kind = "number";
	constructor(defaultValue = 0) {
		super(defaultValue);
	}
	// Bounds pull the zero default in, so t.number().min(1) is valid when made empty.
	min(min) {
		const type = super.min(min);
		return this.defaultValue < min ? type.default(min) : type;
	}
	max(max) {
		const type = super.max(max);
		return this.defaultValue > max ? type.default(max) : type;
	}
	isValidValue(value) {
		return Number.isFinite(value);
	}
}
export class EnumType extends AnyType {
	static kind = "enum";
	constructor(...members) {
		super(members[0]);
		this.members = members;
	}
	isValidValue(value) {
		return this.members.includes(value);
	}
}
// Null or a valid inner value; nullability is a type, not a flag on every type.
export class OptionType extends AnyType {
	static kind = "option";
	constructor(valueType) {
		super(null);
		this.valueType = valueType;
	}
	children() {
		return [this.valueType];
	}
	isValidValue(value, scope, owner) {
		return value === null || this.valueType.isValid(value, scope, owner);
	}
}
export class ArrayType extends AnyType {
	static kind = "array";
	constructor(valueType = new AnyType(null)) {
		super([]);
		this.valueType = valueType;
	}
	children() {
		return [this.valueType];
	}
	isValidValue(value, scope) {
		return Array.isArray(value) && value.every((v) => this.valueType.isValid(v, scope));
	}
}
export const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
// A record with arbitrary string keys and values of one type.
export class MapType extends AnyType {
	static kind = "map";
	constructor(valueType = new AnyType(null)) {
		super({});
		this.valueType = valueType;
	}
	children() {
		return [this.valueType];
	}
	isValidValue(value, scope) {
		return isRecord(value) && Object.values(value).every((v) => this.valueType.isValid(v, scope));
	}
}
// A record with exactly the keys of shape, each of its own type.
export class RecordType extends AnyType {
	static kind = "record";
	constructor(shape) {
		super(undefined); // Undefined builds the default from the shape's defaults.
		this.shape = shape;
	}
	children() {
		return Object.values(this.shape);
	}
	makeDefault(scope, owner) {
		if (this.defaultValue !== undefined) return super.makeDefault(scope, owner);
		const entries = Object.entries(this.shape).map(([k, type]) => [k, type.makeDefault(scope)]);
		return Object.fromEntries(entries);
	}
	isValidValue(value, scope) {
		if (!isRecord(value)) return false;
		if (Object.keys(value).some((k) => !Object.hasOwn(this.shape, k))) return false;
		return Object.entries(this.shape).every(([k, type]) => type.isValid(value[k], scope));
	}
}
export class UnionType extends AnyType {
	static kind = "oneOf";
	constructor(...types) {
		super(undefined); // Undefined takes the first alternative's default.
		this.types = types;
	}
	children() {
		return this.types;
	}
	makeDefault(scope, owner) {
		if (this.defaultValue !== undefined) return super.makeDefault(scope, owner);
		return this.types[0].makeDefault(scope, owner);
	}
	isValidValue(value, scope, owner) {
		return this.types.some((type) => type.isValid(value, scope, owner));
	}
}
// A key of the array or map in the owner's field, such as a selected index.
export class IndexType extends AnyType {
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
				`${this.fieldName} has no key for a required t.index(), use t.option`,
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
// a scope can swap it. Without names any component is valid.
export class ComponentType extends AnyType {
	static kind = "component";
	constructor(names) {
		super(undefined);
		this.names = names === undefined ? [] : [names].flat();
	}
	get name() {
		return this.names[0];
	}
	makeDefault(scope) {
		if (this.name === undefined) {
			throw new NoDefaultError(
				"required t.component() has no default, pass a component or name it",
			);
		}
		if (scope === null) {
			throw new NoDefaultError(
				`no scope to make ${this.name} in, use scope.components to create it`,
			);
		}
		return scope.make(this.name);
	}
	isValidValue(value, scope) {
		if (!isComponent(value)) return false;
		if (this.names.length === 0 || scope === null) return true;
		return this.names.some((name) => scope.lookupByName(name) === specOf(value));
	}
}
// The type an option wraps, or type itself.
export const unwrapOption = (type) =>
	type instanceof OptionType ? unwrapOption(type.valueType) : type;
const typeArgs = (t, text) => {
	if (t instanceof EnumType) return t.members.map(text);
	if (t instanceof IndexType) return [text(t.fieldName)];
	if (t instanceof ComponentType) return t.names.map(text);
	if (t instanceof RecordType)
		return Object.entries(t.shape).map(([k, v]) => `${k}: ${typeText(v)}`);
	return t
		.children()
		.filter((c) => c.constructor !== AnyType)
		.map(typeText);
};
// A type as text, like `number.int().min(0) = 0`, to compare and show.
export const typeText = (t) => {
	if (t instanceof OptionType) return `${typeText(t.valueType)}?`;
	const text = (v) => (v instanceof RegExp ? String(v) : JSON.stringify(v));
	const args = typeArgs(t, text);
	const { where = [], ...rest } = t.constraints;
	const constraints = Object.entries(rest).map(([k, v]) =>
		v === true ? `.${k}()` : `.${k}(${text(v)})`,
	);
	for (const { name } of where) constraints.push(`.where(${name})`);
	const sync = t.syncLevel === "shared" ? "" : `.sync(${text(t.syncLevel)})`;
	const { defaultValue: d } = t;
	const value =
		d === undefined || d === null ? "" : typeof d === "function" ? " = ƒ" : ` = ${text(d)}`;
	return `${t.constructor.kind}${args.length > 0 ? `(${args.join(", ")})` : ""}${constraints.join("")}${sync}${value}`;
};
const ctor =
	(Type) =>
	(...args) =>
		new Type(...args);
export const t = {
	any: (defaultValue = null) => new AnyType(defaultValue),
	string: ctor(StringType),
	boolean: ctor(BooleanType),
	number: ctor(NumberType),
	enum: ctor(EnumType),
	option: ctor(OptionType),
	array: ctor(ArrayType),
	map: ctor(MapType),
	record: ctor(RecordType),
	oneOf: ctor(UnionType),
	index: ctor(IndexType),
	component: ctor(ComponentType),
};
// An on entry is a handler function, or a message spec { run, args, sourceKey, pre, post, emits }:
// args types the send/notify arguments, sourceKey the child key it arrives from, pre and post
// are its contract, and emits lists what it may send as { notify, ask, sendAt } name arrays.
export class MessageSpec {
	constructor(name, entry) {
		const spec = typeof entry === "function" ? { run: entry } : entry;
		const { run, args, sourceKey, pre, post, emits } = spec;
		Object.assign(this, { name, run, args, sourceKey, pre, post, emits });
	}
}
// Other entries stay as they are for lint to report.
export const toMessages = (on) => {
	const messages = Object.create(null); // no toString &c in entries
	for (const key in on) {
		const entry = on[key];
		const isSpec = typeof entry === "function" || (typeof entry === "object" && entry !== null);
		messages[key] = isSpec ? new MessageSpec(key, entry) : entry;
	}
	return messages;
};
// The ways a handled message broke its spec: "args", "arg:<i>", "sourceKey", "pre", "post"
// and "emits:<kind>:<name>". prev and next are the component before and after the handler,
// info is { sourceKey, emitted } from the MessageContext it ran in.
export const messageIssues = (message, prev, next, args, info) => {
	const issues = [];
	const scope = scopeOf(prev);
	if (message.args !== undefined) {
		if (args.length !== message.args.length) issues.push("args");
		else {
			message.args.forEach((type, i) => {
				if (!type.isValid(args[i], scope, prev)) issues.push(`arg:${i}`);
			});
		}
	}
	const { sourceKey, emitted } = info;
	if (message.sourceKey !== undefined && !message.sourceKey.isValid(sourceKey, scope, prev)) {
		issues.push("sourceKey");
	}
	if (message.pre !== undefined && !holds(() => message.pre.call(prev, prev, args, info))) {
		issues.push("pre");
	}
	if (message.post !== undefined && !holds(() => message.post.call(prev, prev, next, args, info))) {
		issues.push("post");
	}
	if (message.emits !== undefined) {
		for (const { kind, name } of emitted) {
			if (!message.emits[kind]?.includes(name)) issues.push(`emits:${kind}:${name}`);
		}
	}
	return issues;
};
