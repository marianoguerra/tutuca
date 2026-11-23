// What's under a cell of the screen: the element a mouse event at x, y targets, found in an
// absolutized layout.
import { cellMetrics } from "./metrics.js";
import { clipsOf, contentOf, inside, spanAt } from "./props.js";
import { graphemeWidth, measureWidth, readGrapheme } from "./text.js";

// Whether x, y is where a box that clips shows its children: inside its content box on each
// axis it clips.
function reachesChildren(layout, x, y) {
	const props = layout.node.props;
	const clips = clipsOf(props);
	if (!clips.x && !clips.y) return true;
	const c = contentOf(layout);
	return (!clips.x || (x >= c.x && x < c.x + c.w)) && (!clips.y || (y >= c.y && y < c.y + c.h));
}

// The element under x, y in an absolutized layout, or null. Later siblings paint over earlier
// ones, so they're tried first; a box that clips (overflow hidden, scroll or auto) hides its
// children outside its content box, as a scroll container hides what's scrolled out of view.
// x and y are in m's units (the metrics it was laid out in), and needn't be whole.
export function hitTest(layout, x, y, m = layout.metrics ?? cellMetrics) {
	if (reachesChildren(layout, x, y)) {
		for (let i = layout.children.length - 1; i >= 0; i--) {
			const hit = hitTest(layout.children[i], x, y, m);
			if (hit) return hit;
		}
	}
	if (!inside(layout.rect, x, y)) return null;
	return (layout.node.spans && spanElementAt(layout, x, y, m)) ?? layout.node.el ?? null;
}

// The element of the span drawn at x, y in a text with spans, or null past its text.
function spanElementAt(layout, x, y, m) {
	const row = layout.rows[Math.floor((y - layout.rect.y) / m.lineHeight)];
	if (!row) return null;
	const { spans, props } = layout.node;
	const content = props.children;
	const measure = m.measureOf(layout.node);
	let col = layout.rect.x;
	for (const seg of row) {
		if (seg.text !== undefined) {
			const w = measureWidth(seg.text, measure && ((g) => measure(g, seg.at)));
			if (x < col + w) return spanAt(spans, seg.at).el;
			col += w;
			continue;
		}
		for (let at = seg.start; at < seg.end; ) {
			const g = readGrapheme(content, at);
			if (g === null) break;
			const w = measure === undefined ? graphemeWidth(g.segment) : measure(g.segment, at);
			if (x < col + w) return spanAt(spans, at).el;
			col += w;
			at = g.end;
		}
	}
	return null;
}
