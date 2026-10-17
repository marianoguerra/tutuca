// DOM events: finds the component, path and handlers an event belongs to from the meta comments.
import { isMetaOpen, META_CLOSE, parseMeta } from "./meta.js";
import { DispatchPath, Frame, routeFor } from "./paths.js";
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
export const getEventInfoFor = (e, rootNode, rootComponent) => {
	let node = e.target;
	let foundComponent = false;
	const eids = [];
	const scopes = [];
	while (node && node !== rootNode) {
		if (!foundComponent) {
			const eid = node.dataset?.eid;
			if (eid !== undefined) {
				eids.push([parseInt(eid, 10), node]);
			}
		}
		for (const meta of enclosingNodeMeta(node)) {
			scopes.push(meta);
			if (meta.t === "component") foundComponent = true;
		}
		node = node.parentNode;
	}
	if (node !== rootNode || !foundComponent || eids.length === 0) return null;
	const frames = [];
	for (const meta of scopes.reverse()) {
		if (meta.t === "frame") frames.push(Frame.fromMeta(meta));
		else if (frames.length > 0) frames.push(frames.pop().asComponent());
	}
	const path = new DispatchPath(frames);
	const route = routeFor(path);
	const instance = route.updatePath.getIn(rootComponent);
	const { eventHandlers } = specOf(instance);
	for (const [eid, node] of eids) {
		for (const handler of eventHandlers.get(eid) ?? []) {
			if (handler.name === e.type) {
				return { handler, route, node };
			}
		}
	}
	return null;
};
