// Lowering (spec/bind/lower.rkt): from the semantic tree to vnodes. This is what binds the
// tutuca side to the vdom; the encoding it picks is an implementation detail of the binding.
import { SNode } from "../view/sem.js";
import { renderRoot } from "../view/view.js";
import * as vnode from "./vnode.js";

// The vnodes of one semantic node.
export function lower(snode) {
	switch (snode.type) {
		case "text":
			return [vnode.text(snode.string)];
		case "comment":
			return [vnode.comment(snode.string)];
		case "group":
			return [vnode.group(snode.key, lowerAll(snode.children))];
		case "el":
			return [
				vnode.makeEl(
					snode.tid,
					snode.tag,
					snode.ns,
					snode.key,
					lowerProps(snode.props),
					lowerAll(snode.children),
				),
			];
		// The render of a component is its children: the DOM has no node for it.
		case "component":
			return lowerAll(snode.children);
	}
}

export const lowerAll = (snodes) => snodes.flatMap(lower);

// Elements in props are vnode values; a wrapper there is the iterable of its lowered nodes.
export const lowerProps = (props) =>
	Object.fromEntries(Object.entries(props).map(([name, value]) => [name, lowerValue(value)]));

export function lowerValue(value) {
	if (value instanceof SNode) {
		const nodes = lower(value);
		return nodes.length === 1 ? nodes[0] : nodes;
	}
	if (value != null && typeof value !== "string" && typeof value[Symbol.iterator] === "function") {
		return Array.from(value).map(lowerValue);
	}
	return value;
}

// Host.render: the vnodes of the root component's view.
export const lowerRoot = (value) => lowerAll(renderRoot(value));
