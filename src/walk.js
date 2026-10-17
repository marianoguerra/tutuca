// Walkers: visits over view ASTs, dispatching on each node's static kind.
export class Walker {
	visit(node) {
		node.accept(this);
	}
	node(node) {
		for (const c of node.childNodes()) this.visit(c);
	}
	field(node) {
		this.node(node);
	}
	seqItem(node) {
		this.node(node);
	}
	provided(node) {
		this.node(node);
	}
	constant(node) {
		this.node(node);
	}
	targetValue(node) {
		this.node(node);
	}
	sourceKey(node) {
		this.node(node);
	}
	lookupBind(node) {
		this.node(node);
	}
	render(node) {
		this.node(node);
	}
	renderIt(node) {
		this.render(node);
	}
	cond(node) {
		this.node(node);
	}
	pushView(node) {
		this.node(node);
	}
	each(node) {
		this.node(node);
	}
	renderEach(node) {
		this.each(node);
	}
	scope(node) {
		this.node(node);
	}
	action(node) {
		this.node(node);
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
export class Collect extends Walker {
	eventHandlers = new Map();
	element(node) {
		if (node.eid !== null) this.eventHandlers.set(node.eid, node.handlers);
		super.element(node);
	}
	handler(_node, _handler) {}
}
