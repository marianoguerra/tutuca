// The standard host: what JavaScript gives every program that pure-js keeps, the parts whose
// results depend on their arguments alone. Math has the functions whose results JavaScript
// specifies exactly (not sin, exp or pow, which are implementation-approximated, nor random);
// JSON.parse drops reserved keys and Object.fromEntries refuses them. Embedders extend it:
// stdHost.extend({ ... }, { ... }).

import { Host } from "./host.js";
import { PureUndefined } from "./runtime.js";
import { RESERVED_NAMES } from "./tables.js";

const unary = "(x: number) => number";
const variadic = "(...values: number[]) => number";

export const stdDeclaration = Object.freeze({
	modules: {
		Math: {
			max: variadic,
			min: variadic,
			abs: unary,
			floor: unary,
			ceil: unary,
			round: unary,
			trunc: unary,
			sign: unary,
		},
		Number: {
			isInteger: "(value: unknown) => boolean",
			isFinite: "(value: unknown) => boolean",
			isNaN: "(value: unknown) => boolean",
			parseInt: "(text: string, radix: number) => number",
			parseFloat: "(text: string) => number",
		},
		JSON: {
			stringify: [
				"(value: unknown) => string | undefined",
				"(value: unknown, replacer: null, space: number) => string | undefined",
			],
			parse: "(text: string) => unknown",
		},
		Object: {
			keys: "(record: { [key: string]: unknown }) => string[]",
			entries: "<V>(record: { [key: string]: V }) => [string, V][]",
			fromEntries: "<V>(entries: [string, V][]) => { [key: string]: V }",
			hasOwn: "(record: { [key: string]: unknown }, key: string) => boolean",
		},
		Array: {
			isArray: "(value: unknown) => boolean",
		},
	},
	functions: {
		String: "(value: string | number | boolean) => string",
		Number: "(value: string | number | boolean) => number",
	},
	fresh: ["Object.keys", "Object.entries", "Object.fromEntries"],
});

const RESERVED = new Set(RESERVED_NAMES);

// JSON.parse's reviver: an object comes back without its reserved keys, so parsed text can't
// leave a value with an own "__proto__" or "toString" in the host's hands.
const withoutReserved = (_key, value) => {
	if (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).some((k) => RESERVED.has(k))
	) {
		const copy = {};
		for (const k of Object.keys(value)) if (!RESERVED.has(k)) copy[k] = value[k];
		return copy;
	}
	return value;
};

// Object.fromEntries with a reserved key is undefined, as setting one by a computed key is.
const fromEntries = (entries) => {
	const out = {};
	for (const [key, value] of entries) {
		if (RESERVED.has(key)) throw new PureUndefined(`setting the key "${key}"`);
		out[key] = value;
	}
	return out;
};

export const stdImplementations = Object.freeze({
	"Math.max": Math.max,
	"Math.min": Math.min,
	"Math.abs": Math.abs,
	"Math.floor": Math.floor,
	"Math.ceil": Math.ceil,
	"Math.round": Math.round,
	"Math.trunc": Math.trunc,
	"Math.sign": Math.sign,
	"Number.isInteger": Number.isInteger,
	"Number.isFinite": Number.isFinite,
	"Number.isNaN": Number.isNaN,
	"Number.parseInt": Number.parseInt,
	"Number.parseFloat": Number.parseFloat,
	"JSON.stringify": (value, replacer, space) => JSON.stringify(value, replacer, space),
	"JSON.parse": (text) => JSON.parse(text, withoutReserved),
	"Object.keys": Object.keys,
	"Object.entries": Object.entries,
	"Object.fromEntries": fromEntries,
	"Object.hasOwn": Object.hasOwn,
	"Array.isArray": Array.isArray,
	String: (value) => String(value),
	Number: (value) => Number(value),
});

export const stdHost = new Host(stdDeclaration, stdImplementations);
