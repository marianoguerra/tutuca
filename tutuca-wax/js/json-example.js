// The components of components/json for a JSON value, made in scope
// (fromJson in tutuca's components/json): what the demos and the playground
// show the JSON editor with.
export const fromJson = (runtime, scope, v) => {
	const make = (type, fields = {}) => runtime.make(scope, type, fields);
	const of = (x) => fromJson(runtime, scope, x);
	if (v === null) return make("JsonNull");
	if (typeof v === "boolean") return make("JsonBool", { value: v });
	if (typeof v === "number") return make("JsonNumber", { value: v, text: String(v) });
	if (typeof v === "string") return make("JsonString", { value: v });
	if (Array.isArray(v)) return make("JsonArray", { items: v.map(of) });
	return make("JsonObject", { entries: Object.entries(v).map(([key, x]) => make("JsonEntry", { key, value: of(x) })) });
};
