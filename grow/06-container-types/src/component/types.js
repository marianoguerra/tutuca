// Field types (spec/component/types.rkt): the t.* builders, what values they accept, and how
// a field is made from an argument or its default.
//
// A type is a kind and its parts. Refine adds the constraints of int(), min(), max(), len()
// and where(); Default is .default(v). An owner is the value holding the field, which index
// types read: the keys of one of its other fields. Inside arrays, maps and records there is no
// owner.

// A field with no argument and no default that meets its type.
export class NoDefaultError extends Error {}

export class Type {
	constructor(kind, parts = {}) {
		this.kind = kind;
		Object.assign(this, parts);
		Object.freeze(this);
	}
	default(value) {
		return new Type("Default", { ty: this, value });
	}
	// Constraints added to a Refine stay in it: (Refine ty check ...).
	refine(check) {
		return this.kind === "Refine"
			? new Type("Refine", { ty: this.ty, checks: [...this.checks, check] })
			: new Type("Refine", { ty: this, checks: [check] });
	}
	int() {
		return this.refine({ check: "int" });
	}
	min(min) {
		return this.refine({ check: "min", min });
	}
	max(max) {
		return this.refine({ check: "max", max });
	}
	len(lo, hi = Infinity) {
		return this.refine({ check: "len", lo, hi });
	}
	where(pred) {
		return this.refine({ check: "pred", pred });
	}
}

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// lengthOf: string and array length, or a record's number of keys.
export function typeLength(v) {
	if (typeof v === "string" || Array.isArray(v)) return v.length;
	if (isRecord(v)) return Object.keys(v).length;
	return undefined;
}

// One constraint; a constraint of the wrong kind, like min on a string, does not hold.
function checkHolds(c, v) {
	try {
		switch (c.check) {
			case "int":
				return Number.isInteger(v);
			case "min":
				return typeof v === "number" && v >= c.min;
			case "max":
				return typeof v === "number" && v <= c.max;
			case "len":
				return c.lo <= typeLength(v) && typeLength(v) <= c.hi;
			case "pred":
				return Boolean(c.pred(v));
		}
	} catch {
		return false;
	}
}

// The keys of the owner's field f: an array's indices, a record's names.
function keysIn(owner, f) {
	const v = owner?.[f];
	if (Array.isArray(v)) return v.map((_, i) => i);
	if (isRecord(v)) return Object.keys(v);
	return [];
}

const sameKeys = (shape, value) =>
	Object.keys(shape).sort().join() === Object.keys(value).sort().join();

// The value has the type's kind and meets its constraints.
export function valid(ty, value, owner) {
	switch (ty.kind) {
		case "Any":
			return true;
		case "String":
			return typeof value === "string";
		case "Number":
			return Number.isFinite(value);
		case "Boolean":
			return typeof value === "boolean";
		case "Enum":
			return ty.values.includes(value);
		case "Option":
			return value === null || valid(ty.ty, value, owner);
		case "Array":
			return Array.isArray(value) && value.every((v) => valid(ty.ty, v));
		case "Map":
			return isRecord(value) && Object.values(value).every((v) => valid(ty.ty, v));
		case "Record":
			return (
				isRecord(value) &&
				sameKeys(ty.shape, value) &&
				Object.keys(ty.shape).every((f) => valid(ty.shape[f], value[f]))
			);
		case "OneOf":
			return ty.types.some((alt) => valid(alt, value, owner));
		case "Index":
			return owner === undefined
				? (Number.isInteger(value) && value >= 0) || typeof value === "string"
				: keysIn(owner, ty.fname).includes(value);
		case "Refine":
			return valid(ty.ty, value, owner) && ty.checks.every((c) => checkHolds(c, value));
		case "Default":
			return valid(ty.ty, value, owner);
	}
}

const clamp = (v, checks) =>
	checks.reduce((v, c) => {
		if (c.check === "min" && v < c.min) return c.min;
		if (c.check === "max" && v > c.max) return c.max;
		return v;
	}, v);

// The value an absent argument becomes; it throws when there is none. Bounds pull Number's zero
// default in. A record makes each key, and a union its first alternative, as a field with no
// argument, so their defaults meet the constraints of what they are made of.
export function defaultOf(ty, owner) {
	switch (ty.kind) {
		case "Any":
			return null;
		case "String":
			return "";
		case "Number":
			return 0;
		case "Boolean":
			return false;
		case "Enum":
			if (ty.values.length === 0) throw new NoDefaultError("an enum with no members");
			return ty.values[0];
		case "Option":
			return null;
		case "Array":
			return [];
		case "Map":
			return {};
		case "Record":
			return Object.fromEntries(Object.entries(ty.shape).map(([f, fty]) => [f, makeField(fty)]));
		case "OneOf":
			if (ty.types.length === 0) throw new NoDefaultError("a union with no alternatives");
			return makeField(ty.types[0], undefined, owner);
		case "Index": {
			const keys = keysIn(owner, ty.fname);
			if (keys.length === 0) throw new NoDefaultError(`no key in ${ty.fname} to point at`);
			return keys[0];
		}
		case "Refine":
			return ty.ty.kind === "Number" ? clamp(0, ty.checks) : defaultOf(ty.ty, owner);
		case "Default":
			return ty.value;
	}
}

// Only the type's own constraints, not its kind.
export function meets(ty, value) {
	switch (ty.kind) {
		case "Refine":
			return meets(ty.ty, value) && ty.checks.every((c) => checkHolds(c, value));
		case "Default":
			return meets(ty.ty, value);
		default:
			return true;
	}
}

// A valid argument is kept; otherwise the default, which must meet the constraints. A default
// that breaks them, like [] for len(1), makes the field required. No argument is undefined.
export function makeField(ty, arg, owner) {
	if (arg !== undefined && valid(ty, arg, owner)) return arg;
	const value = defaultOf(ty, owner);
	if (!meets(ty, value)) throw new NoDefaultError("no default meets the type's constraints");
	return value;
}

const withDefault = (ty) => (value) => (value === undefined ? ty : ty.default(value));

export const t = {
	any: withDefault(new Type("Any")),
	string: withDefault(new Type("String")),
	number: withDefault(new Type("Number")),
	boolean: withDefault(new Type("Boolean")),
	enum: (...values) => new Type("Enum", { values }),
	option: (ty) => new Type("Option", { ty }),
	array: (ty = t.any()) => new Type("Array", { ty }),
	map: (ty = t.any()) => new Type("Map", { ty }),
	record: (shape) => new Type("Record", { shape }),
	oneOf: (...types) => new Type("OneOf", { types }),
	index: (fname) => new Type("Index", { fname }),
};
