// DevTools custom formatters for vdom trees (Chrome/Firefox), shown like the Elements panel.
import { HTML_NS, VBase, VComment, VFragment, VNode, VText } from "../vdom.js";
import { install, makeFormatter, objectRef as ref, span, truncate } from "./jsonml.js";

const S = {
	tag: "color:#9333ea",
	attr: "color:#d97706",
	str: "color:#16a34a",
	muted: "opacity:0.6",
	removed: "opacity:0.6;text-decoration:line-through",
};
const MAX_STR = 40;
const MAX_INLINE_ATTRS = 4;

const quoted = (s) => span(S.str, JSON.stringify(truncate(s, MAX_STR)));

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

const vdomFormatter = (comment) => {
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
	return makeFormatter({
		header: (v) => describe(v)?.header ?? null,
		rows(v) {
			const d = describe(v);
			if (d === null || d.childs.length === 0) return [];
			const rows = d.childs.map((c) => ["li", {}, ref(c)]);
			if (d.close !== undefined) rows.push(["li", {}, d.close]);
			return rows;
		},
	});
};

const installed = new WeakMap(); // target → formatter, so installing twice is a no-op
export const installVdomFormatters = (target = globalThis, { comment } = {}) => {
	if (!installed.has(target)) installed.set(target, install(target, vdomFormatter(comment)));
	return installed.get(target);
};
