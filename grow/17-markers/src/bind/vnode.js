// The vnodes the virtual DOM takes (spec/vdom/vnode.rkt), and morph.
//
// This is the only file that imports the virtual DOM. A node is one of
//
//   text(string)   comment(string)   group(key, nodes)
//   makeEl(tid, tag, ns, key, props, nodes)
//
// and morph(document, container, nodes, prev) puts nodes in container.
import { morph, Shape, VComment, VFragment, VNode, VText } from "../../../../src/vdom/index.js";

export { morph };

export const text = (string) => new VText(string);
export const comment = (string) => new VComment(string);
// A group keeps its nodes together under a key without making a DOM node.
export const group = (key, nodes) => new VFragment(nodes, key ?? undefined);

// tid is the element's template identity: elements with the same tid and key patch each
// other, any others replace each other. The virtual DOM compares elements by their Shape, so
// there is one Shape per tid: a tid always comes with the same tag, namespace and prop names.
const shapes = new Map();

// props is { name: value }. key and namespace have their own slots, so they are never props.
export function makeEl(tid, tag, ns, key, props, nodes) {
	const names = Object.keys(props).sort();
	let shape = shapes.get(tid);
	if (shape === undefined) {
		shape = new Shape(
			tag,
			ns,
			names.map((name) => [name, false]),
		);
		shapes.set(tid, shape);
	}
	return new VNode(
		shape,
		names.map((name) => props[name]),
		nodes,
		key ?? undefined,
	);
}
