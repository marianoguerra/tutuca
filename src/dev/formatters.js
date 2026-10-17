// DevTools custom formatters for tutuca values (Chrome/Firefox).

import { isMetaOpen, META_CLOSE, parseMeta } from "../meta.js";
import {
	AnyType,
	AskTask,
	AstNode,
	ComponentSpec,
	ComponentType,
	DispatchPath,
	DomNode,
	EnumType,
	EventTask,
	Frame,
	IndexType,
	MessageContext,
	NotifyTask,
	OptionType,
	RecordType,
	RenderContext,
	Scope,
	Selector,
	scopeOf,
	specOf,
	Target,
	Task,
	UpdatePath,
	Walker,
} from "../tutuca.js";
import { install, join, makeFormatter, objectRef, span, truncate } from "./jsonml.js";
import { installVdomFormatters } from "./vdom-formatters.js";

export const S = {
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
const MAX_AST_CHILDS = 3;

export const isObject = (v) => (v !== null && typeof v === "object") || typeof v === "function";
const isTutucaComponent = (v) => specOf(v) instanceof ComponentSpec; // a Proxy may answer any key
const ref = (v) => (isObject(v) ? objectRef(v) : prim(v));

const prim = (v) => {
	if (typeof v === "string") return span(S.str, JSON.stringify(truncate(v, MAX_STR)));
	if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
		return span(S.num, String(v));
	}
	if (v === null || v === undefined) return span(S.muted, String(v));
	if (typeof v === "function") return span(S.fn, `ƒ ${v.name}`);
	if (typeof v === "symbol") return span(S.fn, v.toString());
	if (isTutucaComponent(v)) return span(S.name, `‹${specOf(v).name}›`);
	if (Array.isArray(v)) return span(S.muted, `[${v.length}]`);
	return span(S.muted, "{…}");
};

