// DOM events: finds the component, path and handler an event belongs to from the marker comments,
// and the send it makes, its args read from the event.

import { Address, DispatchPath } from "../../tree/index.js";
import { specOf } from "../model/spec.js";
import {
	frameOfMarker,
	isComponentMarker,
	isFrameMarker,
	isMarkerOpen,
	isTutucaMarker,
	MARKER_CLOSE,
	parseMarker,
	providedNameOf,
	providesOfMarker,
} from "../view/markers.js";
import { bindingTakes } from "../view/view.js";

function* enclosingMarkers(node) {
	let closed = 0;
	for (let n = node.previousSibling; n; n = n.previousSibling) {
		if (n.nodeType !== 8) continue;
		const data = n.data;
		if (data === MARKER_CLOSE) {
			closed++;
			continue;
		}
		if (!isMarkerOpen(data)) continue;
		if (closed > 0) {
			closed--;
			continue;
		}
		let marker;
		try {
			marker = parseMarker(data);
		} catch (err) {
			console.error("bad marker comment", err, n, node);
			continue;
		}
		if (isTutucaMarker(marker)) yield marker; // Skip look-alike comments from unmanaged DOM.
	}
}
// From node up to rootNode: the markers, innermost first; where each component marker is in them;
// and the elements with handlers, each with the number of components below it. null when
// node is outside rootNode.
const walkUp = (node, rootNode) => {
	const markers = [];
	const components = [];
	const eids = [];
	while (node && node !== rootNode) {
		// The attribute, not dataset, which elements outside HTML and SVG (MathML in jsdom) lack.
		const eid = node.getAttribute?.("data-eid");
		if (eid != null) eids.push({ eid: parseInt(eid, 10), node, level: components.length });
		for (const marker of enclosingMarkers(node)) {
			if (isComponentMarker(marker)) components.push(markers.length);
			markers.push(marker);
		}
		node = node.parentNode;
	}
	return node === rootNode ? { markers, components, eids } : null;
};
// Where the value a frame at index at reads as name is: { name, up, keys }, from the nearest
// of providers, the components above it that provide something ({ at, provides }, outermost first).
const providerOf = (name, at, providers) => {
	for (let i = providers.length - 1; i >= 0; i--) {
		const keys = providers[i].provides[name];
		if (keys !== undefined) return { name, up: at - providers[i].at, keys };
	}
	throw new Error(`No component provides ${name} above the frame that reads it`);
};
// The path the markers, innermost first, describe; a render outside the DOM (tutuca/llm's
// tools) finds its component's from the markers in its vnodes. A frame that reads a provided
// value says its name only: the nearest component above it that provides it says where it is.
export const pathOfMarkers = (markers) => {
	const frames = [];
	const providers = [];
	for (let i = markers.length - 1; i >= 0; i--) {
		const marker = markers[i];
		if (isFrameMarker(marker)) {
			const name = providedNameOf(marker);
			const provider = name === null ? null : providerOf(name, frames.length, providers);
			frames.push(frameOfMarker(marker, provider));
			continue;
		}
		if (frames.length > 0) frames.push(frames.pop().asNode());
		const provides = providesOfMarker(marker);
		if (provides !== null) providers.push({ at: frames.length, provides });
	}
	return new DispatchPath(frames);
};
// The path of the component, and the loop items in it, node was rendered in.
export const pathOf = (node, rootNode) => {
	const walk = walkUp(node, rootNode);
	return walk === null || walk.components.length === 0 ? null : pathOfMarkers(walk.markers);
};
// The event binding for a type event on target, with the address of its component and its element.
// Only the component target is in handles it, unless bubbles: then the nearest enclosing
// component with a binding for it does.
// takes(binding) says whether a binding takes the event.
export const bindingFor = (target, takes, rootNode, root, bubbles = false) => {
	const walk = walkUp(target, rootNode);
	if (walk === null) return null;
	const levels = bubbles ? walk.components.length : Math.min(1, walk.components.length);
	for (let level = 0; level < levels; level++) {
		const eids = walk.eids.filter((e) => e.level === level);
		if (eids.length === 0) continue;
		// What is outside the component below: its frame is the child the event came through.
		const start = level === 0 ? 0 : walk.components[level - 1] + 1;
		const to = Address.at(pathOfMarkers(walk.markers.slice(start)), root);
		const { eventBindings } = specOf(to.keyPath.getIn(root));
		for (const { eid, node } of eids) {
			for (const binding of eventBindings.get(eid) ?? []) {
				if (takes(binding)) return { binding, to, node };
			}
		}
	}
	return null;
};
// The send event's binding makes: { name, args, to, node }, args as values worked out as the
// event arrives, as a handler's context would (view.js's EVENT_ARGS read the event, the element with the
// binding, the drag and the key of the item the event reached); null when no binding takes it.
export const eventSend = (event, rootNode, root, drag, bubbles = false) => {
	const found = bindingFor(event.target, (b) => bindingTakes(b, event), rootNode, root, bubbles);
	if (found === null) return null;
	const { binding, to, node } = found;
	if (binding.prevent) event.preventDefault?.();
	if (binding.stop) event.stopPropagation?.();
	return {
		name: binding.action.name,
		args: eventArgs(binding.action, to, event, node, drag),
		to,
		node,
	};
};
// The args of the send action as values, for an event that reached the component at to: what
// view.js's EVENT_ARGS read.
export const eventArgs = (action, to, event, node = null, drag = null) => {
	const path = to.path.toNodePath();
	const ctx = { event, node, drag, path, sourceKey: to.path.sourceKeyIn(path) };
	return action.args.map((arg) => arg.eval(ctx));
};
