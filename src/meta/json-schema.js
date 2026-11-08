// Field types as JSON Schema, for what a model or a file is told a component takes (data's
// load arg, an agent tool's params).

// t.any() lists every JSON type rather than leaving type out: some providers' tool-call parsers
// (GLM's, through OpenRouter) JSON-decode an argument only when its schema's type isn't string,
// and with no type they hand an object over as its JSON text.
const ANY_TYPES = ["object", "array", "string", "number", "boolean", "null"];
const ANY_DESCRIPTION =
	"Any JSON value as itself: an object, array, string, number, boolean or null. Don't encode it as a JSON string.";
const withWhere = (schema, type) => {
	const where = type.constraints.where ?? [];
	if (where.length === 0) return schema;
	const names = where.map((w) => w.name || "a check").join(", ");
	return { ...schema, description: `Must pass: ${names}.` };
};
// A field type as JSON Schema. A where check is opaque: its name goes in the description. A
// component type has no JSON form, so it's {}.
export const typeSchema = (type) => {
	const c = type?.constraints ?? {};
	switch (type?.constructor?.kind) {
		case "string": {
			const s = { type: "string" };
			if (c.minLength > 0) s.minLength = c.minLength;
			if (c.maxLength !== undefined && c.maxLength !== Infinity) s.maxLength = c.maxLength;
			if (c.pattern instanceof RegExp) s.pattern = c.pattern.source;
			return withWhere(s, type);
		}
		case "boolean":
			return { type: "boolean" };
		case "number": {
			const s = { type: c.int ? "integer" : "number" };
			if (c.min !== undefined) s.minimum = c.min;
			if (c.max !== undefined) s.maximum = c.max;
			return withWhere(s, type);
		}
		case "enum":
			return { enum: [...type.members] };
		case "option":
			return { anyOf: [typeSchema(type.valueType), { type: "null" }] };
		case "array":
			return withWhere({ type: "array", items: typeSchema(type.valueType) }, type);
		case "map":
			return { type: "object", additionalProperties: typeSchema(type.valueType) };
		case "record":
			return {
				type: "object",
				properties: Object.fromEntries(
					Object.entries(type.shape).map(([k, v]) => [k, typeSchema(v)]),
				),
				required: Object.keys(type.shape),
				additionalProperties: false,
			};
		case "oneOf":
			return { anyOf: type.types.map(typeSchema) };
		case "index":
			return { type: ["integer", "string"], description: "An index or key into a collection." };
		case "any":
			return withWhere({ type: ANY_TYPES, description: ANY_DESCRIPTION }, type);
		default:
			return {};
	}
};
