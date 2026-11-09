// DevTools custom formatters for tutuca values (Chrome/Firefox).

import { truncate } from "../core/host/text.js";
import {
	frameOfMarker,
	isComponentMarker,
	isFrameMarker,
	isMarkerOpen,
	MARKER_CLOSE,
	parseMarker,
} from "../core/view/markers.js";
import {
	ComponentSpec,
	DispatchPath,
	ElementNode,
	Frame,
	HostEvent,
	KeyPath,
	MessageContext,
	RenderContext,
	Scope,
	Selector,
	scopeOf,
	specOf,
	Target,
	Task,
	Transition,
	Type,
	typeText,
	ViewNode,
	Walker,
} from "../tutuca.js";
import { install, join, makeFormatter, objectRef, span } from "./jsonml.js";
import { brief, isTutucaComponent, SUMMARIES, taskVerb } from "./summary.js";
import { installVdomFormatters } from "./vdom-formatters.js";

export const STYLES = {
	name: "color:#d97706;font-weight:bold",
	key: "color:#8b5cf6",
	str: "color:#16a34a",
	num: "color:#3b82f6",
	fn: "color:#0891b2",
	muted: "opacity:0.6",
};
const MAX_STR = 30;
const MAX_INLINE_FIELDS = 3;
const MAX_AST_DEPTH = 2;
const MAX_AST_CHILDREN = 3;

export const isObject = (v) => (v !== null && typeof v === "object") || typeof v === "function";
const ref = (v) => (isObject(v) ? objectRef(v) : prim(v));

export const prim = (v) => {
	if (typeof v === "string") return span(STYLES.str, JSON.stringify(truncate(v, MAX_STR)));
	if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
		return span(STYLES.num, String(v));
	}
	if (v === null || v === undefined) return span(STYLES.muted, String(v));
	if (typeof v === "function") return span(STYLES.fn, `ƒ ${v.name}`);
	if (typeof v === "symbol") return span(STYLES.fn, v.toString());
	if (isTutucaComponent(v)) return span(STYLES.name, `‹${specOf(v).name}›`);
	if (Array.isArray(v)) return span(STYLES.muted, `[${v.length}]`);
	return span(STYLES.muted, "{…}");
};

// Prints an AST node like the code that builds it: h("p", {title: field("name")}, …).
class Printer extends Walker {
	out = [];
	depth = 0;
	emit(...parts) {
		this.out.push(...parts);
	}
	arg(v) {
		if (!(v instanceof ViewNode)) return this.emit(prim(v));
		if (this.depth >= MAX_AST_DEPTH) return this.emit(span(STYLES.muted, "…"));
		this.depth++;
		this.visit(v);
		this.depth--;
	}
	call(name, args) {
		while (args.length > 0 && args.at(-1) === undefined) args.pop(); // optional view/loop names
		this.emit(span(STYLES.fn, name), "(");
		args.forEach((a, i) => {
			if (i > 0) this.emit(", ");
			this.arg(a);
		});
		this.emit(")");
	}
	node(node) {
		this.emit(span(STYLES.muted, node.constructor.name));
	}
	field(node) {
		this.call("field", [node.name]);
	}
	seqItem(node) {
		this.call("seqItem", [node.seqName, node.keyName]);
	}
	provided(node) {
		this.call("provided", [node.name]);
	}
	constant(node) {
		this.emit(prim(node.value));
	}
	eventArg(node) {
		this.call(node.name, []);
	}
	lookupBind(node) {
		this.call("lookupBind", [node.name]);
	}
	render(node) {
		this.call("render", [node.source, node.viewName]);
	}
	renderIt(node) {
		this.call("renderIt", [node.viewName]);
	}
	cond(node) {
		this.call("$if", [node.test, node.thenVal, node.elseVal]);
	}
	pushView(node) {
		this.call("pushView", [node.source, node.child]);
	}
	each(node) {
		this.call("each", [node.source, node.child, node.loopName]);
	}
	renderEach(node) {
		this.call("renderEach", [node.source, node.loopName]);
	}
	withBinds(node) {
		this.call("withBinds", [node.bindsName, node.child]);
	}
	send(node) {
		this.call("send", [node.name, ...node.args]);
	}
	element(node) {
		this.emit(span(STYLES.fn, "h"), "(", prim(node.tagName));
		const attrs = [...node.attrs, ...node.handlers.map((h) => [`on:${h.type}`, h.action])];
		if (attrs.length > 0) {
			this.emit(", {");
			attrs.forEach(([name, value], i) => {
				this.emit(i > 0 ? ", " : "", span(STYLES.key, name), ": ");
				this.arg(value);
			});
			this.emit("}");
		}
		node.children.slice(0, MAX_AST_CHILDREN).forEach((c) => {
			this.emit(", ");
			this.arg(c);
		});
		const rest = node.children.length - MAX_AST_CHILDREN;
		if (rest > 0) this.emit(", ", span(STYLES.muted, `…+${rest}`));
		this.emit(")");
	}
}
const astHeader = (node) => {
	const printer = new Printer();
	printer.visit(node);
	return printer.out;
};

