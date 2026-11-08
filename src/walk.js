// Walkers: visits over view ASTs, dispatching on each node's static kind.
// A walker overrides the kinds it cares about; a kind it doesn't is visited as its fallback
// kind, if it has one, or else as a plain node: its childNodes, in order.
const FALLBACK = { renderIt: "render", renderEach: "each" };
export class Walker {
	visit(node) {
		node.accept(this);
	}
	// Runs the walker's method for kind on node.
	dispatch(kind, node) {
		for (let k = kind; k !== undefined; k = FALLBACK[k]) {
			if (typeof this[k] === "function") return this[k](node);
		}
		return this.node(node);
	}
	node(node) {
		for (const c of node.childNodes()) this.visit(c);
	}
	element(node) {
		for (const [name, value] of node.attrs) this.attr(node, name, value);
		for (const c of node.childs) this.child(node, c);
		for (const h of node.handlers) this.handler(node, h);
	}
	attr(_node, _name, value) {
		this.visit(value);
	}
	child(_node, child) {
		this.visit(child);
	}
	handler(_node, handler) {
		this.visit(handler.action);
	}
}
// The handlers of every element in views that has any, by the element's eid.
class HandlerCollector extends Walker {
	eventHandlers = new Map();
	element(node) {
		if (node.eid !== null) this.eventHandlers.set(node.eid, node.handlers);
		super.element(node);
	}
	handler(_node, _handler) {}
}
export const eventHandlersOf = (views) => {
	const collector = new HandlerCollector();
	for (const key in views) collector.visit(views[key]);
	return collector.eventHandlers;
};
