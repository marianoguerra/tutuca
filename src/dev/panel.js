// Tutuca components that show in a page what the DevTools formatters of src/dev/formatters.js show
// in the console: a component's fields and spec, field types, views, paths, tasks, scopes
// and render contexts, each node expanding into its rows. The main views say it in plain
// words (summary.js); the code views print it as formatters.js does.

import {
	$if,
	ComponentSpec,
	component,
	each,
	field,
	lookupBind,
	pushView,
	render,
	renderEach,
	scopeOf,
	send,
	t,
	tag,
} from "../tutuca.js";
import { describe, isObject, S } from "./formatters.js";
import { truncate } from "./jsonml.js";
import { summarize } from "./summary.js";

const { button, div, h3, li, p, section, span, ul } = tag;

// Live values stay out of the state: a node holds a ref to its value, so immer never walks
// or freezes a spec, scope or task, and the state stays plain data.
const refs = new Map();
const ids = new WeakMap();
let nextRef = 1;
const idOf = (v) => {
	if (!isObject(v)) return 0;
	let id = ids.get(v);
	if (id === undefined) {
		id = nextRef++;
		ids.set(v, id);
		refs.set(id, new WeakRef(v));
	}
	return id;
};
const deref = (id) => refs.get(id)?.deref();

// Classes for the styles of src/dev/formatters.js, by the name it gives them.
const TONES = {
	plain: "",
	name: "font-bold text-warning",
	key: "text-secondary",
	str: "text-success",
	num: "text-info",
	fn: "text-accent",
	muted: "opacity-60",
};
const TONE_OF_STYLE = new Map(Object.entries(S).map(([tone, style]) => [style, tone]));
const MAX_TEXT = 60;

// JsonML parts as { text, tone } tokens; adjacent tokens of one tone merge.
const tokensOf = (parts) => {
	const tokens = [];
	const add = (text, tone) => {
		const last = tokens.at(-1);
		if (last?.tone === tone) last.text += text;
		else tokens.push({ text, tone });
	};
	const visit = (part, tone) => {
		if (typeof part === "string") return add(part, tone);
		if (!Array.isArray(part)) return add(String(part), tone);
		const [tag, attrs, ...kids] = part;
		if (tag === "object") return add("{…}", "muted");
		const own = TONE_OF_STYLE.get(attrs?.style) ?? tone;
		for (const kid of kids) visit(kid, own);
	};
	for (const part of parts) visit(part, "plain");
	return tokens;
};
const primTokens = (v) => {
	if (typeof v === "string") return [{ text: truncate(JSON.stringify(v), MAX_TEXT), tone: "str" }];
	if (typeof v === "function") return [{ text: `ƒ ${v.name}`, tone: "fn" }];
	if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
		return [{ text: String(v), tone: "num" }];
	}
	return [{ text: String(v), tone: "muted" }];
};
const entriesOf = (v) => {
	if (v instanceof Map) return [...v.entries()].map(([k, x]) => ({ label: String(k), value: x }));
	if (v instanceof Set) return [...v].map((x, i) => ({ label: String(i), value: x }));
	return Object.keys(v).map((k) => ({ label: k, value: v[k] }));
};
const safeDescribe = (v) => {
	try {
		return describe(v);
	} catch {
		return null; // e.g. a revoked immer draft
	}
};
// What a node shows for v: header tokens, and rows as { label, value } to expand into nodes
// or { label, tokens } leaves.
export const inspect = (v) => {
	if (!isObject(v) || typeof v === "function") return { tokens: primTokens(v), rows: [] };
	const described = safeDescribe(v);
	if (described !== null) {
		// A spec's field types expand as types, so the readable view can name them.
		const fields = v instanceof ComponentSpec ? v.fields : {};
		const rows = described.rows.map(([label, value]) =>
			Object.hasOwn(fields, label)
				? { label, value: fields[label] }
				: value[0] === "object"
					? { label: label ?? "", value: value[1].object }
					: { label: label ?? "", tokens: tokensOf([value]) },
		);
		return { tokens: tokensOf(described.header), rows };
	}
	const rows = entriesOf(v);
	const name = Array.isArray(v) ? `Array(${v.length})` : (v.constructor?.name ?? "Object");
	const size = v instanceof Map || v instanceof Set ? `(${v.size})` : "";
	return { tokens: [{ text: `${name}${size}`, tone: "muted" }], rows };
};