const typeHeader = (t) => [span(STYLES.fn, typeText(t))];

const keyParts = (key) =>
	typeof key === "string" ? [".", span(STYLES.key, key)] : ["[", prim(key), "]"];
const providerParts = (p) =>
	p === null ? [] : [span(STYLES.key, `@${p.name}^${p.depth}`), ...p.keys.flatMap(keyParts)];
const frameParts = (frame) => [
	...providerParts(frame.provider),
	...frame.keys.flatMap(keyParts),
	...(frame.item === null ? [] : ["[", prim(frame.item), "]"]),
];
const opParts = (op) => [
	".",
	span(STYLES.key, op.name),
	...(op.t === "item"
		? ["[", prim(op.key), "]"]
		: op.t === "seqItem"
			? ["[", op.keyName, "]"]
			: []),
];
const orRoot = (parts) => (parts.length === 0 ? [span(STYLES.muted, "·")] : parts);
const pathParts = (path) => orRoot(path.frames.flatMap(frameParts));
const keyPathParts = (path) => orRoot(path.keys.flatMap(keyParts));
const targetParts = (target) =>
	orRoot([...target.base.frames.flatMap(frameParts), ...target.selector.ops.flatMap(opParts)]);

// Labels the §{marker}§ comments tutuca wraps rendered components and loop items in.
const markerParts = (marker) => {
	if (isComponentMarker(marker)) return [span(STYLES.name, "component")];
	if (isFrameMarker(marker)) return frameParts(frameOfMarker(marker));
	return [span(STYLES.muted, JSON.stringify(marker))];
};
const markerComment = (text) => {
	if (text === MARKER_CLOSE) return [span(STYLES.muted, "⟨/⟩")];
	if (!isMarkerOpen(text)) return null;
	try {
		return [span(STYLES.muted, "⟨"), ...markerParts(parseMarker(text)), span(STYLES.muted, "⟩")];
	} catch {
		return null;
	}
};

const objectRows = (obj) => Object.keys(obj ?? {}).map((k) => [k, ref(obj[k])]);

