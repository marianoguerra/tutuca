// The path tree (path-tree.js) as text: an outline for a terminal or a model's context.
//
//   ● · App
//   ├─○ .header Header
//   └─● each .todos |visible (3/5)
//      ├─◆ [0] Todo
//      └─○ [1] Todo ▸
//
// ● is a step on the focus path, ◆ the last one, ○ a step off it; ▸ marks a step with steps
// below it that aren't listed. Steps print as paths do (tree/text.js): .field,
// .seq[.keyField=key], *provided ^up.keys, [key] for a loop's item, it for the item itself.
import { jsonText, keyText } from "../tree/text.js";

const keysText = (keys) => keys.map(keyText).join("");

// A step's text as [{ tone, text }] parts. Tones: punct, name, value, kw, muted.
export const stepParts = (step) => {
	const punct = (text) => ({ tone: "punct", text });
	const name = (text) => ({ tone: "name", text });
	const value = (v) => ({ tone: "value", text: jsonText(v) });
	switch (step.t) {
		case "root":
			return [punct("·")];
		case "field":
			return [punct("."), name(step.name)];
		case "seqItem":
			return [
				punct("."),
				name(step.name),
				punct("[."),
				name(step.keyName),
				punct("="),
				value(step.key),
				punct("]"),
			];
		case "provided": {
			const parts = [punct("*"), name(step.name)];
			if (step.up === null) return [...parts, { tone: "muted", text: " ∅" }];
			return [...parts, { tone: "muted", text: ` ^${step.up}${keysText(step.keys)}` }];
		}
		case "each": {
			const { source, loop, kept, total } = step;
			const parts = [{ tone: "kw", text: "each " }, ...stepParts(source)];
			if (loop !== null) parts.push(punct(" |"), name(loop));
			const count = kept === null ? total : kept === total ? kept : `${kept}/${total}`;
			parts.push({ tone: "muted", text: ` (${count})` });
			return parts;
		}
		case "item":
			return [punct("["), value(step.key), punct("]")];
		case "it":
			return [{ tone: "kw", text: "it" }];
		case "more":
			return [{ tone: "muted", text: `… ${step.count} more` }];
		default:
			return [{ tone: "muted", text: `?${step.kind ?? step.t}` }];
	}
};
// The component a step renders, as text: "Todo", "Header:compact", "∅" for a missing one, ""
// for a step that renders none.
export const componentText = (node) => {
	if (node.missing) return "∅";
	if (node.spec === null) return "";
	return node.view === "main" ? node.spec : `${node.spec}:${node.view}`;
};
const markOf = (node) => (node.last ? "◆" : node.active ? "●" : "○");
// The text of node's line, without its mark and indentation.
const lineText = (node) => {
	const comp = componentText(node);
	const step = stepParts(node.step)
		.map((p) => p.text)
		.join("");
	const collapsed = node.children === null && node.hasChildren ? " ▸" : "";
	return `${step}${comp === "" ? "" : ` ${comp}`}${collapsed}`;
};

// The tree as lines, one per step.
export const pathTreeText = (tree) => {
	const lines = [];
	const walk = (node, prefix, head) => {
		lines.push(`${head}${markOf(node)} ${lineText(node)}`);
		const children = node.children ?? [];
		children.forEach((c, i) => {
			const isLast = i === children.length - 1;
			walk(c, `${prefix}${isLast ? "   " : "│  "}`, `${prefix}${isLast ? "└─" : "├─"}`);
		});
	};
	walk(tree, "", "");
	return lines.join("\n");
};