const TONE_NAMES = Object.keys(TONES);
// A node for value, labelled; it computes its rows only when opened.
export const devNode = (C, label, value) => {
	const { tokens, rows } = inspect(value);
	const { title, detail } = summarize(value);
	return C.DevNode({ label, tokens, title, detail, ref: idOf(value), canOpen: rows.length > 0 });
};
// A row with nothing to expand reads the same either way.
const leafNode = (C, label, tokens) =>
	C.DevNode({ label, tokens, title: tokens.map((t) => t.text).join("") });

const expander = $if(
	field("canOpen"),
	button(
		{
			type: "button",
			class: "w-3 shrink-0 cursor-pointer opacity-60 hover:opacity-100",
			"aria-label": "Expand",
			"@on.click": send("toggle"),
		},
		$if(field("isOpen"), "▾", "▸"),
	),
	span({ class: "w-3 shrink-0" }),
);
export const DevNode = component({
	name: "DevNode",
	fields: (t) => ({
		label: t.string(),
		title: t.string(),
		detail: t.string(),
		tokens: t.array(t.record({ text: t.string(), tone: t.enum(...TONE_NAMES) })),
		ref: t.number().int().min(0), // 0 for values with nothing to expand.
		canOpen: t.boolean(),
		isOpen: t.boolean(),
		rows: t.array(t.component("DevNode")),
	}),
	methods: {
		get hasLabel() {
			return this.label !== "";
		},
		get showRows() {
			return this.isOpen && this.rows.length > 0;
		},
		get hasDetail() {
			return this.detail !== "";
		},
	},
	loops: {
		tokens: {
			enrich({ value }) {
				return { tone: TONES[value.tone] };
			},
		},
	},
	views: {
		main: div(
			{ class: "text-sm leading-6" },
			div(
				{ class: "flex items-baseline gap-1.5" },
				expander,
				$if(field("hasLabel"), span({ class: "text-base-content/60" }, field("label")), ""),
				span({ class: "min-w-0 font-medium break-words" }, field("title")),
				$if(
					field("hasDetail"),
					span({ class: "min-w-0 text-xs text-base-content/60 break-words" }, field("detail")),
					"",
				),
			),
			$if(
				field("showRows"),
				div({ class: "ml-1.5 border-l border-base-300 pl-3" }, renderEach(field("rows"))),
				"",
			),
		),
		code: div(
			{ class: "font-mono text-xs leading-5" },
			div(
				{ class: "flex items-baseline gap-1" },
				expander,
				$if(field("hasLabel"), span({ class: "text-secondary" }, field("label"), ":"), ""),
				span(
					{ class: "min-w-0 break-all" },
					each(field("tokens"), span({ class: lookupBind("tone") }, field("text")), "tokens"),
				),
			),
			$if(
				field("showRows"),
				div({ class: "ml-1.5 border-l border-base-300 pl-3" }, renderEach(field("rows"))),
				"",
			),
		),
	},
	on: {
		toggle: {
			args: [],
			post: (prev, next) => next.isOpen !== prev.isOpen,
			run(draft) {
				draft.isOpen = !this.isOpen;
				if (!draft.isOpen || this.rows.length > 0) return;
				const value = deref(this.ref);
				if (value === undefined) return;
				const C = scopeOf(this).components;
				draft.rows = inspect(value).rows.map((row) =>
					row.tokens === undefined
						? devNode(C, row.label, row.value)
						: leafNode(C, row.label, row.tokens),
				);
			},
		},
	},
});

const sectionTitle = "text-xs font-semibold uppercase tracking-wider text-base-content/60";

// A titled list of nodes.
export const DevSection = component({
	name: "DevSection",
	fields: (t) => ({
		title: t.string(),
		emptyText: t.string("Nothing to show."),
		nodes: t.array(t.component("DevNode")),
	}),
	methods: {
		get isEmpty() {
			return this.nodes.length === 0;
		},
	},
	view: section(
		{ class: "flex flex-col gap-1" },
		h3({ class: sectionTitle }, field("title")),
		$if(
			field("isEmpty"),
			p({ class: "text-xs text-base-content/50" }, field("emptyText")),
			div({ class: "flex flex-col" }, renderEach(field("nodes"))),
		),
	),
});

