// Plain language for tutuca values: what a node shows in its readable view, as
// { title, detail }. The code view shows them as src/dev/formatters.js prints them.
import {
	AnyType,
	ArrayType,
	AskTask,
	AstNode,
	BooleanType,
	ComponentSpec,
	ComponentType,
	DispatchPath,
	EnumType,
	EventTask,
	Frame,
	IndexType,
	MapType,
	MessageContext,
	NotifyTask,
	NumberType,
	OptionType,
	RecordType,
	RenderContext,
	Scope,
	Selector,
	StringType,
	specOf,
	Target,
	Task,
	UnionType,
	UpdatePath,
} from "../tutuca.js";
import { truncate } from "./jsonml.js";

const MAX = 40;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quote = (s) => `“${truncate(String(s), MAX)}”`;
// specOf alone isn't enough: a Proxy may answer any key.
export const isTutucaComponent = (v) => specOf(v) instanceof ComponentSpec;

// A value in a few words: "“hello”", "42", "3 items", "Tab".
const brief = (v) => {
	if (typeof v === "string") return quote(v);
	if (v === null || v === undefined) return "nothing";
	if (typeof v === "function") return `function ${v.name || "(anonymous)"}`;
	if (typeof v !== "object") return String(v);
	if (isTutucaComponent(v)) return specOf(v).name;
	if (Array.isArray(v)) return v.length === 0 ? "empty list" : `list of ${v.length}`;
	if (v instanceof Map || v instanceof Set) return plural(v.size, "item");
	return plural(Object.keys(v).length, "entry", "entries");
};

const frameWords = (frame) => [
	...(frame.provider === null ? [] : [`provided ${frame.provider.name}`]),
	...frame.accessKeys.map(String),
];
const opWords = (op) =>
	op.t === "field"
		? [op.name]
		: op.t === "item"
			? [op.name, String(op.key)]
			: [op.name, `item at ${op.keyName}`];
const pathWordList = (path) => {
	if (path instanceof UpdatePath) return path.keys.map(String);
	if (path instanceof Selector) return path.ops.flatMap(opWords);
	if (path instanceof Target) return [...pathWordList(path.base), ...pathWordList(path.selector)];
	return path.frames.flatMap(frameWords);
};
// "tabs → 1 → child", or "the root".
const pathWords = (path) => {
	const words = pathWordList(path);
	return words.length === 0 ? "the root" : words.join(" → ");
};

const CONSTRAINTS = {
	int: () => "whole",
	min: (n) => `at least ${n}`,
	max: (n) => `at most ${n}`,
	minLength: (n) => (n === 0 ? "" : `at least ${n} long`),
	maxLength: (n) => (n === Number.POSITIVE_INFINITY ? "" : `at most ${n} long`),
	pattern: (re) => `matching ${re}`,
	where: (preds) => preds.map((p) => `where ${p.name || "a check"} holds`).join(", "),
};
// "list of whole number", "one of grey, red", "Tab component or nothing".
const typeWords = (type) => {
	if (type instanceof OptionType) return `${typeWords(type.valueType)} or nothing`;
	if (type instanceof StringType) return "text";
	if (type instanceof BooleanType) return "true or false";
	if (type instanceof NumberType) return type.constraints.int ? "whole number" : "number";
	if (type instanceof EnumType) return `one of ${type.members.map(String).join(", ")}`;
	if (type instanceof ArrayType) return `list of ${typeWords(type.valueType)}`;
	if (type instanceof MapType) return `map of ${typeWords(type.valueType)}`;
	if (type instanceof RecordType) return `record of ${Object.keys(type.shape).join(", ")}`;
	if (type instanceof UnionType) return `either ${type.types.map(typeWords).join(" or ")}`;
	if (type instanceof IndexType) return `a key of ${type.fieldName}`;
	if (type instanceof ComponentType)
		return type.names.length === 0 ? "any component" : `${type.names.join(" or ")} component`;
	return "anything";
};
const typeDetail = (type) => {
	const parts = Object.entries(type.constraints)
		.filter(([key]) => key !== "int")
		.map(([key, value]) => CONSTRAINTS[key]?.(value) ?? key)
		.filter(Boolean);
	const { defaultValue } = type;
	if (defaultValue !== undefined && defaultValue !== null && typeof defaultValue !== "function") {
		parts.push(`default ${brief(defaultValue)}`);
	}
	return parts.join(", ");
};

