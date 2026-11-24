// Render optimizations. view.js says what a view evaluates to; this module makes evaluating it
// cheaper without changing the result. Every call site in view.js is marked with `// OPT:`.
// Nodes are told apart by their Walker kind, so this module needs nothing from view.js.
import { Shape, toVChildren, VFragment, VNode } from "../../vdom/index.js";

// A constant node evaluates to the same value with any ctx, including null. Anything that reads
// the ctx, runs user code or is unknown (custom ViewNode subclasses) is not constant.
export function isConstant(node) {
	switch (node.constructor.kind) {
		case "constant":
			return true;
		case "element":
			return node.plan.constant;
		case "cond":
			return isConstant(node.test) && isConstant(node.thenVal) && isConstant(node.elseVal);
		default:
			return false;
	}
}

const VARIES = { kids: null, keyless: false };
// What an element's children always are, when every render has the same ones: kids, for each
// one the Shape of an element or the vnode of a constant text or comment, and keyless, whether
// none has a key. kids is null when they vary: a child that isn't an element or a constant (a
// field renders as text, as nothing or as many), a fragment, or an element that isn't cloned.
function layoutOf(children, prebuilt) {
	const kids = [];
	let keyless = true;
	for (let i = 0; i < children.length; i++) {
		if (prebuilt[i] !== null) {
			for (const vnode of prebuilt[i]) {
				if (vnode instanceof VFragment) return VARIES;
				if (vnode instanceof VNode && !vnode.shape.plain) return VARIES;
				if (vnode.key !== undefined) keyless = false;
				kids.push(vnode instanceof VNode ? vnode.shape : vnode);
			}
		} else {
			if (children[i].constructor.kind !== "element") return VARIES;
			const { shape, keyExpr } = children[i].plan;
			if (!shape.plain) return VARIES;
			if (keyExpr !== null) keyless = false;
			kids.push(shape);
		}
	}
	return { kids, keyless };
}

// What every render of an ElementNode shares, computed once when it's built:
// - constant: event bindings don't count, actions are evaluated on dispatch, not on render.
// - shape: constant attrs (and data-eid) are applied once on create and never diffed.
// - valueExprs: the other attrs, evaluated per render in shape.names order.
// - children: constant children as prebuilt vnodes, so morph skips them by identity.
// - the shape's kids: what each child is when every render has the same ones (layoutOf), so
//   they're cloned with the element and, without keys, morphed by index.
// - vnode: a constant element, prebuilt, so morph skips the whole subtree by identity.
export function planElement(node) {
	const { tagName, attrs, children, eid } = node;
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
	const prebuilt = children.map((c) => (isConstant(c) ? toVChildren(c.eval(null)) : null));
	const { kids, keyless } = layoutOf(children, prebuilt);
	const shape = new Shape(tagName, namespace, shapeAttrs, kids, keyless);
	const valueExprs = shape.names.map((name) => exprs.get(name));
	const constant = attrs.every(([, v]) => isConstant(v)) && children.every(isConstant);
	const vnode = constant
		? new VNode(
				shape,
				valueExprs.map((v) => v.eval(null)),
				prebuilt.flat(),
				keyExpr?.eval(null),
			)
		: null;
	return { constant, shape, valueExprs, keyExpr, children: prebuilt, vnode };
}
