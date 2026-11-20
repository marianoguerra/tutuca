// What compiled and interpreted programs share at run time: the guards on indexing and the
// errors that say how a run ended. Indexing is pure-js's one dynamic exclusion: x[k] reads an
// element of a list or a string by number, or an own key of a dictionary by string, and
// anything else (a number key on a record, "__proto__" as a key, a hole past the end) is
// undefined behaviour, which aborts the run instead of doing what JavaScript would. A reserved
// name ("__proto__", "toString", ...) is never a key a program writes: a literal can't spell
// it, and setting it by a computed key is undefined too, so no value a program leaves in the
// host's hands has one of its own.

import { RESERVED_NAMES } from "./tables.js";

const RESERVED = new Set(RESERVED_NAMES);

// A run reached an operation whose behaviour pure-js leaves undefined.
export class PureUndefined extends Error {
	constructor(why) {
		super(why);
		this.name = "PureUndefined";
		this.why = why;
	}
}
// A run went past its limits (the interpreter's steps or depth).
export class PureLimit extends PureUndefined {
	constructor(why) {
		super(why);
		this.name = "PureLimit";
	}
}

const isList = Array.isArray;
const isDictionary = (v) => typeof v === "object" && v !== null && !isList(v);
const nullish = (v, k) => {
	// What JavaScript throws for null[k], so a run ends as it would.
	throw new TypeError(`Cannot read properties of ${v} (reading '${String(k)}')`);
};

export const get = (object, key) => {
	if (object === null || object === undefined) return nullish(object, key);
	if (typeof key === "number") {
		if (isList(object) || typeof object === "string") return object[key];
		throw new PureUndefined(`indexing a ${typeof object} by a number`);
	}
	if (typeof key === "string") {
		if (isDictionary(object)) return Object.hasOwn(object, key) ? object[key] : undefined;
		throw new PureUndefined(`indexing a ${isList(object) ? "list" : typeof object} by a string`);
	}
	throw new PureUndefined(`indexing by a ${typeof key}`);
};

export const set = (object, key, value) => {
	if (object === null || object === undefined) {
		throw new TypeError(`Cannot set properties of ${object} (setting '${String(key)}')`);
	}
	if (typeof key === "number") {
		if (isList(object) && Number.isInteger(key) && key >= 0 && key <= object.length) {
			object[key] = value;
			return;
		}
		throw new PureUndefined(
			isList(object)
				? `setting element ${key} of a list of ${object.length}`
				: `setting a ${typeof object} by a number`,
		);
	}
	if (typeof key === "string") {
		if (RESERVED.has(key)) throw new PureUndefined(`setting the key "${key}"`);
		if (isDictionary(object)) {
			object[key] = value;
			return;
		}
		throw new PureUndefined(`setting a ${isList(object) ? "list" : typeof object} by a string`);
	}
	throw new PureUndefined(`setting by a ${typeof key}`);
};

// A module's constant, frozen all the way down: what a module declares can't change, whoever
// holds it.
// Only plain data (objects of Object's prototype or none, and arrays): what a host function
// made (a view node, a host's object) is the host's.
const isPlain = (v) => {
	if (Array.isArray(v)) return true;
	const p = Object.getPrototypeOf(v);
	return p === Object.prototype || p === null;
};
export const freeze = (value) => {
	if (value !== null && typeof value === "object" && isPlain(value) && !Object.isFrozen(value)) {
		Object.freeze(value);
		// A getter is an entry: freezing reads only what is data.
		for (const k of Object.keys(value)) {
			const d = Object.getOwnPropertyDescriptor(value, k);
			if ("value" in d) freeze(d.value);
		}
	}
	return value;
};
// What for-of walks: the list (or the string's code points) as it was when the loop began.
export const snapshot = (value) => [...value];

// What compiled code reaches as $pure.
export const runtime = Object.freeze(
	Object.assign(Object.create(null), { get, set, freeze, snapshot }),
);

// How a run ended, from what it returned or threw.
export const finished = (value) => ({ kind: "finished", value });
export const outcomeOf = (error) => {
	if (error instanceof PureUndefined) return { kind: "undefined", why: error.why };
	return {
		kind: "terminated",
		error,
		message: error instanceof Error ? error.message : String(error),
	};
};
