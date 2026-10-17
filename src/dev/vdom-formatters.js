// DevTools custom formatters for vdom trees (Chrome/Firefox), shown like the Elements panel.
// Enable them in DevTools → Settings → Preferences → Console → "Enable custom formatters".
import { HTML_NS, VBase, VComment, VFragment, VNode, VText } from "../vdom.js";

const S = {
	tag: "color:#9333ea",
	attr: "color:#d97706",
	str: "color:#16a34a",
	muted: "opacity:0.6",
	removed: "opacity:0.6;text-decoration:line-through",
};
const LIST_STYLE = "list-style:none;margin:0;padding-left:14px";
const MAX_STR = 40;
const MAX_INLINE_ATTRS = 4;

const span = (style, ...kids) => ["span", { style }, ...kids];
const truncate = (s) => (s.length > MAX_STR ? `${s.slice(0, MAX_STR)}…` : s);
const quoted = (s) => span(S.str, JSON.stringify(truncate(s)));
const ref = (v) => ["object", { object: v }];

// every stops at the first non vnode, so big arrays of other things bail out on item 0.
const isVdomArray = (v) => Array.isArray(v) && v.length > 0 && v.every((c) => c instanceof VBase);

const tagName = (node) => {
	const implicit = node.namespace === null || node.namespace === HTML_NS;
	if (implicit || node.tag === "svg" || node.tag === "math") return node.tag;
	return `${node.namespace.split("/").at(-1).toLowerCase()}:${node.tag}`; // e.g. svg:circle
};

const attrParts = (name, value) => {
	if (value === true) return [" ", span(S.attr, name)];
	if (value === false || value == null) return [" ", span(S.removed, `${name}=${value}`)];
	if (typeof value === "function") return [" ", span(S.muted, `${name}=ƒ`)];
	if (typeof value === "object") return [" ", span(S.attr, name), "=", ref(value)];
	return [" ", span(S.attr, name), "=", quoted(String(value))];
};
const keyParts = (key) => (key === undefined ? [] : [" ", span(S.muted, `key="${key}"`)]);

const openTag = (node) => {
	const names = Object.keys(node.attrs);
	const parts = [span(S.tag, `<${tagName(node)}`), ...keyParts(node.key)];
	for (const name of names.slice(0, MAX_INLINE_ATTRS)) {
		parts.push(...attrParts(name, node.attrs[name]));
	}
	if (names.length > MAX_INLINE_ATTRS) {
		parts.push(" ", span(S.muted, `…+${names.length - MAX_INLINE_ATTRS}`));
	}
	parts.push(span(S.tag, ">"));
	return parts;
};
const closeTag = (node) => span(S.tag, `</${tagName(node)}>`);
// A lone short text child renders inline, like the Elements panel does.
const inlineText = (node) => {
	const [child] = node.childs;
	return node.childs.length === 1 && child instanceof VText && child.text.length <= MAX_STR
		? child
		: null;
};

const makeFormatter = (comment) => {
	const commentParts = (node) => comment?.(node.text) ?? [span(S.muted, `<!--${node.text}-->`)];
	const describe = (v) => {
		if (v instanceof VNode) {
			const text = inlineText(v);
			if (v.childs.length === 0 || text !== null) {
				const inner = text === null ? [] : [text.text];
				return { header: [...openTag(v), ...inner, closeTag(v)], childs: [] };
			}
			return {
				header: [...openTag(v), span(S.muted, "…"), closeTag(v)],
				childs: v.childs,
				close: closeTag(v),
			};
		}
		if (v instanceof VText) return { header: [quoted(v.text)], childs: [] };
		if (v instanceof VComment) return { header: commentParts(v), childs: [] };
		if (v instanceof VFragment) {
			return {
				header: [span(S.tag, "<>"), ...keyParts(v.key), span(S.muted, ` (${v.childs.length})`)],
				childs: v.childs,
				close: span(S.tag, "</>"),
			};
		}
		if (isVdomArray(v)) {
			const noun = v.length === 1 ? "vnode" : "vnodes";
			return { header: [span(S.muted, `[${v.length} ${noun}]`)], childs: v };
		}
		return null;
	};
	return {
		header(v) {
			try {
				const d = describe(v);
				return d === null ? null : ["span", {}, ...d.header];
			} catch {
				return null; // Fall back to the native view rather than breaking the console.
			}
		},
		hasBody(v) {
			return (describe(v)?.childs.length ?? 0) > 0;
		},
		body(v) {
			const { childs, close } = describe(v);
			const rows = childs.map((c) => ["li", {}, ref(c)]);
			if (close !== undefined) rows.push(["li", {}, close]);
			return ["ol", { style: LIST_STYLE }, ...rows];
		},
	};
};

const installed = new WeakMap(); // target → formatter, so installing twice is a no-op
export const installFormatters = (target = globalThis, { comment } = {}) => {
	if (installed.has(target)) return installed.get(target);
	const formatter = makeFormatter(comment);
	target.devtoolsFormatters ??= [];
	target.devtoolsFormatters.push(formatter);
	installed.set(target, formatter);
	return formatter;
};
