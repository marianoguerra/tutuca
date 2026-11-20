// Field types (spec/component/types.rkt): the t.* builders, what values they accept, and how
// a field is made from an argument or its default.
//
// A type is a kind and its parts. Refine adds the constraints of int(), min(), max(), len()
// and where(); Default is .default(v). An owner is the value holding the field.

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

// lengthOf: string length.
export function typeLength(v) {
	if (typeof v === "string") return v.length;
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

// The value an absent argument becomes. Bounds pull Number's zero default in.
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
// that breaks them, like "" for len(1), makes the field required. No argument is undefined.
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
};
