// The data meta convention: a component's whole content as plain JSON. It names a pure message
// of one arg that replaces the content (load), a zero-arg query that reads it back as what load
// takes (data), the JSON Schema of that arg (derived from its type unless given), and samples to
// start from. Whatever sets a component from data reads it: a file dropped on it, an agent's
// get_state and set_state, a canvas hole's samples. The law: load(data) reads back as data.
//
// A component declares it with component({ meta: { [DATA_META]: { load, data, ... } } }); a
// scope that registers dataMetaSchemas checks its shape, and dataProblems checks what the shape
// can't: that load and data name a message and a query the component has, of the right kind.
import {
	apply,
	filledMeta,
	HandlerSpec,
	hasMeta,
	metaShapeProblems,
	QuerySpec,
	specOf,
	t,
} from "../tutuca.js";
import { contractErrorText } from "./errors.js";
import { typeSchema } from "./json-schema.js";

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
		// The file its data is, when it's text (load takes a string, the file's text as is):
		// its mime type and extensions, the first one its name's; null for a JSON file.
		file: t.option(t.record({ type: t.string(), extensions: t.array(t.string().len(2)).len(1) })),
	},
};
// The file a component's data is when its data meta names none: JSON.
export const JSON_FILE = Object.freeze({
	type: "application/json",
	extensions: Object.freeze([".json"]),
	json: true,
});

// What c (a component or, with scope, its spec) says about its data, with every key filled.
export const dataOf = (c, scope = undefined) =>
	filledMeta(c, DATA_META, dataMetaSchemas[DATA_META], scope);
// The file c's data reads and saves as: { type, extensions, json }, json when it's JSON's.
export const fileFormatOf = (c, scope = undefined) => {
	const { file } = dataOf(c, scope);
	return file === null ? JSON_FILE : { ...file, json: false };
};
// Whether c (a component or its spec) says what its data is.
export const hasDataMeta = (c) => hasMeta(c, DATA_META);

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
	const shape = metaShapeProblems(spec, DATA_META, dataMetaSchemas[DATA_META]);
	if (shape.length > 0) return shape;
	const meta = dataOf(c, scope);
	const problems = [];
	const load = loadMessage(spec, meta.load);
	if (load === null) problems.push(`its data load ${meta.load} isn't a pure message of one arg`);
	if (meta.data !== null && !isZeroArgQuery(spec, meta.data)) {
		problems.push(`its data ${meta.data} isn't a zero-arg query`);
	}
	const arg = load?.args[0];
	if (meta.file !== null && arg !== undefined && arg.constructor?.kind !== "string") {
		problems.push(
			`its data is a ${meta.file.extensions[0]} file, but ${meta.load} doesn't take a string`,
		);
	}
	return problems;
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