// Each kind: test(v), header(v) → JsonML parts, rows(v) → [label | null, JsonML][], and
// summary(v) → { title, detail }, what it says in plain words (summary.js).
const KINDS = [
	{
		test: isTutucaComponent,
		summary: SUMMARIES.component,
		header(v) {
			const spec = specOf(v);
			const keys = Object.keys(spec.fields);
			const parts = keys
				.slice(0, MAX_INLINE_FIELDS)
				.flatMap((k) => [" ", span(STYLES.key, k), "=", prim(v[k])]);
			if (keys.length > MAX_INLINE_FIELDS) parts.push(span(STYLES.muted, " …"));
			return [span(STYLES.name, `‹${spec.name}`), ...parts, span(STYLES.name, "›")];
		},
		rows(v) {
			const rows = Object.keys(specOf(v).fields).map((k) => [k, ref(v[k])]);
			rows.push(["[[spec]]", ref(specOf(v))]);
			const scope = scopeOf(v);
			if (scope !== null) rows.push(["[[scope]]", ref(scope)]);
			return rows;
		},
	},
	{
		test: (v) => v instanceof ComponentSpec,
		summary: SUMMARIES.spec,
		header: (spec) => [span(STYLES.muted, "ComponentSpec "), span(STYLES.name, spec.name)],
		rows(spec) {
			const rows = [];
			for (const k in spec.fields) rows.push([k, ref(spec.fields[k])]);
			for (const k in spec.views) rows.push([`view ${k}`, ref(spec.views[k])]);
			const methods = Object.keys(spec.methods);
			if (methods.length > 0) rows.push(["methods", span(STYLES.fn, methods.join(", "))]);
			for (const k of ["on", "loops", "binds", "provides"]) {
				if (Object.keys(spec[k]).length > 0) rows.push([k, ref(spec[k])]);
			}
			if (spec.eventTypes.size > 0) rows.push(["eventTypes", ref(spec.eventTypes)]);
			return rows;
		},
	},
	{
		test: (v) => v instanceof Type,
		summary: SUMMARIES.type,
		header: typeHeader,
		rows: () => [],
	},
	{
		test: (v) => v instanceof ViewNode,
		summary: SUMMARIES.viewNode,
		header: astHeader,
		rows(node) {
			if (!(node instanceof ElementNode)) return node.childNodes().map((c) => [null, ref(c)]);
			return [
				...node.attrs.map(([name, value]) => [name, ref(value)]),
				...node.handlers.map((h) => [`on:${h.type}`, ref(h.action)]),
				...node.children.map((c) => [null, ref(c)]),
			];
		},
	},
	{
		test: (v) => v instanceof DispatchPath,
		summary: SUMMARIES.path,
		header: (path) => [span(STYLES.muted, "DispatchPath "), ...pathParts(path)],
		rows: (path) => path.frames.map((f) => [null, ref(f)]),
	},
	{
		test: (v) => v instanceof KeyPath,
		summary: SUMMARIES.path,
		header: (path) => [span(STYLES.muted, "KeyPath "), ...keyPathParts(path)],
		rows: () => [],
	},
	{
		test: (v) => v instanceof Frame,
		summary: SUMMARIES.frame,
		header: (frame) => [
			span(STYLES.muted, frame.isNode ? "Frame (component) " : "Frame "),
			...orRoot(frameParts(frame)),
		],
		rows: () => [],
	},
	{
		test: (v) => v instanceof Selector,
		summary: SUMMARIES.selector,
		header: (sel) => [span(STYLES.muted, "Selector "), ...orRoot(sel.ops.flatMap(opParts))],
		rows: () => [],
	},
	{
		test: (v) => v instanceof Target,
		summary: SUMMARIES.target,
		header: (target) => [span(STYLES.muted, "Target "), ...targetParts(target)],
		rows: (target) => [
			["base", ref(target.base)],
			["selector", ref(target.selector)],
		],
	},
	{
		test: (v) => v instanceof Task,
		summary: SUMMARIES.task,
		header: (task) => [
			span(STYLES.muted, `${taskVerb(task)} `),
			span(STYLES.name, task.name),
			"(",
			...join(task.args.map((a) => [prim(a)])),
			") ",
			...(task.from.isHost ? [span(STYLES.muted, "host")] : pathParts(task.from.path)),
			span(STYLES.muted, " → "),
			...(task.to !== null
				? pathParts(task.to.path)
				: task.target !== null
					? targetParts(task.target)
					: [span(STYLES.muted, "the ancestors")]),
		],
		rows(task) {
			const rows = [
				["args", ref(task.args)],
				["from", ref(task.from)],
				["target", ref(task.target)],
				["to", ref(task.to)],
			];
			if (task.event != null) rows.push(["event", ref(task.event)]);
			if (task.parent !== null) rows.push(["parent", ref(task.parent)]);
			return rows;
		},
	},
	{
		test: (v) => v instanceof Transition,
		summary: SUMMARIES.transition,
		header: (record) => [
			span(
				record.issues.length > 0 || record.outcome === "failed" ? STYLES.name : STYLES.muted,
				`${record.outcome} `,
			),
			span(STYLES.name, record.name),
			"(",
			...join(record.args.map((a) => [prim(a)])),
			") ",
			...(record.to !== null ? pathParts(record.to.path) : [span(STYLES.muted, "nowhere")]),
		],
		rows(record) {
			const rows = Object.entries(record).map(([key, value]) => [key, ref(value)]);
			for (const key of ["task", "before", "after", "instance"]) {
				if (record[key] != null) rows.push([key, ref(record[key])]);
			}
			return rows;
		},
	},
	{
		test: (v) => v instanceof HostEvent,
		summary: SUMMARIES.hostEvent,
		header: (record) => [
			span(STYLES.muted, "host event "),
			span(STYLES.name, record.type),
			...(record.issues.length > 0 ? [span(STYLES.muted, ` ${record.issues.length} issues`)] : []),
		],
		rows: (record) => Object.entries(record).map(([key, value]) => [key, ref(value)]),
	},
	{
		test: (v) => v instanceof MessageContext,
		summary: SUMMARIES.messageContext,
		header(ctx) {
			const parts = [span(STYLES.muted, "ctx "), ...pathParts(ctx.path)];
			if (ctx.sourceKey !== null)
				parts.push(" ", span(STYLES.key, "sourceKey"), "=", prim(ctx.sourceKey));
			return parts;
		},
		rows: (ctx) => [
			["task", ref(ctx.task)],
			["path", ref(ctx.path)],
			["event", ref(ctx.event)],
			["sourceKey", ref(ctx.sourceKey)],
			["scope", ref(ctx.scope)],
		],
	},
	{
		test: (v) => v instanceof Scope,
		summary: SUMMARIES.scope,
		header: (scope) => [
			span(STYLES.muted, "Scope "),
			"[",
			...join(Object.keys(scope.specs).map((name) => [span(STYLES.name, name)])),
			"]",
			scope.parent === null ? "" : span(STYLES.muted, " ↑"),
		],
		rows: (scope) => [
			...objectRows(scope.specs),
			["askHandlers", ref(scope.askHandlers)],
			["parent", ref(scope.parent)],
		],
	},
	{
		test: (v) => v instanceof RenderContext,
		summary: SUMMARIES.renderContext,
		header: (ctx) => [
			span(STYLES.muted, "RenderContext "),
			prim(ctx.component),
			" ",
			span(STYLES.key, "depth"),
			"=",
			prim(ctx.depth),
			...(ctx.viewStack.length > 0 ? [" ", span(STYLES.key, "views"), `=[${ctx.viewStack}]`] : []),
		],
		rows: (ctx) => [
			["it", ref(ctx.it)],
			["component", ref(ctx.component)],
			["spec", ref(ctx.spec)],
			["binds", ref(ctx.binds)],
			["provided", ref(ctx.provided)],
			["viewStack", ref(ctx.viewStack)],
		],
	},
];

