// Views (spec/view/view.rkt): expressions and rendering.
//
// A view is a tree of expressions and rendering is evaluating it. Evaluating builds the
// semantic tree of sem.js, and rendering a component makes a wrapper node. How the DOM records
// that wrapper is bind/lower.js's business, not the view's.
import { classOf } from "../component/instance.js";
import { keyOf, normalize } from "./normalize.js";
import * as sem from "./sem.js";

// A view expression. Anything else in a view is a value, and evaluates to itself.
export class Expr {
	constructor(type, parts) {
		this.type = type;
		Object.assign(this, parts);
	}
}

// Every h node carries its template id: each call of h is one template.
let nextTid = 0;

// h(tag, attrs, ...children). The attributes key and namespace go to their own slots.
export function h(tag, attrs = {}, ...children) {
	const props = [];
	let key = null;
	let ns = null;
	for (const [name, e] of Object.entries(attrs)) {
		if (name === "key") key = e;
		else if (name === "namespace") ns = e;
		else props.push([name, e]);
	}
	return new Expr("h", { tid: nextTid++, tag, props, key, ns, children: children.flat(Infinity) });
}
// Several roots.
export const frag = (...es) => new Expr("frag", { es });

// ---- render context ------------------------------------------------------

// The render context: the component whose view is being evaluated.
export const rootCtx = (value) => ({ component: value });
const withComponent = (ctx, value) => ({ ...ctx, component: value });

// The view a render uses: main.
export const bestView = (classDef) => classDef.views.main;

// ---- evaluation --------------------------------------------------------------

// The component's best view, evaluated with it as the component, inside a component wrapper.
export function renderView(value, ctx) {
	const classDef = classOf(value);
	if (classDef === undefined) throw new TypeError("render of a value that is not a component");
	return sem.component(
		classDef.name,
		normalize(evalExpr(withComponent(ctx, value), bestView(classDef))),
	);
}

// eval: what an expression evaluates to, a result.
export function evalExpr(ctx, e) {
	if (!(e instanceof Expr)) return e;
	switch (e.type) {
		case "h": {
			const props = {};
			for (const [name, value] of e.props) props[name] = evalExpr(ctx, value);
			return sem.el(
				e.tid,
				e.tag,
				e.ns,
				keyOf(evalExpr(ctx, e.key)),
				props,
				e.children.flatMap((child) => normalize(evalExpr(ctx, child))),
			);
		}
		case "frag":
			return e.es.map((child) => evalExpr(ctx, child));
	}
}

// Host.render: the root component's view, as the container's children.
export const renderRoot = (value) => normalize(renderView(value, rootCtx(value)));
