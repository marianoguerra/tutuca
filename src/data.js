// The data meta convention: a component's whole content as plain JSON. It names a pure message
// of one arg that replaces the content (load), a zero-arg query that reads it back as what load
// takes (data), the JSON Schema of that arg (derived from its type unless given), and samples to
// start from. Whatever sets a component from data reads it: a file dropped on it, an agent's
// get_state and set_state, a canvas hole's samples. The law: load(data) reads back as data.
//
// A component declares it with component({ meta: { [DATA_META]: { load, data, ... } } }); a
// scope that registers dataMetaSchemas checks its shape, and dataProblems checks what the shape
// can't: that load and data name a message and a query the component has, of the right kind.
import { apply } from "./contract.js";
import { t } from "./schema.js";
import { ContractError, HandlerSpec, metaOf, metaProblems, QuerySpec, specOf } from "./spec.js";

export const DATA_META = "https://tutuca.dev/meta/data";
export const dataMetaSchemas = {
	[DATA_META]: {
		// A pure message of one arg, the content as JSON, which replaces the whole content.
		load: t.string("load"),
		// A zero-arg query whose value, plain JSON, load takes back; none when null.
		data: t.option(t.string()),
		// The JSON Schema of what load takes, when its arg type can't say it (an any with a where
		// check); null derives it from the type.
		schema: t.option(t.any()),
		samples: t.map(t.any()), // name -> what load takes.
	},
};

export const deepFreeze = (v) => {
	if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
		Object.freeze(v);
		for (const k of Object.keys(v)) deepFreeze(v[k]);
	}
	return v;
};
const DEFAULTS = { load: "load", data: null, schema: null };
// What c (a component or, with scope, its spec) says about its data, with every key filled.
export const dataOf = (c, scope = undefined) => {
	const meta = metaOf(c, DATA_META, scope);
	return deepFreeze({ ...DEFAULTS, samples: {}, ...structuredClone({ ...meta }) });
};
// Whether c (a component or its spec) says what its data is.
export const hasDataMeta = (c) => Object.hasOwn((specOf(c) ?? c)?.meta ?? {}, DATA_META);

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

export const isZeroArgQuery = (spec, name) => {
	const q = spec?.queries?.[name];
	return q instanceof QuerySpec && (q.args === undefined || q.args.length === 0);
};
const loadMessage = (spec, name) => {
	const load = spec?.on?.[name];
	return load instanceof HandlerSpec && load.pure && load.args?.length === 1 ? load : null;
};

// The JSON Schema of what c's load takes: the meta's, else its arg type's.
export const dataSchema = (c, scope = undefined) => {
	const meta = dataOf(c, scope);
	if (meta.schema !== null) return meta.schema;
	return typeSchema(loadMessage(specOf(c) ?? c, meta.load)?.args[0]);
};

// What c (a component or its spec, with scope) says about its data that it can't do, as
// messages: a load that isn't a pure message of one arg, a data that isn't a zero-arg query.
export const dataProblems = (c, scope = undefined) => {
	const spec = specOf(c) ?? c;
	if (!hasDataMeta(spec)) return [];
	const shape = metaProblems(DATA_META, spec.meta[DATA_META], dataMetaSchemas[DATA_META]);
	if (shape.length > 0) return shape;
	const meta = dataOf(c, scope);
	const problems = [];
	if (loadMessage(spec, meta.load) === null) {
		problems.push(`its data load ${meta.load} isn't a pure message of one arg`);
	}
	if (meta.data !== null && !isZeroArgQuery(spec, meta.data)) {
		problems.push(`its data ${meta.data} isn't a zero-arg query`);
	}
	return problems;
};

// A type in words: an any with where checks is what its checks are named.
const typeWords = (type) => {
	const where = type.constructor?.kind === "any" ? (type.constraints.where ?? []) : [];
	return where.length > 0 ? where.map((w) => w.name || "valid").join(" and ") : type.text();
};
// Why calling operation name on c failed, in words a person or a model reads; params name its
// args, in order.
export const contractErrorText = (c, error, params = []) => {
	if (!(error instanceof ContractError)) return String(error?.message ?? error);
	const op = error.operation;
	const spec = specOf(c);
	const words = error.issues.map((issue) => {
		if (issue === "unknown") return `there's no ${op}`;
		if (issue === "not-pure") return `${op} can't run as a pure message`;
		if (issue === "args") return `${op} takes ${params.length} arguments`;
		if (issue.startsWith("arg:")) {
			const i = Number(issue.slice(4));
			const type = (spec?.on[op] ?? spec?.queries?.[op])?.args?.[i];
			return `${params[i] ?? `argument ${i + 1}`} isn't ${type ? typeWords(type) : "valid"}`;
		}
		if (issue === "pre")
			return `it can't run with these arguments now${error.detail ? `: ${error.detail}` : ""}`;
		if (issue === "post") return `${op} didn't do what it promises, so nothing changed`;
		if (issue.startsWith("invariant:"))
			return `it would break ${issue.slice(10)}, so nothing changed`;
		if (issue === "returns") return `${op} gave back something it shouldn't`;
		return issue;
	});
	return words.join("; ");
};

// c with its content replaced by value, through its load: { next }, or { error } saying why
// value doesn't fit. On a draft (in a handler) it changes the draft.
export const loadData = (c, value, what = "the data") => {
	try {
		return { next: apply(c, dataOf(c).load, value) };
	} catch (error) {
		return { error: contractErrorText(c, error, [what]) };
	}
};

// c after loading its sample name (c itself for "empty" or none).
export const withSample = (c, name) => {
	const meta = dataOf(c);
	if (name === null || name === "empty") return c;
	if (!Object.hasOwn(meta.samples, name)) throw new Error(`no sample ${name}`);
	return apply(c, meta.load, meta.samples[name]);
};
// The choices a component that has data samples starts from: empty, then its samples.
export const sampleChoices = (spec, scope = undefined) => {
	const names = hasDataMeta(spec) ? Object.keys(dataOf(spec, scope).samples) : [];
	return names.length === 0
		? []
		: [{ id: "empty", title: "Empty" }, ...names.map((id) => ({ id, title: id }))];
};
