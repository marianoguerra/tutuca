// tutuca/data: the host module pure-tutuca components import for what pure-js leaves out and
// components need, the same in tutuca and tutuca-wax (which lowers each to its runtime's):
//
//   import { range, without, kindOf } from "tutuca/data";
//
//   range(start, end)      the whole numbers from start up to end, not end: a loop's indexes
//   without(record, key)   record without key, a new record (pure-js has no delete)
//   kindOf(value)          what a JSON value is: "null", "boolean", "number", "string", "list",
//                          "object" (and "undefined", and "component" for a component)
//   get(value, key)        an object's own member key, a list's item at index key; undefined
//                          otherwise: what reads a value of a type pure-js doesn't know
//                          (unknown), as kindOf tells what it is
//   itemsOf(value)         a list's items, [] for anything else: what walks a value pure-js types
//                          unknown, as get reads one's members
//   keysOf(value)          an object's own keys, in order, [] for anything else (a list's too)
//   toJson(value, indent)  value as JSON text, as JSON.stringify(value, null, indent) writes it
//                          (indent 0: on one line), "null" for undefined
//   parseJson(text)        the value JSON text is, as JSON.parse reads it; undefined when it
//                          isn't JSON
//
// The declaration is the source of truth: scripts/pure-tutuca-goldens.js writes it to
// spec/pure-tutuca/host/data.json and tutuca-wax/pure-tutuca/pure/host_data.mbt.

import { isComponent } from "../core/model/spec.js";

const DATA_SPEC = "tutuca/data";

// The most items range makes: more is undefined behaviour, as it is in tutuca-wax.
const RANGE_LIMIT = 1_000_000;

export const dataDeclaration = Object.freeze({
	specifier: DATA_SPEC,
	module: "Data",
	members: {
		range: "(start: number, end: number) => number[]",
		without: "<V>(record: { [key: string]: V }, key: string) => { [key: string]: V }",
		kindOf:
			'(value: unknown) => "null" | "undefined" | "boolean" | "number" | "string" | "list" | "object" | "component"',
		get: "(value: unknown, key: string | number) => unknown",
		itemsOf: "(value: unknown) => readonly unknown[]",
		keysOf: "(value: unknown) => string[]",
		toJson: "(value: unknown, indent: number) => string",
		parseJson: "(text: string) => unknown",
	},
	fresh: ["Data.range", "Data.without", "Data.parseJson", "Data.keysOf"],
});

const range = (start, end) => {
	const from = Math.ceil(start);
	if (!(end - from <= RANGE_LIMIT))
		throw new Error(`range(${start}, ${end}) makes more than ${RANGE_LIMIT} items`);
	const out = [];
	for (let i = from; i < end; i++) out.push(i);
	return out;
};

const without = (record, key) => {
	const out = {};
	for (const k of Object.keys(record)) if (k !== key) out[k] = record[k];
	return out;
};

const kindOf = (value) => {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (Array.isArray(value)) return "list";
	if (isComponent(value)) return "component";
	const t = typeof value;
	return t === "object" ? "object" : t;
};

const get = (value, key) => {
	if (Array.isArray(value)) return Number.isInteger(key) && key >= 0 ? value[key] : undefined;
	const object = value !== null && typeof value === "object" && !isComponent(value);
	return object && typeof key === "string" && Object.hasOwn(value, key) ? value[key] : undefined;
};

const itemsOf = (value) => (Array.isArray(value) ? value : []);

const keysOf = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value) && !isComponent(value)
		? Object.keys(value)
		: [];

const toJson = (value, indent) =>
	JSON.stringify(value, null, indent > 0 ? indent : undefined) ?? "null";

const parseJson = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

export const dataImpls = Object.freeze({
	"Data.get": get,
	"Data.range": range,
	"Data.without": without,
	"Data.kindOf": kindOf,
	"Data.itemsOf": itemsOf,
	"Data.keysOf": keysOf,
	"Data.toJson": toJson,
	"Data.parseJson": parseJson,
});
