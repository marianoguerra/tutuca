// Whether a JSON value matches a JSON Schema: the keywords a structured output's schema uses
// (type, enum, const, properties, required, additionalProperties, items, the lengths and
// bounds, pattern, allOf, anyOf, oneOf, not, and $ref into the document's $defs or
// definitions), not a full validator. Each problem is { path, message }, path from $.

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const typeOf = (v) => {
	if (v === null) return "null";
	if (Array.isArray(v)) return "array";
	if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
	return typeof v;
};
const hasType = (v, type) =>
	type === "number"
		? typeof v === "number"
		: type === typeOf(v) || (type === "object" && isObject(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => JSON.stringify(v);

// The schema a $ref like #/$defs/name points at in root, or undefined.
const resolve = (root, ref) => {
	if (!ref.startsWith("#")) return undefined;
	let at = root;
	for (const part of ref.slice(1).split("/").filter(Boolean)) {
		at = at?.[part.replaceAll("~1", "/").replaceAll("~0", "~")];
	}
	return at;
};

export const validate = (schema, value) => {
	const problems = [];
	check(schema, value, "$", schema, problems, 0);
	return problems;
};

function check(schema, value, path, root, problems, depth) {
	const fail = (message) => problems.push({ path, message });
	if (depth > 64) return fail("the schema refers to itself too deeply");
	if (schema === true || schema === undefined) return;
	if (schema === false) return fail("nothing is allowed here");
	if (!isObject(schema)) return;
	if (typeof schema.$ref === "string") {
		const target = resolve(root, schema.$ref);
		if (target === undefined) fail(`$ref ${schema.$ref} points at nothing`);
		else check(target, value, path, root, problems, depth + 1);
	}
	if (schema.type !== undefined) {
		const types = [schema.type].flat();
		if (!types.some((type) => hasType(value, type))) {
			fail(`should be ${types.join(" or ")}, is ${typeOf(value)}`);
			return; // The other keywords would only repeat it.
		}
	}
	if (Array.isArray(schema.enum) && !schema.enum.some((v) => same(v, value))) {
		fail(`should be one of ${schema.enum.map(show).join(", ")}`);
	}
	if ("const" in schema && !same(schema.const, value)) fail(`should be ${show(schema.const)}`);
	if (typeof value === "string") {
		if (value.length < (schema.minLength ?? 0)) fail(`should be at least ${schema.minLength} long`);
		if (value.length > (schema.maxLength ?? Infinity))
			fail(`should be at most ${schema.maxLength} long`);
		if (typeof schema.pattern === "string") {
			try {
				if (!new RegExp(schema.pattern, "u").test(value)) fail(`should match ${schema.pattern}`);
			} catch {
				fail(`its pattern ${schema.pattern} isn't a regular expression`);
			}
		}
	}
	if (typeof value === "number") {
		if (value < (schema.minimum ?? -Infinity)) fail(`should be at least ${schema.minimum}`);
		if (value > (schema.maximum ?? Infinity)) fail(`should be at most ${schema.maximum}`);
		if (value <= (schema.exclusiveMinimum ?? -Infinity))
			fail(`should be over ${schema.exclusiveMinimum}`);
		if (value >= (schema.exclusiveMaximum ?? Infinity))
			fail(`should be under ${schema.exclusiveMaximum}`);
	}
	if (Array.isArray(value)) {
		if (value.length < (schema.minItems ?? 0))
			fail(`should have at least ${schema.minItems} items`);
		if (value.length > (schema.maxItems ?? Infinity))
			fail(`should have at most ${schema.maxItems} items`);
		if (schema.items !== undefined) {
			for (const [i, item] of value.entries()) {
				check(schema.items, item, `${path}[${i}]`, root, problems, depth + 1);
			}
		}
	}
	if (isObject(value)) {
		const properties = isObject(schema.properties) ? schema.properties : {};
		for (const key of Array.isArray(schema.required) ? schema.required : []) {
			if (!(key in value)) fail(`is missing ${key}`);
		}
		for (const [key, v] of Object.entries(value)) {
			const at = `${path}.${key}`;
			if (key in properties) check(properties[key], v, at, root, problems, depth + 1);
			else if (schema.additionalProperties === false)
				problems.push({ path: at, message: "isn't allowed" });
			else if (isObject(schema.additionalProperties))
				check(schema.additionalProperties, v, at, root, problems, depth + 1);
		}
	}
	const matches = (s) => {
		const found = [];
		check(s, value, path, root, found, depth + 1);
		return found.length === 0;
	};
	if (Array.isArray(schema.allOf)) {
		for (const s of schema.allOf) check(s, value, path, root, problems, depth + 1);
	}
	if (Array.isArray(schema.anyOf) && !schema.anyOf.some(matches)) {
		fail("should match at least one of anyOf");
	}
	if (Array.isArray(schema.oneOf)) {
		const n = schema.oneOf.filter(matches).length;
		if (n !== 1) fail(`should match exactly one of oneOf, matches ${n}`);
	}
	if (schema.not !== undefined && matches(schema.not)) fail("should not match not");
}
