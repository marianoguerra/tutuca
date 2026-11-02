// Field, invariant and message schemas of components, and the checks that use them.
export const specSym = Symbol("TutucaSpec");
export const scopeSym = Symbol("TutucaScope");
// An instance's identity is the tree's (tree/identity.js).
export { idOf, idSym } from "./tree/identity.js";
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
export const brokenInvariants = (instance) => {
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
// What every field type shares: a default, constraints, a generator and a sync level, the
// modifiers that change them, and make/isValid. Each kind of type extends it, and its static
// kind is the t builder name, for tools that print or derive types.
export class Type {
	constructor(defaultValue) {
		this.defaultValue = defaultValue;
		this.constraints = {};
		this.generator = undefined; // (fc, A) => arbitrary, overrides the derived one in pbt.js.
		this.syncLevel = "shared";
		this.isPublic = false; // A public field is also a read-only query of the same name.
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
	// Fields are private: other components read a field only if it is public, as a query.
	public() {
		return this.with({ isPublic: true });
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
// Any value: t.any().
export class AnyType extends Type {
	static kind = "any";
}
export class StringType extends Type {
	static kind = "string";
	constructor(defaultValue = "") {
		super(defaultValue);
	}
	isValidValue(value) {
		return typeof value === "string";
	}
}
export class BooleanType extends Type {
	static kind = "boolean";
	constructor(defaultValue = false) {
		super(defaultValue);
	}
	isValidValue(value) {
		return typeof value === "boolean";
	}
}
export class NumberType extends Type {
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
export class EnumType extends Type {
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
export class OptionType extends Type {
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
export class ArrayType extends Type {
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
export class MapType extends Type {
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
				return [k, type.make(undefined, scope)];
			} catch (error) {
				const Wrapped = error instanceof NoDefaultError ? NoDefaultError : Error;
				throw new Wrapped(`${k}: ${error.message}`, { cause: error });
			}
		});
		return Object.fromEntries(entries);
	}
	isValidValue(value, scope) {
		if (!isRecord(value)) return false;
		if (Object.keys(value).some((k) => !Object.hasOwn(this.shape, k))) return false;
		return Object.entries(this.shape).every(([k, type]) => type.isValid(value[k], scope));
	}
}
export class OneOfType extends Type {
	static kind = "oneOf";
	constructor(...types) {
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
// a scope can swap it. A name the scope has an interface under, or an Interface itself, takes
// any component implementing it. Without names any component is valid.
export class ComponentType extends Type {
	static kind = "component";
	constructor(names) {
		super(undefined);
		this.names = names === undefined ? [] : [names].flat();
	}
	get name() {
		return this.names[0];
	}
	makeDefault(scope) {
		if (this.name instanceof Interface) {
			throw new NoDefaultError(`t.component(${this.name.name}) has no default, pass a component`);
		}
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
		if (this.names.length === 0) return true;
		return this.names.some((name) => {
			if (name instanceof Interface) return implementsIface(value, name);
			if (scope === null) return true;
			const iface = scope.lookupInterface(name);
			if (iface !== null) return implementsIface(value, iface);
			return scope.lookupByName(name) === specOf(value);
		});
	}
}
// The type an option wraps, or type itself.
export const unwrapOption = (type) =>
	type instanceof OptionType ? unwrapOption(type.valueType) : type;
const typeArgs = (t, text) => {
	if (t instanceof EnumType) return t.members.map(text);
	if (t instanceof IndexType) return [text(t.fieldName)];
	if (t instanceof ComponentType)
		return t.names.map((n) => text(n instanceof Interface ? n.name : n));
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
	oneOf: ctor(OneOfType),
	index: ctor(IndexType),
	component: ctor(ComponentType),
};
// An on entry is a handler function, or a handler spec { run, args, sourceKey, pre, why, post,
// emits, pure }: the handler, run, with its contract. args types the send/notify arguments,
// sourceKey the child key it arrives from, pre and post are conditions on the instance (why,
// given self and args, says in words why pre doesn't hold), and emits lists what it may send
// as { notify, ask, sendAt } name arrays. A pure one runs as run(next, args),
// without a ctx: it can't send or read the world, so it can also be applied (contract.js) to a
// component synchronously, in whatever transaction the caller is in.
export class HandlerSpec {
	constructor(name, entry) {
		const spec = typeof entry === "function" ? { run: entry } : entry;
		this.name = name;
		this.run = spec.run;
		this.args = spec.args;
		this.sourceKey = spec.sourceKey;
		this.pre = spec.pre;
		this.why = spec.why;
		this.post = spec.post;
		this.emits = spec.emits;
		this.pure = spec.pure === true;
	}
}
// A query: a public read of a component, with no effects. A get one reads like a field (a
// getter, a computed property; a public field is one too), a call one takes args. args and
// returns type them, for checks and tools.
export class QuerySpec {
	constructor(name, { kind, fn = null, args = undefined, returns = undefined }) {
		this.name = name;
		this.kind = kind; // "get", "call" or "field"
		this.fn = fn; // The getter or the function; null for a field.
		this.args = kind === "call" ? args : [];
		this.returns = returns;
	}
}
// queries' entries: a getter (get), a function (call), { get, returns } or
// { run, args, returns }. Fields marked public are get queries returning their type.
// Other entries stay as they are for lint to report.
export const toQueries = (queries, fields) => {
	const out = Object.create(null);
	for (const name in fields) {
		if (fields[name]?.isPublic) {
			out[name] = new QuerySpec(name, { kind: "field", returns: fields[name] });
		}
	}
	for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(queries ?? {}))) {
		const v = d.value;
		if (d.get !== undefined) out[name] = new QuerySpec(name, { kind: "get", fn: d.get });
		else if (typeof v === "function") out[name] = new QuerySpec(name, { kind: "call", fn: v });
		else if (typeof v?.get === "function")
			out[name] = new QuerySpec(name, { kind: "get", fn: v.get, returns: v.returns });
		else if (typeof v?.run === "function")
			out[name] = new QuerySpec(name, {
				kind: "call",
				fn: v.run,
				args: v.args,
				returns: v.returns,
			});
		else out[name] = v;
	}
	return out;
};
// An interface: what a component offers other components, by name and type, and no state.
// messages and pure map names to arg types; queries map names to { args, returns }, args
// empty for a get one; notifies map names to arg types, of the messages it notifies up with.
export class Interface {
	constructor(name, { messages = {}, pure = {}, queries = {}, notifies = {} } = {}) {
		this.name = name;
		this.messages = messages;
		this.pure = pure;
		this.queries = queries;
		this.notifies = notifies;
	}
}
export const iface = (name, operations) => new Interface(name, operations);
// A type as its signature: what it accepts, without its default.
const sigText = (type) => typeText(type.with({ defaultValue: undefined }));
const sameTypes = (want = [], got = undefined) =>
	got !== undefined &&
	want.length === got.length &&
	want.every((t, i) => sigText(t) === sigText(got[i]));
// What spec lacks to implement iface, as messages: each of iface's messages a handler with the
// same arg types (a pure one does too), each pure message a pure one, each query one of the
// same args and returns. Undeclared types only match no args. notifies aren't checked: a
// handler need not declare what it emits.
export const interfaceProblems = (spec, iface) => {
	const problems = [];
	const missing = (what, name) => problems.push(`its ${what} ${name} is missing`);
	const mismatch = (what, name, detail) =>
		problems.push(`its ${what} ${name} ${detail}, ${iface.name}'s doesn't`);
	const checkMessage = (name, args, pure) => {
		const h = spec.on[name];
		if (!(h instanceof HandlerSpec)) return missing(pure ? "pure message" : "message", name);
		if (pure && !h.pure) problems.push(`its message ${name} isn't pure, ${iface.name}'s is`);
		if (!(args.length === 0 && h.args === undefined) && !sameTypes(args, h.args))
			mismatch("message", name, `takes (${(h.args ?? []).map(sigText).join(", ")})`);
	};
	for (const name in iface.messages) checkMessage(name, iface.messages[name], false);
	for (const name in iface.pure) checkMessage(name, iface.pure[name], true);
	for (const name in iface.queries) {
		const want = iface.queries[name];
		const q = spec.queries?.[name];
		if (!(q instanceof QuerySpec)) {
			missing("query", name);
			continue;
		}
		const wantArgs = want.args ?? [];
		if (
			wantArgs.length === 0 ? q.kind === "call" && q.args?.length > 0 : !sameTypes(wantArgs, q.args)
		)
			mismatch("query", name, `takes (${(q.args ?? []).map(sigText).join(", ")})`);
		if (want.returns !== undefined) {
			if (q.returns === undefined) problems.push(`its query ${name} doesn't say what it returns`);
			else if (sigText(want.returns) !== sigText(q.returns))
				mismatch("query", name, `returns ${sigText(q.returns)}`);
		}
	}
	return problems;
};
// The interfaces spec says it implements, resolved in scope: an Interface as it is, a name as
// the scope has it (null when it doesn't).
export const resolveImplements = (spec, scope) =>
	(spec.implements ?? []).map((it) =>
		it instanceof Interface ? it : (scope?.lookupInterface(it) ?? null),
	);
// Whether value is a component implementing iface: it says so, in its scope, or its scope makes
// it by the interface's name.
export const implementsIface = (value, iface) => {
	const spec = specOf(value);
	if (spec === undefined) return false;
	const scope = scopeOf(value);
	if (resolveImplements(spec, scope).includes(iface)) return true;
	if (scope === null) return false;
	for (let s = scope; s !== null; s = s.parent) {
		for (const name in s.interfaces) {
			if (s.interfaces[name] === iface && scope.lookupByName(name) === spec) return true;
		}
	}
	return false;
};
// Calling an interface operation a component doesn't support, or with what breaks its contract.
// code is the first of issues: "unknown", "not-pure", "args", "arg:<i>", "pre", "post", "returns",
// "invariant:<name>", or "not-component".
export class ContractError extends Error {
	constructor(component, name, issues, detail = "") {
		const what = component === null ? "not a component" : `${component}.${name}`;
		super(`${what}: ${issues.join(", ")}${detail === "" ? "" : ` (${detail})`}`);
		this.name = "ContractError";
		this.component = component;
		this.operation = name;
		this.issues = issues;
		this.code = issues[0];
		this.detail = detail; // In words, as a failed pre's why says it.
	}
}
// The ways args don't match types: "args" for their count, "arg:<i>" for one's type.
export const argIssues = (types, args, scope, owner) => {
	if (types === undefined) return [];
	if (args.length !== types.length) return ["args"];
	const issues = [];
	types.forEach((type, i) => {
		if (!type.isValid(args[i], scope, owner)) issues.push(`arg:${i}`);
	});
	return issues;
};
// Other entries stay as they are for lint to report.
export const toMessages = (on) => {
	const messages = Object.create(null); // no toString &c in entries
	for (const key in on) {
		const entry = on[key];
		const isSpec = typeof entry === "function" || (typeof entry === "object" && entry !== null);
		messages[key] = isSpec ? new HandlerSpec(key, entry) : entry;
	}
	return messages;
};
// answers maps an ask's name to its outcomes' handlers, { ok, error, unhandled }, each an entry
// as on's are; its HandlerSpec is named "<ask>.<outcome>". Other shapes stay for lint.
export const toAnswers = (answers) => {
	const out = Object.create(null);
	for (const ask in answers) {
		const outcomes = answers[ask];
		if (typeof outcomes !== "object" || outcomes === null) {
			out[ask] = outcomes;
			continue;
		}
		out[ask] = Object.create(null);
		for (const outcome in outcomes) {
			const entry = outcomes[outcome];
			const isSpec = typeof entry === "function" || (typeof entry === "object" && entry !== null);
			out[ask][outcome] = isSpec ? new HandlerSpec(`${ask}.${outcome}`, entry) : entry;
		}
	}
	return out;
};
// The ways a handled message broke its spec: "args", "arg:<i>", "sourceKey", "pre", "post"
// and "emits:<kind>:<name>". prev and next are the component before and after the handler,
// info is { sourceKey, emitted } from the MessageContext it ran in.
export const messageIssues = (message, prev, next, args, info) => {
	const scope = scopeOf(prev);
	const issues = argIssues(message.args, args, scope, prev);
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
