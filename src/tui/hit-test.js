// What's under a cell of the screen: the element a mouse event at x, y targets, found in an
// absolutized layout.
import { spanAt } from "./paint.js";
import { clipsOf, contentBox, inside } from "./props.js";
import { graphemeWidth, readGrapheme, stringWidth } from "./text.js";

// Whether x, y is where a box that clips shows its children: inside its content box on each
// axis it clips.
function reachesChildren(layout, x, y) {
	const props = layout.node.props;
	const clips = clipsOf(props);
	if (!clips.x && !clips.y) return true;
	const c = contentBox(layout.rect, props);
	return (!clips.x || (x >= c.x && x < c.x + c.w)) && (!clips.y || (y >= c.y && y < c.y + c.h));
}

// The element under x, y in an absolutized layout, or null. Later siblings paint over earlier
// ones, so they're tried first; a box that clips (overflow hidden, scroll or auto) hides its
// children outside its content box, as a scroll container hides what's scrolled out of view.
export function hitTest(layout, x, y) {
	if (reachesChildren(layout, x, y)) {
		for (let i = layout.children.length - 1; i >= 0; i--) {
			const hit = hitTest(layout.children[i], x, y);
			if (hit) return hit;
		}
	}
	if (!inside(layout.rect, x, y)) return null;
	return (layout.node.spans && spanElementAt(layout, x, y)) ?? layout.node.el ?? null;
}

// The element of the span drawn at x, y in a text with spans, or null past its text.
function spanElementAt(layout, x, y) {
	const row = layout.rows[y - layout.rect.y];
	if (!row) return null;
	const { spans, props } = layout.node;
	const content = props.children;
	let col = layout.rect.x;
	for (const seg of row) {
		if (seg.text !== undefined) {
			const w = stringWidth(seg.text);
			if (x < col + w) return spanAt(spans, seg.at).el;
			col += w;
			continue;
		}
		for (let at = seg.start; at < seg.end; ) {
			const g = readGrapheme(content, at);
			if (g === null) break;
			const w = graphemeWidth(g.segment);
			if (x < col + w) return spanAt(spans, at).el;
			col += w;
			at = g.end;
		}
	}
	return null;
}
