// Reading a schema: which kind of node a JSON Schema is, and the tree of nodes for it.
import { fromJson } from "../json/index.js";
import { DEFAULT_PER_PAGE, pagerFor } from "./index.js";

export const isObject = (j) => typeof j === "object" && j !== null && !Array.isArray(j);
const arrayAt = (j, key) => (Array.isArray(j[key]) ? j[key] : []);
// A keyword as text: a number or a string, else "".
const scalar = (j, key) => {
	const v = j[key];
	return typeof v === "string" || typeof v === "number" ? String(v) : "";
};
const notesOf = (j) => ({ title: scalar(j, "title"), description: scalar(j, "description") });

// Which kind of schema j is, in the order a validator reads it: $ref stands for what it points
// at, a combinator is about its branches, enum and const pin the value whatever its type.
// Only then type decides, and a schema without one is read from the keywords it carries.
export const readKind = (j) => {
	if (j === false) return "never";
	if (!isObject(j) || Object.keys(j).length === 0) return "any";
	if (typeof j.$ref === "string") return "ref";
	for (const k of ["allOf", "anyOf", "oneOf"]) if (Array.isArray(j[k])) return k;
	if ("not" in j) return "not";
	if (Array.isArray(j.enum)) return "enum";
	if ("const" in j) return "const";
	if (typeof j.type === "string") return j.type;
	if (Array.isArray(j.type)) return "union";
	if ("properties" in j || "required" in j) return "object";
	if ("items" in j) return "array";
	return "any";
};
const COMBINATORS = { allOf: "SchemaAllOf", anyOf: "SchemaAnyOf", oneOf: "SchemaOneOf" };

// The node for schema j, made with C, a scope's components; open is how every node starts.
export const fromSchema = (C, j, { open = true, perPage = DEFAULT_PER_PAGE } = {}) => {
	const node = (x) => fromSchema(C, x, { open, perPage });
	const value = (x) => fromJson(C, x);
	const kind = readKind(j);
	switch (kind) {
		case "object": {
			const required = new Set(arrayAt(j, "required"));
			const props = isObject(j.properties) ? Object.entries(j.properties) : [];
			const properties = props.map(([name, sub]) =>
				C.SchemaProperty({ name, required: required.has(name), schema: node(sub) }),
			);
			return C.SchemaObject({
				...notesOf(j),
				properties,
				additional: "additionalProperties" in j ? node(j.additionalProperties) : null,
				open,
				pager: pagerFor(C, properties.length, perPage),
			});
		}
		case "array":
			return C.SchemaArray({
				...notesOf(j),
				items: "items" in j ? node(j.items) : null,
				minItems: scalar(j, "minItems"),
				maxItems: scalar(j, "maxItems"),
				open,
			});
		case "string":
			return C.SchemaString({
				...notesOf(j),
				format: scalar(j, "format"),
				pattern: scalar(j, "pattern"),
				minLength: scalar(j, "minLength"),
				maxLength: scalar(j, "maxLength"),
			});
		case "number":
		case "integer":
			return C[kind === "number" ? "SchemaNumber" : "SchemaInteger"]({
				...notesOf(j),
				minimum: scalar(j, "minimum"),
				maximum: scalar(j, "maximum"),
				multipleOf: scalar(j, "multipleOf"),
			});
		case "boolean":
			return C.SchemaBoolean(notesOf(j));
		case "null":
			return C.SchemaNull(notesOf(j));
		case "union":
			return C.SchemaUnion({ ...notesOf(j), types: j.type.filter((x) => typeof x === "string") });
		case "enum": {
			const values = j.enum.map(value);
			return C.SchemaEnum({
				...notesOf(j),
				values,
				open,
				pager: pagerFor(C, values.length, perPage),
			});
		}
		case "const":
			return C.SchemaConst({ ...notesOf(j), value: value(j.const) });
		case "ref":
			return C.SchemaRef({ target: j.$ref });
		case "not":
			return C.SchemaNot({ ...notesOf(j), schema: node(j.not) });
		case "never":
			return C.SchemaNever();
		case "allOf":
		case "anyOf":
		case "oneOf": {
			const branches = j[kind].map(node);
			return C[COMBINATORS[kind]]({
				...notesOf(j),
				branches,
				open,
				pager: pagerFor(C, branches.length, perPage),
			});
		}
		default:
			return C.SchemaAny();
	}
};

// A whole schema under its root.
export const schemaTree = (C, j, { view = "main", ...options } = {}) =>
	C.SchemaRoot({ node: fromSchema(C, j, options), view });

// The schema a tree was built from, with node.toSchema(). Lossy by construction: keywords the
// family doesn't model ($defs, if/then, vendor extensions) are not in the tree. So the round
// trip is a fixed point rather than an identity: reading toSchema's output gives it back.
export const toSchema = (node) => node.toSchema();
