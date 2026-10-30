// Render optimizations. view.js says what a view evaluates to; this module makes evaluating it
// cheaper without changing the result. Every call site in view.js is marked with `// OPT:`.
// Nodes are told apart by their Walker kind, so this module needs nothing from view.js.
import { Shape, toVChilds, VNode } from "./vdom.js";

// A constant node evaluates to the same value with any ctx, including null. Anything that reads
// the ctx, runs user code or is unknown (custom AstNode subclasses) is not constant.
export function isConstant(node) {
	switch (node.constructor.kind) {
		case "constant":
			return true;
		case "element":
			return node.plan.constant;
		case "cond":
			return isConstant(node.source) && isConstant(node.thenVal) && isConstant(node.elseVal);
		default:
			return false;
	}
}

// What every render of a DomNode shares, computed once when it's built:
// - constant: handlers don't count, actions are evaluated on dispatch, not on render.
// - shape: constant attrs (and data-eid) are applied once on create and never diffed.
// - valueExprs: the other attrs, evaluated per render in shape.names order.
// - childs: constant children as prebuilt vnodes, so morph skips them by identity.
// - vnode: a constant element, prebuilt, so morph skips the whole subtree by identity.
export function planElement(node) {
	const { tagName, attrs, childs, eid } = node;
	const shapeAttrs = [];
	const exprs = new Map();
	let namespace = null;
	let keyExpr = null;
	for (const [name, value] of attrs) {
		if (name === "key") keyExpr = value;
		else if (name === "namespace") {
			if (!isConstant(value)) throw new Error(`<${tagName}> namespace must be a constant`);
			namespace = value.eval(null);
		} else {
			const isStatic = isConstant(value);
			shapeAttrs.push([name, isStatic, isStatic ? value.eval(null) : undefined]);
			exprs.set(name, value);
		}
	}
	if (eid !== null) shapeAttrs.push(["data-eid", true, eid]);
	const shape = new Shape(tagName, namespace, shapeAttrs);
	const valueExprs = shape.names.map((name) => exprs.get(name));
	const constant = attrs.every(([, v]) => isConstant(v)) && childs.every(isConstant);
	const prebuilt = childs.map((c) => (isConstant(c) ? toVChilds(c.eval(null)) : null));
	const vnode = constant
		? new VNode(
				shape,
				valueExprs.map((v) => v.eval(null)),
				prebuilt.flat(),
				keyExpr?.eval(null),
			)
		: null;
	return { constant, shape, valueExprs, keyExpr, childs: prebuilt, vnode };
}
