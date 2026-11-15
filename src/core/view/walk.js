// Walkers: visits over view ASTs, dispatching on each node's static kind.
// A walker overrides the kinds it cares about; a kind it doesn't is visited as its fallback
// kind, if it has one, or else as a plain node: its childNodes, in order.
const FALLBACK = { renderIt: "render", renderEach: "each" };
export class Walker {
	visit(node) {
		return node.accept(this);
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
		for (const c of node.children) this.child(node, c);
		for (const b of node.bindings) this.binding(node, b);
	}
	attr(_node, _name, value) {
		this.visit(value);
	}
	child(_node, child) {
		this.visit(child);
	}
	binding(_node, binding) {
		this.visit(binding.action);
	}
}
// The event bindings ({ type, action }) of every element in views that has any, by the element's
// eid.
class BindingCollector extends Walker {
	eventBindings = new Map();
	element(node) {
		if (node.eid !== null) this.eventBindings.set(node.eid, node.bindings);
		super.element(node);
	}
	binding(_node, _binding) {}
}
export const eventBindingsOf = (views) => {
	const collector = new BindingCollector();
	for (const key in views) collector.visit(views[key]);
	return collector.eventBindings;
};