const BADGE = "badge badge-sm shrink-0 whitespace-nowrap font-mono";
const LEVELS = { error: `${BADGE} badge-error`, warning: `${BADGE} badge-warning` };
// The issues of lint() from src/lint/index.js, as plain records.
export const DevLint = component({
	name: "DevLint",
	fields: (t) => ({
		issues: t.array(
			t.record({
				level: t.enum("error", "warning"),
				code: t.string(),
				path: t.string(),
				message: t.string(),
			}),
		),
	}),
	methods: {
		get isClean() {
			return this.issues.length === 0;
		},
	},
	loops: {
		issues: {
			enrich({ value }) {
				return { badge: LEVELS[value.level] };
			},
		},
	},
	view: section(
		{ class: "flex flex-col gap-1" },
		h3({ class: sectionTitle }, "Lint"),
		$if(
			field("isClean"),
			p({ class: "text-xs text-success" }, "Clean"),
			ul(
				{ class: "flex flex-col divide-y divide-base-300" },
				each(
					field("issues"),
					li(
						{ class: "flex min-w-0 flex-col gap-1 py-2 text-xs first:pt-0 last:pb-0" },
						div(
							{ class: "flex flex-wrap items-center gap-2" },
							span({ class: lookupBind("badge") }, field("code")),
							span({ class: "min-w-0" }, field("message")),
						),
						span({ class: "min-w-0 break-all font-mono opacity-60" }, field("path")),
					),
					"issues",
				),
			),
		),
	),
});
export const lintRecords = (issues) =>
	issues.map(({ level, code, path, message }) => ({ level, code, path, message }));

// Dev information about a running app: its state, the tasks that made it, its components
// and their lint issues. update() keeps the nodes whose values didn't change, so what is
// open stays open.
const card = (name) =>
	div({ class: "card border border-base-300 bg-base-100 p-4" }, render(field(name)));
const VIEW_BUTTON = "btn btn-xs join-item";
export const DevPanel = component({
	name: "DevPanel",
	fields: (t) => ({
		view: t.enum("main", "code"),
		state: t.component("DevSection"),
		tasks: t.component("DevSection"),
		specs: t.component("DevSection"),
		lint: t.component("DevLint"),
	}),
	methods: {
		get isCode() {
			return this.view === "code";
		},
	},
	view: div(
		{ class: "flex flex-col gap-3" },
		div(
			{ class: "join self-start", role: "group", "aria-label": "Show as" },
			button(
				{
					type: "button",
					class: $if(field("isCode"), VIEW_BUTTON, `${VIEW_BUTTON} btn-primary`),
					"@on.click": send("setView", "main"),
				},
				"Readable",
			),
			button(
				{
					type: "button",
					class: $if(field("isCode"), `${VIEW_BUTTON} btn-primary`, VIEW_BUTTON),
					"@on.click": send("setView", "code"),
				},
				"Code",
			),
		),
		// Every node below shows the view picked here.
		pushView(
			field("view"),
			div(
				{ class: "grid gap-4 xl:grid-cols-2" },
				div({ class: "flex min-w-0 flex-col gap-4" }, card("state"), card("tasks")),
				div({ class: "flex min-w-0 flex-col gap-4" }, card("specs"), card("lint")),
			),
		),
	),
	on: {
		setView: {
			args: [t.enum("main", "code")],
			run(draft, [view]) {
				draft.view = view;
			},
		},
	},
});

export const makeDevPanel = (C) =>
	C.DevPanel({
		state: C.DevSection({ title: "State" }),
		tasks: C.DevSection({ title: "Tasks", emptyText: "No tasks made this state." }),
		specs: C.DevSection({ title: "Components" }),
		lint: C.DevLint(),
	});

const sameRefs = (nodes, values) =>
	nodes.length === values.length && nodes.every((n, i) => n.ref === idOf(values[i].value));
// Sets section's nodes to { label, value } items, unless they show the same values already.
const updateSection = (C, section, items) => {
	if (sameRefs(section.nodes, items)) return;
	section.nodes = items.map(({ label, value }) => devNode(C, label, value));
};
// data: { state, tasks: [{ label, value }], specs: [spec], issues } for a draft DevPanel.
export const updateDevPanel = (C, draft, { state, tasks, specs, issues }) => {
	updateSection(C, draft.state, [{ label: "", value: state }]);
	updateSection(C, draft.tasks, tasks);
	updateSection(
		C,
		draft.specs,
		specs.map((spec) => ({ label: "", value: spec })),
	);
	draft.lint.issues = lintRecords(issues);
};

export const devComponents = { DevNode, DevSection, DevLint, DevPanel };
export const devClasses = [...Object.values(TONES), ...Object.values(LEVELS)];
