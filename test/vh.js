// Builds raw vnodes for vdom-level tests, the way tutuca's DomNode would: every attr is dynamic
// and shapes are cached by tag, namespace and attr names, so equal templates share a shape.
import { Shape, VBase, VComment, VFragment, VNode, VText } from "../src/vdom.js";

const shapes = new Map();
const shapeFor = (tag, namespace, names) => {
	const id = JSON.stringify([tag, namespace, names]);
	if (!shapes.has(id)) shapes.set(id, new Shape(tag, namespace, {}, names));
	return shapes.get(id);
};

function addChild(childs, child) {
	if (child == null) return;
	if (typeof child !== "string" && typeof child[Symbol.iterator] === "function") {
		for (const c of child) addChild(childs, c);
	} else childs.push(child instanceof VBase ? child : new VText(child));
}
export const vchilds = (value) => {
	const childs = [];
	addChild(childs, value);
	return childs;
};

export function vh(tag, attrs = {}, children = null) {
	const { key, namespace = null, ...rest } = attrs;
	const names = Object.keys(rest);
	const values = names.map((name) => rest[name]);
	return new VNode(shapeFor(tag, namespace, names), values, vchilds(children), key);
}
export const vfrag = (children, key) => new VFragment(vchilds(children), key);
export const vcomment = (text) => new VComment(text);
