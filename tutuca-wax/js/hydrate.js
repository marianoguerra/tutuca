// Components as JSON and back: hydrate makes the components a JSON value
// describes, in a scope, and capture describes a component tree the same way,
// so what the playground and the studio keep is what to make, not the state.
//
// { $make: Type, fields: {...} } is a component of the type registered as
// Type, made with those fields (themselves hydrated); { $json: v } is the
// components/json tree for the JSON value v. Anything else is itself, with
// its items and entries hydrated.
import { fromJson } from "./json-example.js";

export const hydrate = (runtime, scope, v) => {
	if (Array.isArray(v)) return v.map((x) => hydrate(runtime, scope, x));
	if (v !== null && typeof v === "object") {
		if ("$make" in v) return runtime.make(scope, v.$make, hydrate(runtime, scope, v.fields ?? {}));
		if ("$json" in v) return fromJson(runtime, scope, v.$json);
		return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hydrate(runtime, scope, x)]));
	}
	return v;
};

// Wasm-gc objects (components) reach JS as objects with a null prototype.
const isWasm = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === null;

// What hydrate makes v from in scope: each component by the name it's made
// by there (runtime.nameIn, which a rename may make other than its typeName),
// with its schema's fields, not its computed properties. Fields that sync at
// no level (@sync(none): an open menu, text being typed) are left to their
// defaults, as tutuca's local level keeps a layout. A type without a schema is
// only its name.
export const capture = (runtime, scope, v) => {
	if (isWasm(v)) {
		const name = runtime.nameIn(scope, v);
		if (name === null) throw new Error(`No name makes a ${runtime.typeName(v)} from this scope`);
		const schema = runtime.schema(v);
		if (schema === null) return { $make: name };
		const fields = {};
		for (const f of schema.fields) {
			if (f.sync !== "none") fields[f.name] = capture(runtime, scope, runtime.get(v, f.name));
		}
		return { $make: name, fields };
	}
	if (Array.isArray(v)) return v.map((x) => capture(runtime, scope, x));
	if (v !== null && typeof v === "object") {
		return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, capture(runtime, scope, x)]));
	}
	return v;
};
