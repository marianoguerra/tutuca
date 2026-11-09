// Plain language for tutuca values: what a node shows in its readable view, as
// { title, detail }. The code view shows them as src/dev/formatters.js prints them.

import { truncate } from "../core/host/text.js";
import {
	ArrayType,
	AskTask,
	BooleanType,
	ComponentSpec,
	ComponentType,
	EnumType,
	HostTask,
	IndexType,
	KeyPath,
	MapType,
	NotifyTask,
	NumberType,
	OneOfType,
	OptionType,
	RecordType,
	Selector,
	StringType,
	specOf,
	Target,
	Task,
	ViewNode,
} from "../tutuca.js";

const MAX = 40;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quote = (s) => `“${truncate(String(s), MAX)}”`;
// specOf alone isn't enough: a Proxy may answer any key.
export const isTutucaComponent = (v) => specOf(v) instanceof ComponentSpec;

// A value in a few words: "“hello”", "42", "3 items", "Tab".
export const brief = (v) => {
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
	if (path instanceof KeyPath) return path.keys.map(String);
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
	if (type instanceof OneOfType) return `either ${type.types.map(typeWords).join(" or ")}`;
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

const EVENT_ARG_TITLES = {
	targetValue: "the value of the event's target",
	sourceKey: "the key the event came from",
	dragKey: "the key the dragged element came from",
};
const sourceWords = (node) => (node instanceof ViewNode ? astTitle(node) : brief(node));
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
			return `if ${sourceWords(node.test)}`;
		case "pushView":
			return `uses the view ${sourceWords(node.source)} inside`;
		case "withBinds":
			return `with the bindings of ${quote(node.bindsName)}`;
		case "send":
			return `sends ${quote(node.name)}`;
		case "eventArg":
			return EVENT_ARG_TITLES[node.name];
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
			if (node.children.length > 0) parts.push(plural(node.children.length, "child", "children"));
			if (node.handlers.length > 0)
				parts.push(`handles ${node.handlers.map((h) => h.type).join(", ")}`);
			return parts.join(" · ");
		}
		case "each":
		case "renderEach":
			return node.loopName ? `with the loop ${quote(node.loopName)}` : "";
		case "send":
			return node.args.length === 0 ? "" : `with ${plural(node.args.length, "argument")}`;
		default:
			return "";
	}
};
// Each kind of task: the noun a summary titles it with and the verb a formatter shows.
// A message from the host is an event when a DOM event sent it.
const TASKS = [
	[(task) => task instanceof HostTask && task.event !== null, "event", "event"],
	[(task) => task instanceof AskTask, "ask", "ask"],
	[(task) => task instanceof NotifyTask, "notification", "notify"],
	[(task) => task instanceof Task, "message", "send"],
];
const taskWords = (task) => TASKS.find(([is]) => is(task));
export const taskVerb = (task) => taskWords(task)[2];
const issueWords = (record) =>
	record.issues.length === 0 ? [] : [plural(record.issues.length, "issue")];

// What each kind of tutuca value says of itself, as { title, detail }: the summary of its kind
// in formatters.js's KINDS, which tells the kinds apart.
export const SUMMARIES = {
	component(v) {
		const fields = Object.keys(specOf(v).fields);
		const shown = fields.slice(0, 3).map((k) => `${k} ${brief(v[k])}`);
		return {
			title: `${specOf(v).name}`,
			detail: [...shown, ...(fields.length > 3 ? ["…"] : [])].join(" · "),
		};
	},
	spec(v) {
		const n = (o) => Object.keys(o).length;
		const parts = [
			plural(n(v.fields), "field"),
			plural(n(v.views), "view"),
			plural(n(v.on), "message"),
		];
		if (n(v.invariants) > 0) parts.push(plural(n(v.invariants), "invariant"));
		return { title: `${v.name} component`, detail: parts.join(" · ") };
	},
	type: (v) => ({ title: typeWords(v), detail: typeDetail(v) }),
	viewNode: (v) => ({ title: astTitle(v), detail: astDetail(v) }),
	path: (v) => ({ title: "path", detail: pathWords(v) }),
	selector: (v) => ({ title: "selector", detail: pathWords(v) }),
	target: (v) => ({ title: "target", detail: pathWords(v) }),
	frame: (v) => ({ title: "frame", detail: frameWords(v).join(" → ") || "nothing" }),
	task(v) {
		const [, kind] = taskWords(v);
		const where = v.to?.path ?? v.target;
		const to = where === null ? "the ancestors" : pathWords(where);
		const from = v.from.isHost ? "the host" : pathWords(v.from.path);
		return {
			title: `${kind} ${quote(v.name)}`,
			detail: from === to ? `to ${to}` : `from ${from} to ${to}`,
		};
	},
	// What became of a task: "send “toggle” handled", and where it went.
	transition(v) {
		const to = v.to === null ? "nowhere" : v.to.isHost ? "the host" : pathWords(v.to.path);
		return {
			title: `${v.mode} ${quote(v.name)} ${v.outcome}`,
			detail: [`to ${to}`, ...issueWords(v)].join(" · "),
		};
	},
	hostEvent: (v) => ({ title: `host event ${v.type}`, detail: issueWords(v).join("") }),
	messageContext: (v) => ({ title: "message context", detail: `at ${pathWords(v.path)}` }),
	scope(v) {
		const names = Object.keys(v.specs);
		return {
			title: "scope",
			detail: `${plural(names.length, "component")}${v.parent === null ? "" : " · inside another scope"}`,
		};
	},
	renderContext: (v) => ({
		title: "render context",
		detail: `${specOf(v.component)?.name ?? "?"} at depth ${v.depth}`,
	}),
};
