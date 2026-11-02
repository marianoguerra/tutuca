// The tools a model is offered for an agent, in pi-ai's Tool shape ({ name, description,
// parameters: JSON Schema }). A message tool's parameters come from its handler's args types, a
// view tool's from its query's (each where typed, else from its params), a module tool's from its params; the shared tools are the same for every agent.
import { specOf } from "../../../src/tutuca.js";
import { SHARED_TOOLS } from "./shared-tools.js";

// t.any() lists every JSON type rather than leaving type out: some providers' tool-call parsers
// (GLM's, through OpenRouter) JSON-decode an argument only when its schema's type isn't string,
// and with no type they hand an object over as its JSON text.
const ANY_TYPES = ["object", "array", "string", "number", "boolean", "null"];
const ANY_DESCRIPTION =
	"Any JSON value as itself: an object, array, string, number, boolean or null. Don't encode it as a JSON string.";
// A t type as JSON Schema.
export const typeSchema = (type) => {
	switch (type?.constructor?.kind) {
		case "string": {
			const s = { type: "string" };
			const { minLength, maxLength, pattern } = type.constraints;
			if (minLength > 0) s.minLength = minLength;
			if (maxLength !== undefined && maxLength !== Infinity) s.maxLength = maxLength;
			if (pattern instanceof RegExp) s.pattern = pattern.source;
			return s;
		}
		case "boolean":
			return { type: "boolean" };
		case "number": {
			const s = { type: type.constraints.int ? "integer" : "number" };
			if (type.constraints.min !== undefined) s.minimum = type.constraints.min;
			if (type.constraints.max !== undefined) s.maximum = type.constraints.max;
			return s;
		}
		case "enum":
			return { enum: [...type.members] };
		case "option":
			return { anyOf: [typeSchema(type.valueType), { type: "null" }] };
		case "array":
			return { type: "array", items: typeSchema(type.valueType) };
		case "map":
			return { type: "object", additionalProperties: typeSchema(type.valueType) };
		case "record":
			return {
				type: "object",
				properties: Object.fromEntries(
					Object.entries(type.shape).map(([k, v]) => [k, typeSchema(v)]),
				),
				required: Object.keys(type.shape),
			};
		case "oneOf":
			return { anyOf: type.types.map(typeSchema) };
		case "index":
			return { type: ["integer", "string"] };
		case "any":
			return { type: ANY_TYPES, description: ANY_DESCRIPTION };
		default:
			return {};
	}
};

// A tool's params as [{ name, schema, description }]: a param is a name, or { name, type?,
// description? } with type a JSON Schema type name or a JSON Schema.
export const paramsOf = (tool, argTypes) =>
	(tool.params ?? []).map((p, i) => {
		const { name, type, description } = typeof p === "string" ? { name: p } : p;
		let schema = argTypes?.[i] !== undefined ? typeSchema(argTypes[i]) : {};
		if (typeof type === "string") schema = { type };
		else if (type !== null && typeof type === "object") schema = type;
		return { name, schema: description ? { ...schema, description } : schema };
	});

const objectSchema = (params) => ({
	type: "object",
	properties: Object.fromEntries(params.map((p) => [p.name, p.schema])),
	required: params.map((p) => p.name),
});

// The handler spec of a message tool on root, or undefined.
export const handlerOf = (root, name) => specOf(root)?.on?.[name];
// The query spec of a view tool on root, or undefined.
export const queryOf = (root, name) => specOf(root)?.queries?.[name];

// Every tool of agent, with root the agent's root component, as pi-ai Tools.
export const toolsFor = (agent, root) => [
	...agent.tools.map((tool) => ({
		name: tool.name,
		description:
			`${tool.description ?? ""}${tool.kind === "view" ? " (reads, changes nothing)" : ""}`.trim(),
		parameters: objectSchema(
			paramsOf(
				tool,
				tool.kind === "message"
					? handlerOf(root, tool.name)?.args
					: tool.kind === "view"
						? queryOf(root, tool.name)?.args
						: undefined,
			),
		),
	})),
	...SHARED_TOOLS.map(({ name, description, params }) => ({
		name,
		description,
		parameters: objectSchema(paramsOf({ params })),
	})),
];

// The positional args for a tool call's named arguments.
// An argument the model left out is null, so an optional one can be typed t.option(...).
export const argsFor = (tool, argsObject = {}) =>
	(tool.params ?? []).map((p) => argsObject?.[typeof p === "string" ? p : p.name] ?? null);
