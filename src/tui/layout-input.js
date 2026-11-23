// layoutInput(el) reads the terminal DOM into layout input: a { type, props, children, el } per
// element, attributes parsed by name (props.js), comments left out, a run of bare text nodes
// merged into one text node and a <text> element's text nodes into its content.
//
// With metrics (metrics.js) other than cells, lengths in attributes are scaled from cells to its
// units, and each text node says the font its text inherits (font: { bold, italic }), for
// measuring it.
import { cellMetrics, fontOf, scaleProps } from "./metrics.js";
import { propsOf, textStyleOf } from "./props.js";
import { stripControls } from "./text.js";

// A <text>'s content and its spans: the elements in it style the text in them, nested ones over
// the ones around them, as <span>s do. Each span is { start, end, style, el }, el the innermost
// element its text is in (the <text> itself for its own text), so a click on a word reaches it.
function spansOf(textEl) {
	let content = "";
	const spans = [];
	const walk = (el, style) => {
		for (const child of el.childNodes) {
			if (child.nodeType === 3) {
				const data = stripControls(child.data);
				if (data === "") continue;
				const last = spans.at(-1);
				if (last && last.el === el && last.end === content.length) last.end += data.length;
				else spans.push({ start: content.length, end: content.length + data.length, style, el });
				content += data;
			} else if (child.nodeType === 1) {
				walk(child, { ...style, ...textStyleOf(propsOf(child)) });
			}
		}
	};
	walk(textEl, {});
	return { content, spans };
}

const textNode = (content, props, el, font) => ({
	type: "text",
	props: { ...props, children: content },
	children: [],
	el,
	font,
});

const isRow = (props) => (props.flexDirection ?? "column").startsWith("row");

function childrenOf(el, props, m, inherited) {
	const out = [];
	let run = null; // Bare text nodes in a row show as one text, as inline text does in HTML.
	for (const child of el.childNodes) {
		if (child.nodeType === 3) {
			if (child.data === "") continue;
			if (run === null) {
				run = textNode("", {}, el, fontOf(inherited));
				run.texts = [];
				out.push(run);
			}
			run.props.children += stripControls(child.data);
			run.texts.push(child);
			continue;
		}
		run = null;
		if (child.nodeType === 1) out.push(read(child, m, inherited, isRow(props)));
	}
	return out;
}

// The text style el's ancestors pass down to it, root first.
function inheritedStyleOf(el) {
	const chain = [];
	for (let n = el.parentNode; n !== null && n.nodeType === 1; n = n.parentNode) chain.unshift(n);
	const style = {};
	for (const n of chain) Object.assign(style, textStyleOf(propsOf(n)));
	return style;
}

// el, in metrics' units (cells by default).
export function layoutInput(el, metrics = cellMetrics) {
	const row = el.parentNode?.nodeType === 1 && isRow(propsOf(el.parentNode));
	return read(el, metrics, inheritedStyleOf(el), row);
}

function read(el, m, parentStyle, row) {
	const own = propsOf(el);
	const props = scaleProps(own, m, row);
	const inherited = { ...parentStyle, ...textStyleOf(own) };
	const font = fontOf(inherited);
	switch (el.localName) {
		case "text": {
			const { content, spans } = spansOf(el);
			// Spans only when an element inside styles or handles part of it.
			const styled = spans.some((s) => s.el !== el);
			const node = textNode(content, props, el, font);
			return styled ? { ...node, spans } : node;
		}
		case "input":
		case "textarea": {
			const value = el.value;
			const shown = value === "" ? (props.placeholder ?? "") : value;
			return {
				...textNode(stripControls(shown), props, el, font),
				input: true,
				multiline: el.localName === "textarea",
				empty: value === "",
			};
		}
		case "spacer":
			return { type: "spacer", props: { flexGrow: 1, flexShrink: 0, ...props }, children: [], el };
		case "divider":
			return { type: "divider", props, children: [], el };
		default:
			return { type: "box", props, children: childrenOf(el, props, m, inherited), el };
	}
}
