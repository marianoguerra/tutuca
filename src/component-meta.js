// Metadata: what a component says about itself to whoever hosts it (a canvas's default size, a
// title, an icon), static and plain data. Each key is a URI, a namespace so conventions don't
// clash; a scope can register a schema for one, a shape of field types (key -> Type), against
// which the components registered there are checked and from which metaOf fills defaults.
import { isRecord } from "./schema.js";
import { scopeOf, specOf } from "./spec.js";

const emptyMeta = Object.freeze(Object.create(null));
const noMeta = Object.freeze({});
export const toMeta = (name, meta) => {
	if (meta === undefined) return emptyMeta;
	if (!isRecord(meta)) throw new Error(`Component ${name}: meta must be an object`);
	const out = Object.create(null);
	for (const uri of Object.keys(meta)) {
		if (!URL.canParse(uri)) throw new Error(`Component ${name}: meta key ${uri} isn't a URI`);
		if (!isRecord(meta[uri])) {
			throw new Error(`Component ${name}: meta ${uri} must be an object`);
		}
		out[uri] = Object.freeze({ ...meta[uri] });
	}
	return Object.freeze(out);
};
// What values, the meta spec gives under uri, break of shape, as messages.
export const metaProblems = (uri, values, shape, scope = null) => {
	const problems = [];
	for (const key of Object.keys(values)) {
		if (!Object.hasOwn(shape, key)) problems.push(`its meta ${uri} has no key ${key}`);
	}
	for (const key in shape) {
		const type = shape[key];
		if (Object.hasOwn(values, key)) {
			if (!type.isValid(values[key], scope)) {
				problems.push(`its meta ${uri} ${key} isn't ${type.text()}`);
			}
			continue;
		}
		try {
			type.make(undefined, scope);
		} catch {
			problems.push(`its meta ${uri} lacks ${key}, which has no default`);
		}
	}
	return problems;
};
// What c (a component or its spec) says under uri, over the defaults of the schema scope (c's
// own by default) has for uri: every key of a registered schema, else what c gives ({} for none).
export const metaOf = (c, uri, scope = scopeOf(c)) => {
	const given = (specOf(c) ?? c)?.meta?.[uri] ?? noMeta;
	const shape = scope?.lookupMetaSchema(uri) ?? null;
	return shape === null ? given : Object.freeze(Object.assign(defaultsOf(shape, scope), given));
};
// The default of each key of shape that has one.
const defaultsOf = (shape, scope) => {
	const out = {};
	for (const key in shape) {
		try {
			out[key] = shape[key].make(undefined, scope);
		} catch {} // No default: only what c gives.
	}
	return out;
};
const deepFreeze = (v) => {
	if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
		Object.freeze(v);
		for (const k of Object.keys(v)) deepFreeze(v[k]);
	}
	return v;
};
// metaOf over shape's defaults, so every key is there even where no scope registered shape: a
// copy, deep frozen.
export const filledMeta = (c, uri, shape, scope = undefined) =>
	deepFreeze(structuredClone({ ...defaultsOf(shape, scope), ...metaOf(c, uri, scope) }));
// Whether c (a component or its spec) says anything under uri.
export const hasMeta = (c, uri) => Object.hasOwn((specOf(c) ?? c)?.meta ?? {}, uri);
// What's wrong with the shape of what c's spec says under uri, checked against shape; none
// when it says nothing there.
export const metaShapeProblems = (spec, uri, shape) =>
	hasMeta(spec, uri) ? metaProblems(uri, spec.meta[uri], shape) : [];