// Prints an AST node like the code that builds it: h("p", {title: field("name")}, …).
class Printer extends Walker {
	out = [];
	depth = 0;
	emit(...parts) {
		this.out.push(...parts);
	}
	arg(v) {
		if (!(v instanceof AstNode)) return this.emit(prim(v));
		if (this.depth >= MAX_AST_DEPTH) return this.emit(span(S.muted, "…"));
		this.depth++;
		this.visit(v);
		this.depth--;
	}
	call(name, args) {
		while (args.length > 0 && args.at(-1) === undefined) args.pop(); // optional view/loop names
		this.emit(span(S.fn, name), "(");
		args.forEach((a, i) => {
			if (i > 0) this.emit(", ");
			this.arg(a);
		});
		this.emit(")");
	}
	node(node) {
		this.emit(span(S.muted, node.constructor.name));
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
	targetValue(_node) {
		this.call("targetValue", []);
	}
	sourceKey(_node) {
		this.call("sourceKey", []);
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
		this.call("$if", [node.source, node.thenVal, node.elseVal]);
	}
	pushView(node) {
		this.call("pushView", [node.viewNameVal, node.child]);
	}
	each(node) {
		this.call("each", [node.source, node.child, node.loopName]);
	}
	renderEach(node) {
		this.call("renderEach", [node.source, node.loopName]);
	}
	scope(node) {
		this.call("scope", [node.scopeName, node.child]);
	}
	action(node) {
		this.call("send", [node.name, ...node.args]);
	}
	element(node) {
		this.emit(span(S.fn, "h"), "(", prim(node.tagName));
		const attrs = [...node.attrs, ...node.handlers.map((h) => [`@on.${h.name}`, h.action])];
		if (attrs.length > 0) {
			this.emit(", {");
			attrs.forEach(([name, value], i) => {
				this.emit(i > 0 ? ", " : "", span(S.key, name), ": ");
				this.arg(value);
			});
			this.emit("}");
		}
		node.childs.slice(0, MAX_AST_CHILDS).forEach((c) => {
			this.emit(", ");
			this.arg(c);
		});
		const rest = node.childs.length - MAX_AST_CHILDS;
		if (rest > 0) this.emit(", ", span(S.muted, `…+${rest}`));
		this.emit(")");
	}
}
const astHeader = (node) => {
	const printer = new Printer();
	printer.visit(node);
	return printer.out;
};

const typeName = (t) => t.constructor.kind ?? "any";
const constraintParts = ({ where, ...rest }) => {
	const parts = Object.entries(rest).map(([k, v]) =>
		v === true ? [`.${k}()`] : [`.${k}(`, prim(v), ")"],
	);
	for (const { name } of where ?? []) parts.push([`.where(${name})`]);
	return parts.flat();
};
const typeArgs = (t) => {
	if (t instanceof EnumType)
		return join(
			t.members.map((m) => [prim(m)]),
			", ",
		);
	if (t instanceof IndexType) return [prim(t.fieldName)];
	if (t instanceof ComponentType)
		return join(
			t.names.map((n) => [prim(n)]),
			", ",
		);
	if (t instanceof RecordType) {
		return join(
			Object.entries(t.shape).map(([k, v]) => [span(S.key, k), ": ", ...typeHeader(v)]),
			", ",
		);
	}
	const params = t.children().filter((c) => c.constructor !== AnyType);
	return join(params.map(typeHeader), ", ");
};
const typeHeader = (t) => {
	if (t instanceof OptionType) return [...typeHeader(t.valueType), "?"];
	const parts = [span(S.fn, typeName(t))];
	const args = typeArgs(t);
	if (args.length > 0) parts.push("(", ...args, ")");
	parts.push(...constraintParts(t.constraints));
	const { defaultValue } = t;
	if (defaultValue !== undefined && defaultValue !== null) parts.push(" = ", prim(defaultValue));
	return parts;
};

const keyParts = (key) =>
	typeof key === "string" ? [".", span(S.key, key)] : ["[", prim(key), "]"];
const providerParts = (p) =>
	p === null ? [] : [span(S.key, `@${p.name}^${p.depth}`), ...p.keys.flatMap(keyParts)];
const frameParts = (frame) => [
	...providerParts(frame.provider),
	...frame.keys.flatMap(keyParts),
	...(frame.item === null ? [] : ["[", prim(frame.item), "]"]),
];
const opParts = (op) => [
	".",
	span(S.key, op.name),
	...(op.t === "item"
		? ["[", prim(op.key), "]"]
		: op.t === "seqItem"
			? ["[", op.keyName, "]"]
			: []),
];
const orRoot = (parts) => (parts.length === 0 ? [span(S.muted, "·")] : parts);
const pathParts = (path) => orRoot(path.frames.flatMap(frameParts));
const updatePathParts = (path) => orRoot(path.keys.flatMap(keyParts));
const targetParts = (target) =>
	orRoot([...target.base.frames.flatMap(frameParts), ...target.selector.ops.flatMap(opParts)]);

// Labels the §{meta}§ comments tutuca wraps rendered components and loop items in.
const metaParts = (meta) => {
	switch (meta.t) {
		case "component":
			return [span(S.name, "component")];
		case "frame":
			return frameParts(Frame.fromMeta(meta));
		default:
			return [span(S.muted, JSON.stringify(meta))];
	}
};
const metaComment = (text) => {
	if (text === META_CLOSE) return [span(S.muted, "⟨/⟩")];
	if (!isMetaOpen(text)) return null;
	try {
		return [span(S.muted, "⟨"), ...metaParts(parseMeta(text)), span(S.muted, "⟩")];
	} catch {
		return null;
	}
};

const taskKind = (task) => {
	if (task instanceof EventTask) return "event";
	if (task instanceof AskTask) return "ask";
	if (task instanceof NotifyTask) return "notify";
	return "send";
};

const objectRows = (obj) => Object.keys(obj ?? {}).map((k) => [k, ref(obj[k])]);

// Each kind: test(v), header(v) → JsonML parts, rows(v) → [label | null, JsonML][].
const KINDS = [
	{
		test: isTutucaComponent,
		header(v) {
			const spec = specOf(v);
			const keys = Object.keys(spec.fields);
			const parts = keys
				.slice(0, MAX_INLINE_FIELDS)
				.flatMap((k) => [" ", span(S.key, k), "=", prim(v[k])]);
			if (keys.length > MAX_INLINE_FIELDS) parts.push(span(S.muted, " …"));
			return [span(S.name, `‹${spec.name}`), ...parts, span(S.name, "›")];
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
		header: (spec) => [span(S.muted, "ComponentSpec "), span(S.name, spec.name)],
		rows(spec) {
			const rows = [];
			for (const k in spec.fields) rows.push([k, span("", ...typeHeader(spec.fields[k]))]);
			for (const k in spec.views) rows.push([`view ${k}`, ref(spec.views[k])]);
			const methods = Object.keys(spec.methods);
			if (methods.length > 0) rows.push(["methods", span(S.fn, methods.join(", "))]);
			for (const k of ["on", "loops", "scopes", "provides"]) {
				if (Object.keys(spec[k]).length > 0) rows.push([k, ref(spec[k])]);
			}
			if (spec.eventNames.size > 0) rows.push(["eventNames", ref(spec.eventNames)]);
			return rows;
		},
	},
	{
		test: (v) => v instanceof AnyType,
		header: typeHeader,
		rows: () => [],
	},
	{
		test: (v) => v instanceof AstNode,
		header: astHeader,
		rows(node) {
			if (!(node instanceof DomNode)) return node.childNodes().map((c) => [null, ref(c)]);
			return [
				...node.attrs.map(([name, value]) => [name, ref(value)]),
				...node.handlers.map((h) => [`@on.${h.name}`, ref(h.action)]),
				...node.childs.map((c) => [null, ref(c)]),
			];
		},
	},
	{
		test: (v) => v instanceof DispatchPath,
		header: (path) => [span(S.muted, "DispatchPath "), ...pathParts(path)],
		rows: (path) => path.frames.map((f) => [null, ref(f)]),
	},
	{
		test: (v) => v instanceof UpdatePath,
		header: (path) => [span(S.muted, "UpdatePath "), ...updatePathParts(path)],
		rows: () => [],
	},
	{
		test: (v) => v instanceof Frame,
		header: (frame) => [
			span(S.muted, frame.isComponent ? "Frame (component) " : "Frame "),
			...orRoot(frameParts(frame)),
		],
		rows: () => [],
	},
	{
		test: (v) => v instanceof Selector,
		header: (sel) => [span(S.muted, "Selector "), ...orRoot(sel.ops.flatMap(opParts))],
		rows: () => [],
	},
	{
		test: (v) => v instanceof Target,
		header: (target) => [span(S.muted, "Target "), ...targetParts(target)],
		rows: (target) => [
			["base", ref(target.base)],
			["selector", ref(target.selector)],
		],
	},
	{
		test: (v) => v instanceof Task,
		header: (task) => [
			span(S.muted, `${taskKind(task)} `),
			span(S.name, task.name),
			"(",
			...join(task.args.map((a) => [prim(a)])),
			") ",
			...pathParts(task.sourcePath),
			span(S.muted, " → "),
			...targetParts(task.target),
		],
		rows(task) {
			const rows = [
				["args", ref(task.args)],
				["sourcePath", ref(task.sourcePath)],
				["target", ref(task.target)],
				["route", ref(task.route)],
			];
			if (task.event !== null) rows.push(["event", ref(task.event)]);
			if (task.parent !== null) rows.push(["parent", ref(task.parent)]);
			return rows;
		},
	},
	{
		test: (v) => v instanceof MessageContext,
		header(ctx) {
			const parts = [span(S.muted, "ctx "), ...pathParts(ctx.path)];
			if (ctx.sourceKey !== null)
				parts.push(" ", span(S.key, "sourceKey"), "=", prim(ctx.sourceKey));
			return parts;
		},
		rows: (ctx) => [
			["task", ref(ctx.task)],
			["path", ref(ctx.path)],
			["event", ref(ctx.event)],
			["sourceKey", ref(ctx.sourceKey)],
		],
	},
	{
		test: (v) => v instanceof Scope,
		header: (scope) => [
			span(S.muted, "Scope "),
			"[",
			...join(Object.keys(scope.byName).map((name) => [span(S.name, name)])),
			"]",
			scope.parent === null ? "" : span(S.muted, " ↑"),
		],
		rows: (scope) => [
			...objectRows(scope.byName),
			["askHandlers", ref(scope.askHandlers)],
			["parent", ref(scope.parent)],
		],
	},
	{
		test: (v) => v instanceof RenderContext,
		header: (ctx) => [
			span(S.muted, "RenderContext "),
			prim(ctx.component),
			" ",
			span(S.key, "depth"),
			"=",
			prim(ctx.depth),
			...(ctx.viewStack.length > 0 ? [" ", span(S.key, "views"), `=[${ctx.viewStack}]`] : []),
		],
		rows: (ctx) => [
			["it", ref(ctx.it)],
			["component", ref(ctx.component)],
			["spec", ref(ctx.spec)],
			["binds", ref(ctx.binds)],
			["dynBinds", ref(ctx.dynBinds)],
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
// The header (JsonML parts) and rows ([label | null, JsonML][]) the formatter shows for v,
// or null when v isn't a tutuca value; for other UIs over the same information.
export const describe = (v) => {
	const kind = kindOf(v);
	return kind === null ? null : { header: kind.header(v), rows: kind.rows(v) };
};
const rowItem = ([label, value]) =>
	label === null ? ["li", {}, value] : ["li", {}, span(S.key, label), ": ", value];

const formatter = makeFormatter({
	header: (v) => kindOf(v)?.header(v) ?? null,
	rows: (v) => kindOf(v)?.rows(v).map(rowItem) ?? [],
});

export const installFormatters = (target = globalThis) => {
	installVdomFormatters(target, { comment: metaComment });
	return install(target, formatter);
};
