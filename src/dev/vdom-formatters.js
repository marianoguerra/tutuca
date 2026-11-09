// DevTools custom formatters for vdom trees (Chrome/Firefox), shown like the Elements panel.

import { truncate } from "../core/text.js";
import { HTML_NS, VBase, VComment, VFragment, VNode, VText } from "../core/vdom.js";
import { install, makeFormatter, objectRef as ref, span } from "./jsonml.js";

const STYLES = {
	tag: "color:#9333ea",
	attr: "color:#d97706",
	str: "color:#16a34a",
	muted: "opacity:0.6",
	removed: "opacity:0.6;text-decoration:line-through",
};
const MAX_STR = 40;
const MAX_INLINE_ATTRS = 4;

const quoted = (s) => span(STYLES.str, JSON.stringify(truncate(s, MAX_STR)));

// every stops at the first non vnode, so big arrays of other things bail out on item 0.
const isVdomArray = (v) => Array.isArray(v) && v.length > 0 && v.every((c) => c instanceof VBase);

const tagName = (node) => {
	const implicit = node.namespace === null || node.namespace === HTML_NS;
	if (implicit || node.tag === "svg" || node.tag === "math") return node.tag;
	return `${node.namespace.split("/").at(-1).toLowerCase()}:${node.tag}`; // e.g. svg:circle
};

const attrParts = (name, value) => {
	if (value === true) return [" ", span(STYLES.attr, name)];
	if (value === false || value == null) return [" ", span(STYLES.removed, `${name}=${value}`)];
	if (typeof value === "function") return [" ", span(STYLES.muted, `${name}=ƒ`)];
	if (typeof value === "object") return [" ", span(STYLES.attr, name), "=", ref(value)];
	return [" ", span(STYLES.attr, name), "=", quoted(String(value))];
};
const keyParts = (key) => (key === undefined ? [] : [" ", span(STYLES.muted, `key="${key}"`)]);

const openTag = (node) => {
	const names = Object.keys(node.attrs);
	const parts = [span(STYLES.tag, `<${tagName(node)}`), ...keyParts(node.key)];
	for (const name of names.slice(0, MAX_INLINE_ATTRS)) {
		parts.push(...attrParts(name, node.attrs[name]));
	}
	if (names.length > MAX_INLINE_ATTRS) {
		parts.push(" ", span(STYLES.muted, `…+${names.length - MAX_INLINE_ATTRS}`));
	}
	parts.push(span(STYLES.tag, ">"));
	return parts;
};
const closeTag = (node) => span(STYLES.tag, `</${tagName(node)}>`);
// A lone short text child renders inline, like the Elements panel does.
const inlineText = (node) => {
	const [child] = node.childs;
	return node.childs.length === 1 && child instanceof VText && child.text.length <= MAX_STR
		? child
		: null;
};

// How a comment vnode's text prints, when installFormatters gives it one (meta comments).
let commentHook = null;
const vdomFormatter = () => {
	const commentParts = (node) =>
		commentHook?.(node.text) ?? [span(STYLES.muted, `<!--${node.text}-->`)];
	const describe = (v) => {
		if (v instanceof VNode) {
			const text = inlineText(v);
			if (v.childs.length === 0 || text !== null) {
				const inner = text === null ? [] : [text.text];
				return { header: [...openTag(v), ...inner, closeTag(v)], childs: [] };
			}
			return {
				header: [...openTag(v), span(STYLES.muted, "…"), closeTag(v)],
				childs: v.childs,
				close: closeTag(v),
			};
		}
		if (v instanceof VText) return { header: [quoted(v.text)], childs: [] };
		if (v instanceof VComment) return { header: commentParts(v), childs: [] };
		if (v instanceof VFragment) {
			return {
				header: [
					span(STYLES.tag, "<>"),
					...keyParts(v.key),
					span(STYLES.muted, ` (${v.childs.length})`),
				],
				childs: v.childs,
				close: span(STYLES.tag, "</>"),
			};
		}
		if (isVdomArray(v)) {
			const noun = v.length === 1 ? "vnode" : "vnodes";
			return { header: [span(STYLES.muted, `[${v.length} ${noun}]`)], childs: v };
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

// One formatter, so installing twice is a no-op; a comment given later still applies.
const formatter = vdomFormatter();
export const installVdomFormatters = (target = globalThis, { comment } = {}) => {
	if (comment !== undefined) commentHook = comment;
	return install(target, formatter);
};
