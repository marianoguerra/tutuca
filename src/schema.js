// Field types of components: t's builders, the checks their constraints run, and how they
// make and validate values. Component specs are in spec.js, their contracts in contract.js.
import { Interface, implementsIface } from "./interface.js";
import { isComponent, specOf } from "./spec.js";

export const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

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
	// The type as t's builders write it (typeText), for modules that can't import this one.
	text() {
		return typeText(this);
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
// A type holding values of one inner type: an option, an array or a map.
class ContainerType extends Type {
	constructor(defaultValue, valueType = new AnyType(null)) {
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
	isValidValue(value, scope) {
		return Array.isArray(value) && value.every((v) => this.valueType.isValid(v, scope));
	}
}
// A record with arbitrary string keys and values of one type.
export class MapType extends ContainerType {
	static kind = "map";
	constructor(valueType) {
		super({}, valueType);
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
				throw prefixed(k, error);
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
