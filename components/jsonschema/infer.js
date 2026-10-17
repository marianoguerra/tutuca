// A JSON Schema that the example value matches: types, properties, required keys and string
// formats, with array items merged into one schema across the elements. The inverse of read.js.
import { isObject } from "./read.js";

const FORMATS = [
	["date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/],
	["date", /^\d{4}-\d{2}-\d{2}$/],
	["email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
	["uri", /^[a-z][a-z0-9+.-]*:\/\/\S+$/i],
];
const formatOf = (s) => FORMATS.find(([, re]) => re.test(s))?.[0] ?? null;

export const inferSchema = (value) => {
	if (value === null) return { type: "null" };
	if (Array.isArray(value)) {
		return value.length === 0
			? { type: "array" }
			: { type: "array", items: mergeAll(value.map(inferSchema)) };
	}
	switch (typeof value) {
		case "boolean":
			return { type: "boolean" };
		case "number":
			return { type: Number.isInteger(value) ? "integer" : "number" };
		case "string": {
			const format = formatOf(value);
			return format === null ? { type: "string" } : { type: "string", format };
		}
		default: {
			const properties = {};
			for (const [k, v] of Object.entries(value)) properties[k] = inferSchema(v);
			return { type: "object", properties, required: Object.keys(properties) };
		}
	}
};

const branchesOf = (s) => s.anyOf ?? [s];
// One schema for two that describe values of the same place.
const merge = (a, b) => {
	if (JSON.stringify(a) === JSON.stringify(b)) return a;
	const typeA = a.type;
	const typeB = b.type;
	const numeric = new Set(["integer", "number"]);
	if (numeric.has(typeA) && numeric.has(typeB)) return { type: "number" };
	if (typeA === "string" && typeB === "string") return { type: "string" }; // Formats differ.
	if (typeA === "array" && typeB === "array") {
		if (a.items === undefined) return b;
		if (b.items === undefined) return a;
		return { type: "array", items: merge(a.items, b.items) };
	}
	if (typeA === "object" && typeB === "object") {
		const properties = { ...a.properties };
		for (const [k, s] of Object.entries(b.properties)) {
			properties[k] = k in properties ? merge(properties[k], s) : s;
		}
		const inB = new Set(b.required);
		return { type: "object", properties, required: a.required.filter((k) => inB.has(k)) };
	}
	// Different types: a union, merging into the branch of the same type when there is one.
	const branches = [...branchesOf(a)];
	for (const s of branchesOf(b)) {
		const i = branches.findIndex((x) => isObject(x) && sameKind(x.type, s.type));
		if (i === -1) branches.push(s);
		else branches[i] = merge(branches[i], s);
	}
	return branches.length === 1 ? branches[0] : { anyOf: branches };
};
const sameKind = (x, y) =>
	x === y || (["integer", "number"].includes(x) && ["integer", "number"].includes(y));
const mergeAll = (schemas) => schemas.reduce(merge);

// The schema as a document: $schema and title first.
export const schemaDocument = (schema, title) => ({
	$schema: "https://json-schema.org/draft/2020-12/schema",
	...(title === "" ? {} : { title }),
	...schema,
});
