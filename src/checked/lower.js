// What a checked target's renders render to, vnodes, lowered to the tree they say and checked:
// this is where what field, each and render gave is known. Every issue is collected, each at the
// path of the node it's in (Root.children[1].children[0]), and thrown as one error.
//
// The markers tutuca wraps components and loop items in are comments, and loops are fragments:
// lowering skips the first and splices the second, so a node's children hold what a child
// component or an each renders as if it were written there. Adjacent text is joined.
import { VComment, VFragment, VNode, VText } from "../vdom/index.js";

// Children with fragments spliced, comments and empty text dropped and adjacent text joined.
export const spliced = (children) => {
	const out = [];
	const visit = (list) => {
		for (const child of list) {
			if (child instanceof VComment) continue;
			if (child instanceof VFragment) visit(child.children);
			else if (child instanceof VText) {
				if (child.text === "") continue;
				const last = out.at(-1);
				if (typeof last === "string") out[out.length - 1] = last + child.text;
				else out.push(child.text);
			} else out.push(child);
		}
	};
	visit(children);
	return out;
};
const describe = (child) =>
	typeof child === "string" ? `text ${JSON.stringify(child)}` : child.tag;

// The lowering of schema's trees, throwing an ErrorClass (a SchemaError).
// - defaults: by tag, attrs a node has when it leaves them out (mdast's spread).
// - checkNode(type, node, children, path, issues): what else a node of a tag must be, given its
//   spliced children (ps's Path starts with a MoveTo).
// - isRoot(type): whether a render's one node may be of type; rootsAre says which may.
export const checkedLower = (
	schema,
	ErrorClass,
	{ defaults = {}, checkNode = () => {}, isRoot = () => true, rootsAre = schema.aNode } = {},
) => {
	const lowerNode = (vnode, path, issues) => {
		const type = vnode.tag;
		const spec = schema.spec(type);
		const node = { type: spec.type };
		const { attrs } = vnode;
		for (const name in attrs) {
			const issue = schema.scalarIssue(type, name, attrs[name]);
			if (issue !== null) issues.push(`${path}: ${issue}`);
			else if (attrs[name] !== undefined && attrs[name] !== null) node[name] = attrs[name];
		}
		for (const name in spec.scalars) {
			if (!(name in attrs)) {
				const issue = schema.scalarIssue(type, name, undefined);
				if (issue !== null) issues.push(`${path}: ${issue}`);
			}
		}
		for (const [name, value] of Object.entries(defaults[type] ?? {})) {
			if (node[name] === undefined) node[name] = value;
		}
		const children = spliced(vnode.children);
		checkNode(type, node, children, path, issues);
		if (spec.literal) {
			const nodes = children.filter((c) => typeof c !== "string");
			for (const child of nodes) issues.push(`${path}: ${type} holds text, not ${describe(child)}`);
			const text = children.filter((c) => typeof c === "string").join("");
			if (node.value === undefined) node.value = text;
			else if (text !== "") issues.push(`${path}: ${type} has a value attr and text`);
			return node;
		}
		if (spec.children === null) {
			if (children.length > 0) issues.push(`${path}: ${type} takes no children`);
			return node;
		}
		node.children = [];
		children.forEach((child, i) => {
			const at = `${path}.children[${i}]`;
			if (typeof child === "string") {
				if (schema.takesText(type)) node.children.push({ type: "text", value: child });
				else issues.push(`${at}: ${type} can't hold ${describe(child)}`);
			} else if (!(child instanceof VNode) || schema.spec(child.tag) === undefined) {
				issues.push(`${at}: unknown ${schema.name} type ${child.tag}`);
			} else if (!schema.accepts(type, child.tag)) {
				issues.push(`${at}: ${type} takes ${schema.describeChildren(type)}, not ${child.tag}`);
			} else node.children.push(lowerNode(child, at, issues));
		});
		return node;
	};

	// The tree the vnodes a render rendered say: exactly one node.
	return (vnodes) => {
		const issues = [];
		const roots = spliced(vnodes);
		let tree = null;
		const [root] = roots;
		if (roots.length !== 1) {
			issues.push(`a ${schema.render} render renders one node, this one rendered ${roots.length}`);
		} else if (typeof root === "string" || schema.spec(root.tag) === undefined) {
			issues.push(`a ${schema.render} render renders ${schema.aNode}, not ${describe(root)}`);
		} else if (!isRoot(root.tag)) {
			issues.push(`a ${schema.render} render renders ${rootsAre}, not ${root.tag}`);
		} else tree = lowerNode(root, root.tag, issues);
		if (issues.length > 0) throw new ErrorClass(issues);
		return tree;
	};
};