const sourceWords = (node) => (node instanceof AstNode ? astTitle(node) : brief(node));
const astTitle = (node) => {
	switch (node.constructor.kind) {
		case "element":
			return `<${node.tagName}> element`;
		case "field":
			return `the field ${quote(node.name)}`;
		case "seqItem":
			return `the ${node.seqName} item at ${quote(node.keyName)}`;
		case "provided":
			return `the provided ${quote(node.name)}`;
		case "constant":
			return brief(node.value);
		case "render":
			return `renders ${sourceWords(node.source)}${node.viewName ? ` as ${quote(node.viewName)}` : ""}`;
		case "renderIt":
			return "renders the current item";
		case "renderEach":
			return `renders each of ${sourceWords(node.source)}`;
		case "each":
			return `repeats for each of ${sourceWords(node.source)}`;
		case "cond":
			return `if ${sourceWords(node.source)}`;
		case "pushView":
			return `uses the view ${sourceWords(node.viewNameVal)} inside`;
		case "scope":
			return `with the bindings of ${quote(node.scopeName)}`;
		case "action":
			return `sends ${quote(node.name)}`;
		case "targetValue":
			return "the value of the event's target";
		case "sourceKey":
			return "the key the event came from";
		case "dragKey":
			return "the key the dragged element came from";
		case "lookupBind":
			return `the binding ${quote(node.name)}`;
		default:
			return node.constructor.name;
	}
};
const astDetail = (node) => {
	switch (node.constructor.kind) {
		case "element": {
			const parts = [];
			if (node.attrs.length > 0) parts.push(plural(node.attrs.length, "attribute"));
			if (node.childs.length > 0) parts.push(plural(node.childs.length, "child", "children"));
			if (node.handlers.length > 0)
				parts.push(`handles ${node.handlers.map((h) => h.name).join(", ")}`);
			return parts.join(" · ");
		}
		case "each":
		case "renderEach":
			return node.loopName ? `with the loop ${quote(node.loopName)}` : "";
		case "action":
			return node.args.length === 0 ? "" : `with ${plural(node.args.length, "argument")}`;
		default:
			return "";
	}
};
// Each kind of task: the noun a summary titles it with and the verb a formatter shows.
const TASKS = [
	[EventTask, "event", "event"],
	[AskTask, "ask", "ask"],
	[NotifyTask, "notification", "notify"],
	[Task, "message", "send"],
];
const taskWords = (task) => TASKS.find(([Kind]) => task instanceof Kind);
export const taskVerb = (task) => taskWords(task)[2];

export const summarize = (v) => {
	try {
		return summarizeUnsafe(v);
	} catch {
		return { title: brief(v), detail: "" }; // e.g. a revoked immer draft
	}
};
const summarizeUnsafe = (v) => {
	if (isTutucaComponent(v)) {
		const fields = Object.keys(specOf(v).fields);
		const shown = fields.slice(0, 3).map((k) => `${k} ${brief(v[k])}`);
		return {
			title: `${specOf(v).name}`,
			detail: [...shown, ...(fields.length > 3 ? ["…"] : [])].join(" · "),
		};
	}
	if (v instanceof ComponentSpec) {
		const n = (o) => Object.keys(o).length;
		const parts = [
			plural(n(v.fields), "field"),
			plural(n(v.views), "view"),
			plural(n(v.on), "message"),
		];
		if (n(v.invariants) > 0) parts.push(plural(n(v.invariants), "invariant"));
		return { title: `${v.name} component`, detail: parts.join(" · ") };
	}
	if (v instanceof AnyType) return { title: typeWords(v), detail: typeDetail(v) };
	if (v instanceof AstNode) return { title: astTitle(v), detail: astDetail(v) };
	if (v instanceof DispatchPath || v instanceof UpdatePath)
		return { title: "path", detail: pathWords(v) };
	if (v instanceof Selector) return { title: "selector", detail: pathWords(v) };
	if (v instanceof Target) return { title: "target", detail: pathWords(v) };
	if (v instanceof Frame) return { title: "frame", detail: frameWords(v).join(" → ") || "nothing" };
	if (v instanceof Task) {
		const [, kind] = taskWords(v);
		const where = v.to?.path ?? v.target;
		const to = where === null ? "the ancestors" : pathWords(where);
		const from = v.from.isHost ? "the host" : pathWords(v.from.path);
		return {
			title: `${kind} ${quote(v.name)}`,
			detail: from === to ? `to ${to}` : `from ${from} to ${to}`,
		};
	}
	if (v instanceof MessageContext)
		return { title: "message context", detail: `at ${pathWords(v.path)}` };
	if (v instanceof Scope) {
		const names = Object.keys(v.byName);
		return {
			title: "scope",
			detail: `${plural(names.length, "component")}${v.parent === null ? "" : " · inside another scope"}`,
		};
	}
	if (v instanceof RenderContext)
		return {
			title: "render context",
			detail: `${specOf(v.component)?.name ?? "?"} at depth ${v.depth}`,
		};
	return { title: brief(v), detail: "" };
};
