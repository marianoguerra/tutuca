// Rendering a component's renders.llmContext: lowered to mdast, checked (every issue at its path,
// thrown as one LlmError), and printed as markdown by tutuca/mdast's printer.
import { printMd } from "../mdast/render.js";
import { RenderContext, specOf } from "../tutuca.js";
import { toVChildren } from "../vdom/index.js";
import { attrsIssues, childIssue, flatten, LlmError, textIssue } from "./build.js";
import { CONTEXT } from "./context.js";
import { llmContextTarget } from "./target.js";

// A value as a model reads it in a Fact.
export const formatValue = (value) => {
	if (value == null) return "none";
	if (typeof value === "boolean") return value ? "yes" : "no";
	if (Array.isArray(value)) return value.length === 0 ? "none" : value.map(formatValue).join(", ");
	if (value instanceof Set) return formatValue([...value]);
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
};

const text = (value) => ({ type: "text", value });
const paragraph = (children) => ({ type: "paragraph", children });

const MARKS = { Strong: "strong", Em: "emphasis" };

const childrenOf = (entry, tag, where, issues) => {
	const spec = CONTEXT[tag];
	const out = [];
	flatten(entry.node.children, entry.markers).forEach((e, i) => {
		if (e.text !== undefined) {
			const issue = textIssue(tag, spec, e.text);
			if (issue !== null) {
				if (e.text.trim() !== "") issues.push(`${where}: ${issue}`);
			} else out.push(e);
			return;
		}
		const childTag = e.node.tag;
		const issue =
			CONTEXT[childTag] === undefined ? `unknown tag ${childTag}` : childIssue(tag, spec, childTag);
		if (issue !== null) issues.push(`${where} > ${childTag}[${i}]: ${issue}`);
		else out.push(e);
	});
	return out;
};

const lowerInline = (entries, where, issues) =>
	entries.map((e, i) => {
		if (e.text !== undefined) return text(e.text);
		const tag = e.node.tag;
		const at = `${where} > ${tag}[${i}]`;
		attrsIssues(tag, CONTEXT[tag], e.node.attrs, at, issues);
		const kids = childrenOf(e, tag, at, issues);
		if (tag === "Code") return { type: "inlineCode", value: kids.map((k) => k.text).join("") };
		return { type: MARKS[tag], children: lowerInline(kids, at, issues) };
	});

const lowerItems = (entry, depth, where, issues) => {
	const { attrs } = entry.node;
	attrsIssues("Items", CONTEXT.Items, attrs, where, issues);
	const items = childrenOf(entry, "Items", where, issues);
	if (items.length === 0) return attrs.empty == null ? [] : [paragraph([text(attrs.empty)])];
	const shown = attrs.max == null ? items : items.slice(0, Math.max(0, attrs.max));
	const list = {
		type: "list",
		spread: false,
		children: shown.map((item, i) => {
			const at = `${where} > Item[${i}]`;
			const { done } = item.node.attrs;
			attrsIssues("Item", CONTEXT.Item, item.node.attrs, at, issues);
			const kids = childrenOf(item, "Item", at, issues);
			const phrasing = kids.filter((k) => k.node?.tag !== "Items");
			const lists = kids
				.filter((k) => k.node?.tag === "Items")
				.flatMap((k, j) => lowerItems(k, depth, `${at} > Items[${j}]`, issues));
			const node = { type: "listItem", spread: false, children: [] };
			if (typeof done === "boolean") node.checked = done;
			if (phrasing.length > 0) node.children.push(paragraph(lowerInline(phrasing, at, issues)));
			node.children.push(...lists);
			return node;
		}),
	};
	const more = items.length - shown.length;
	return more > 0 ? [list, paragraph([text(`…and ${more} more.`)])] : [list];
};

// The mdast flow nodes the entries say, with Sections' headings at depth and Facts next to each
// other as one list.
const lowerFlow = (entries, depth, where, issues) => {
	const out = [];
	let facts = null;
	entries.forEach((e, i) => {
		const tag = e.node.tag;
		const at = `${where}${tag}[${i}]`;
		const spec = CONTEXT[tag];
		attrsIssues(tag, spec, e.node.attrs, at, issues);
		if (tag !== "Fact") facts = null;
		switch (tag) {
			case "Section": {
				const { title } = e.node.attrs;
				const kids = childrenOf(e, tag, at, issues);
				out.push({
					type: "heading",
					depth: Math.min(depth, 6),
					children: [text(String(title ?? ""))],
				});
				out.push(...lowerFlow(kids, depth + 1, `${at} > `, issues));
				break;
			}
			case "Text":
				out.push(paragraph(lowerInline(childrenOf(e, tag, at, issues), at, issues)));
				break;
			case "Hint": {
				const kids = lowerInline(childrenOf(e, tag, at, issues), at, issues);
				const label = { type: "strong", children: [text("Hint:")] };
				out.push({ type: "blockquote", children: [paragraph([label, text(" "), ...kids])] });
				break;
			}
			case "Fact": {
				const { name, value } = e.node.attrs;
				const kids = lowerInline(childrenOf(e, tag, at, issues), at, issues);
				const said = "value" in e.node.attrs ? [text(` ${formatValue(value)}`)] : [text(" ")];
				const item = {
					type: "listItem",
					spread: false,
					children: [
						paragraph([{ type: "strong", children: [text(`${name}:`)] }, ...said, ...kids]),
					],
				};
				if (facts === null) {
					facts = { type: "list", spread: false, children: [] };
					out.push(facts);
				}
				facts.children.push(item);
				break;
			}
			case "Items":
				out.push(...lowerItems(e, depth, at, issues));
				break;
			case "Data": {
				const { value, lang = "json" } = e.node.attrs;
				childrenOf(e, tag, at, issues);
				const code =
					typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "undefined");
				out.push({ type: "code", lang, value: code });
				break;
			}
		}
	});
	return out;
};

// The mdast the vnodes a renders.llmContext rendered say, its Sections' headings from depth.
export const lowerContext = (vnodes, { depth = 1 } = {}) => {
	const issues = [];
	const entries = [];
	for (const e of flatten(vnodes)) {
		if (e.text !== undefined) {
			if (e.text.trim() !== "")
				issues.push(`a llmContext render renders nodes, not text ${JSON.stringify(e.text)}`);
		} else if (!FLOW_TAGS.has(e.node.tag)) {
			issues.push(`a llmContext render renders ${[...FLOW_TAGS].join(", ")}, not ${e.node.tag}`);
		} else entries.push(e);
	}
	const tree = { type: "root", children: lowerFlow(entries, depth, "", issues) };
	if (issues.length > 0) throw new LlmError(issues);
	return tree;
};
const FLOW_TAGS = new Set(CONTEXT.Section.children);

// The mdast instance's renders.llmContext (view, or main) renders to; depth is its first
// heading's, for context that goes under a heading of its own.
export const renderLlmContextAst = (instance, { view, depth } = {}) => {
	const ctx = RenderContext.root(instance, { target: llmContextTarget });
	const node = ctx.getBestViewFor(specOf(instance), view);
	return lowerContext(toVChildren(node.eval(ctx.with({ component: instance }))), { depth });
};
// The markdown what instance renders for a model's context says.
export const renderLlmContext = (instance, options = {}) =>
	printMd(renderLlmContextAst(instance, options));
