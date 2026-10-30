// DOM events: finds the component, path and handlers an event belongs to from the meta comments.
import { isMetaOpen, META_CLOSE, parseMeta } from "./meta.js";
import { Address, DispatchPath, Frame } from "./paths.js";
import { specOf } from "./schema.js";

const META_TYPES = new Set(["component", "frame"]);
function* enclosingNodeMeta(node) {
	let closed = 0;
	for (let n = node.previousSibling; n; n = n.previousSibling) {
		if (n.nodeType !== 8) continue;
		const data = n.data;
		if (data === META_CLOSE) {
			closed++;
			continue;
		}
		if (!isMetaOpen(data)) continue;
		if (closed > 0) {
			closed--;
			continue;
		}
		let meta;
		try {
			meta = parseMeta(data);
		} catch (err) {
			console.error("bad meta comment", err, n, node);
			continue;
		}
		if (META_TYPES.has(meta?.t)) yield meta; // Skip look-alike comments from unmanaged DOM.
	}
}
// From node up to rootNode: the metas, innermost first; where each component meta is in them;
// and the elements with handlers, each with the number of components below it. null when
// node is outside rootNode.
const walkUp = (node, rootNode) => {
	const metas = [];
	const components = [];
	const eids = [];
	while (node && node !== rootNode) {
		// The attribute, not dataset, which elements outside HTML and SVG (MathML in jsdom) lack.
		const eid = node.getAttribute?.("data-eid");
		if (eid != null) eids.push({ eid: parseInt(eid, 10), node, level: components.length });
		for (const meta of enclosingNodeMeta(node)) {
			if (meta.t === "component") components.push(metas.length);
			metas.push(meta);
		}
		node = node.parentNode;
	}
	return node === rootNode ? { metas, components, eids } : null;
};
// The path the metas, innermost first, describe.
const pathFrom = (metas) => {
	const frames = [];
	for (const meta of [...metas].reverse()) {
		if (meta.t === "frame") frames.push(Frame.fromMeta(meta));
		else if (frames.length > 0) frames.push(frames.pop().asComponent());
	}
	return new DispatchPath(frames);
};
// The path of the component, and the loop items in it, node was rendered in.
export const pathOf = (node, rootNode) => {
	const walk = walkUp(node, rootNode);
	return walk === null || walk.components.length === 0 ? null : pathFrom(walk.metas);
};
// The handler for a type event on target, with the address of its component and its element.
// Only the component target is in handles it, unless bubbles: then the nearest enclosing
// component with a handler for it does.
export const getEventInfoFor = (target, type, rootNode, rootComponent, bubbles = false) => {
	const walk = walkUp(target, rootNode);
	if (walk === null) return null;
	const levels = bubbles ? walk.components.length : Math.min(1, walk.components.length);
	for (let level = 0; level < levels; level++) {
		const eids = walk.eids.filter((e) => e.level === level);
		if (eids.length === 0) continue;
		// What is outside the component below: its frame is the child the event came through.
		const start = level === 0 ? 0 : walk.components[level - 1] + 1;
		const to = Address.at(pathFrom(walk.metas.slice(start)), rootComponent);
		const { eventHandlers } = specOf(to.updatePath.getIn(rootComponent));
		for (const { eid, node } of eids) {
			for (const handler of eventHandlers.get(eid) ?? []) {
				if (handler.name === type) return { handler, to, node };
			}
		}
	}
	return null;
};
