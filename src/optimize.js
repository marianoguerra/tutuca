// Render optimizations. tutuca.js says what a view evaluates to; this module makes evaluating it
// cheaper without changing the result. Every call site in tutuca.js is marked with `// OPT:`.
// Nodes are told apart by their Walker kind, so this module needs nothing from tutuca.js.
import { Shape, VComment, VText } from "./vdom.js";

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

const isText = (v) => typeof v === "string" || typeof v === "number";
// Read when the element is created or after its children, so they're never folded into the shape.
const DYNAMIC_ONLY = new Set(["value", "checked", "is", "dangerouslySetInnerHTML"]);

// What every render of a DomNode shares, computed once when it's built:
// - constant: handlers don't count, actions are evaluated on dispatch, not on render.
// - shape: constant attrs (and data-eid) are applied once on create and never diffed.
// - valueExprs: the other attrs, evaluated per render in shape.names order.
// - texts: literal text children as prebuilt vnodes, so morph skips them by identity.
export function planElement(node) {
	const { tagName, attrs, childs, eid } = node;
	const staticAttrs = {};
	const names = [];
	const valueExprs = [];
	let namespace = null;
	let keyExpr = null;
	for (const [name, value] of attrs) {
		if (name === "key") keyExpr = value;
		else if (name === "namespace") {
			if (!isConstant(value)) throw new Error(`<${tagName}> namespace must be a constant`);
			namespace = value.eval(null);
		} else if (isConstant(value) && !DYNAMIC_ONLY.has(name)) {
			staticAttrs[name] = value.eval(null);
		} else {
			names.push(name);
			valueExprs.push(value);
		}
	}
	if (eid !== null) staticAttrs["data-eid"] = eid;
	return {
		constant: attrs.every(([, v]) => isConstant(v)) && childs.every(isConstant),
		shape: new Shape(tagName, namespace, staticAttrs, names),
		valueExprs,
		keyExpr,
		texts: childs.map((c) =>
			c.constructor.kind === "constant" && isText(c.value) ? new VText(c.value) : null,
		),
		vnode: null,
	};
}

// A constant element builds once without a ctx and returns that vnode from then on, so morph
// skips the whole subtree by identity.
export function reuseConstant(node, ctx) {
	const { plan } = node;
	if (!plan.constant) return node.build(ctx);
	plan.vnode ??= node.build(null);
	return plan.vnode;
}

// One shared closing meta comment, so morph skips it by identity.
export const META_END = new VComment("§/§");
