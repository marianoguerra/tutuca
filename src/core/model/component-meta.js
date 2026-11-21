// Metadata: what a component says about itself to whoever hosts it (a canvas's default size, a
// title, an icon), static and plain data. Each key is a URI, a namespace so conventions don't
// clash; a scope can register a schema for one, a shape of field types (key -> Type), against
// which the components registered there are checked and from which metaOf fills defaults.

import { scopeOf, specOrSelf } from "./spec.js";
import {
	ArrayType,
	compileShape,
	deepFreeze,
	isRecord,
	MapType,
	OptionType,
	RecordType,
	Type,
	unlessNoDefault,
} from "./types.js";

// A shape (key -> type) compiled, once per shape: a registered schema already is.
const compiled = new WeakMap();
const shapeTypes = (shape) => {
	if (Object.values(shape).every((v) => v instanceof Type)) return shape;
	let out = compiled.get(shape);
	if (out === undefined) {
		out = compileShape(shape, undefined, "meta schema");
		compiled.set(shape, out);
	}
	return out;
};

const emptyMeta = Object.freeze({});
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
// value as meta written by hand is read, of type: a record's keys left out take their defaults,
// at any depth, as a meta's own keys do (those with none stay out, for the check to report).
// What isn't a record where type says one is stays as it is.
const withDefaults = (type, value, scope = null) => {
	if (value === null || value === undefined) return value;
	if (type instanceof OptionType) return withDefaults(type.valueType, value, scope);
	if (type instanceof ArrayType && Array.isArray(value)) {
		return value.map((v) => withDefaults(type.valueType, v, scope));
	}
	if (type instanceof MapType && isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, withDefaults(type.valueType, v, scope)]),
		);
	}
	if (type instanceof RecordType && isRecord(value)) {
		const out = {};
		for (const key in type.shape) {
			if (Object.hasOwn(value, key)) out[key] = withDefaults(type.shape[key], value[key], scope);
			else {
				unlessNoDefault(
					() => {
						out[key] = type.shape[key].make(undefined, scope);
					},
					() => {},
				);
			}
		}
		for (const key of Object.keys(value)) if (!Object.hasOwn(out, key)) out[key] = value[key];
		return out;
	}
	return value;
};
// values with every key's defaults filled in below its top level (withDefaults).
const filledValues = (shape, values, scope) => {
	const out = {};
	for (const key of Object.keys(values)) {
		out[key] = Object.hasOwn(shape, key)
			? withDefaults(shape[key], values[key], scope)
			: values[key];
	}
	return out;
};
// What values, the meta spec gives under uri, break of shape, as messages. A record's keys with a
// default may be left out at any depth.
export const metaProblems = (uri, given, shapeData, scope = null) => {
	const shape = shapeTypes(shapeData);
	const values = filledValues(shape, given, scope);
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
		unlessNoDefault(
			() => type.make(undefined, scope),
			() => problems.push(`its meta ${uri} lacks ${key}, which has no default`),
		);
	}
	return problems;
};
// What c (a component or its spec) says under uri, over the defaults of the schema scope (c's
// own by default) has for uri: every key of a registered schema, else what c gives ({} for none).
export const metaOf = (c, uri, scope = scopeOf(c)) => {
	const given = specOrSelf(c)?.meta?.[uri] ?? emptyMeta;
	const shape = scope?.lookupMetaSchema(uri) ?? null;
	if (shape === null) return given;
	const filled = filledValues(shapeTypes(shape), given, scope);
	return Object.freeze(Object.assign(defaultsOf(shape, scope), filled));
};
// The default of each key of shape that has one.
const defaultsOf = (shapeData, scope) => {
	const shape = shapeTypes(shapeData);
	const out = {};
	for (const key in shape) {
		unlessNoDefault(
			() => {
				out[key] = shape[key].make(undefined, scope);
			},
			() => {}, // No default: only what c gives.
		);
	}
	return out;
};
// metaOf over shape's defaults, so every key is there even where no scope registered shape: a
// copy, deep frozen.
export const filledMeta = (c, uri, shape, scope = undefined) =>
	deepFreeze(
		structuredClone({
			...defaultsOf(shape, scope),
			...filledValues(shapeTypes(shape), metaOf(c, uri, scope), scope),
		}),
	);
// Whether c (a component or its spec) says anything under uri.
export const hasMeta = (c, uri) => Object.hasOwn(specOrSelf(c)?.meta ?? emptyMeta, uri);
// What's wrong with the shape of what c's spec says under uri, checked against shape; none
// when it says nothing there.
export const metaShapeProblems = (spec, uri, shape) =>
	hasMeta(spec, uri) ? metaProblems(uri, spec.meta[uri], shape) : [];