const kindOf = (v) => {
	if (!isObject(v)) return null;
	try {
		return KINDS.find((k) => k.test(v)) ?? null;
	} catch {
		return null; // e.g. a revoked immer draft
	}
};
// The header (JsonML parts) and rows ([label | null, JsonML][]) the formatter shows for v and
// what v says in plain words (title, detail), or null when v isn't a tutuca value (or can't be
// read: a revoked immer draft); for other UIs over the same information.
export const describe = (v) => {
	try {
		const kind = kindOf(v);
		if (kind === null) return null;
		return { header: kind.header(v), rows: kind.rows(v), ...kind.summary(v) };
	} catch {
		return null;
	}
};
// v in plain words, as { title, detail }: its kind's summary, else what it is in a few words.
export const summarize = (v) => {
	const { title = brief(v), detail = "" } = describe(v) ?? {};
	return { title, detail };
};
const rowItem = ([label, value]) =>
	label === null ? ["li", {}, value] : ["li", {}, span(STYLES.key, label), ": ", value];

const formatter = makeFormatter({
	header: (v) => kindOf(v)?.header(v) ?? null,
	rows: (v) => kindOf(v)?.rows(v).map(rowItem) ?? [],
});

export const installFormatters = (target = globalThis) => {
	installVdomFormatters(target, { comment: markerComment });
	return install(target, formatter);
};
