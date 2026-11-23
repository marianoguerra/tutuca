// What a component's page shows, for a model that can't see it: its view rendered without a
// document, as an outline of elements, the text they show, the values of their inputs and the
// messages their events send. Examples and tools see state, not the page, so a view that reads
// the wrong thing (a method's source, an empty field) passes them all; its outline shows it.
//
//   pageOutline(c)    // [{ tag: "div", attrs: {}, sends: [], children: [{ text: "Us 0" }, ...] }]
//   pageOutlineText(pageOutline(c))
//   // div
//   //   span "Us 0"
//   //   button "+2" [click → add(2)]
//   //   input value="x" [input → setName(targetValue())]
import { isComponent, specOf } from "../core/model/spec.js";
import { RenderContext, renderView } from "../core/view/view.js";
import { toVChildren, VComment, VFragment, VNode, VText } from "../vdom/index.js";

// The attrs an outline keeps: what a reader of the page sees or can do with it, not how it looks.
const SHOWN_ATTRS = [
	"type",
	"value",
	"checked",
	"selected",
	"placeholder",
	"disabled",
	"href",
	"alt",
	"aria-label",
];

// The specs of c and of every component in its state, the ones its page can render: their
// event bindings, by eid, are what the page's elements send.
const specsIn = (c) => {
	const specs = new Set();
	const seen = new Set();
	const visit = (v) => {
		if (v === null || typeof v !== "object" || seen.has(v)) return;
		seen.add(v);
		if (isComponent(v)) specs.add(specOf(v));
		const values = v instanceof Map || v instanceof Set ? v.values() : Object.values(v);
		for (const x of values) visit(x);
	};
	visit(c);
	return specs;
};
// A send arg as its view says it: a constant as JSON, an event arg as its call, the rest by kind
// and name (field(id)): what it is depends on the event and the item it reaches.
const argText = (node) => {
	const kind = node?.constructor?.kind;
	if (kind === "constant") return JSON.stringify(node.value) ?? String(node.value);
	if (kind === "eventArg")
		return node.arg === undefined ? `${node.name}()` : `${node.name}(${JSON.stringify(node.arg)})`;
	if (node?.name !== undefined) return `${kind}(${node.name})`;
	return kind ?? "?";
};
const sendOf = (binding) => ({
	event: binding.key === null ? binding.type : `${binding.type}+${binding.key}`,
	name: binding.action?.name ?? "?",
	args: (binding.action?.args ?? []).map(argText),
});
const shownAttrs = (vnode) => {
	const all = vnode.attrs;
	const out = {};
	for (const name of SHOWN_ATTRS) {
		const v = all[name];
		if (v === undefined || v === null || v === false) continue;
		if (name === "type" && vnode.tag !== "input") continue;
		out[name] = v === true ? true : String(v);
	}
	return out;
};
const squash = (text) => text.replace(/\s+/g, " ").trim();

// c's page view as an outline: a list of items, each { text } or { tag, attrs, sends, children },
// sends the messages its events send ({ event, name, args }, args as the view writes them).
// Markers, comments and whitespace are left out; fragments are spliced in.
export const pageOutline = (c) => {
	const bindings = new Map();
	for (const spec of specsIn(c)) for (const [eid, bs] of spec.eventBindings) bindings.set(eid, bs);
	const items = (vchildren) => {
		const out = [];
		for (const child of vchildren) {
			if (child instanceof VText) {
				const text = squash(child.text);
				if (text !== "") out.push({ text });
			} else if (child instanceof VFragment) out.push(...items(child.children));
			else if (child instanceof VNode) {
				const eid = child.shape.staticAttrs["data-eid"];
				out.push({
					tag: child.tag,
					attrs: shownAttrs(child),
					sends: eid === undefined ? [] : (bindings.get(eid) ?? []).map(sendOf),
					children: items(child.children),
				});
			} else if (!(child instanceof VComment)) out.push({ text: `(${child.constructor.name})` });
		}
		return out;
	};
	return items(toVChildren(renderView(c, RenderContext.root(c))));
};

const quote = (text, max) => JSON.stringify(text.length > max ? `${text.slice(0, max)}…` : text);
const attrText = ([name, v], max) => (v === true ? name : `${name}=${quote(v, max)}`);
const sendText = (s) => `[${s.event} → ${s.name}(${s.args.join(", ")})]`;

// An outline as indented lines: an element whose children are all text on one line with them
// (button "+2" [click → add(2)]), others with their children indented below. maxLines cuts it,
// saying how many lines it left out; maxText cuts each text and attr value.
export const pageOutlineText = (outline, { maxLines = 80, maxText = 120 } = {}) => {
	const lines = [];
	const write = (list, indent) => {
		for (const item of list) {
			if (item.tag === undefined) {
				lines.push(`${indent}${quote(item.text, maxText)}`);
				continue;
			}
			const head = [item.tag, ...Object.entries(item.attrs).map((a) => attrText(a, maxText))];
			const inline = item.children.every((ch) => ch.tag === undefined);
			if (inline) head.push(...item.children.map((ch) => quote(ch.text, maxText)));
			head.push(...item.sends.map(sendText));
			lines.push(`${indent}${head.join(" ")}`);
			if (!inline) write(item.children, `${indent}  `);
		}
	};
	write(outline, "");
	if (lines.length === 0) return "(nothing)";
	if (lines.length <= maxLines) return lines.join("\n");
	const left = lines.length - maxLines;
	return `${lines.slice(0, maxLines).join("\n")}\n… ${left} more line${left === 1 ? "" : "s"}`;
};
