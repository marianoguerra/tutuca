// What a renders.md renders to, vnodes, lowered to the mdast it says, and checked: this is where
// what field, each and render gave is known. Every issue is collected, each at the path of the
// node it's in (Root.children[1].children[0]), and thrown as one MdAstError.
//
// The markers tutuca wraps components and loop items in are comments, and loops are fragments:
// lowering skips the first and splices the second, so a node's children hold what a child
// component or an each renders as if it were written there. Adjacent text is joined.
import { VComment, VFragment, VNode, VText } from "../vdom/index.js";
import { accepts, describeChildren, SCHEMA, scalarIssue, takesText } from "./schema.js";
import { MdAstError } from "./tags.js";

// Children with fragments spliced, comments and empty text dropped and adjacent text joined.
const spliced = (children) => {
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
// What a tag may leave out that the printer reads as something else: a list or item without
// spread is printed loose, a blank line between its items.
const DEFAULTS = { List: { spread: false }, ListItem: { spread: false } };
const describe = (child) =>
	typeof child === "string" ? `text ${JSON.stringify(child)}` : child.tag;

const lowerNode = (vnode, path, issues) => {
	const type = vnode.tag;
	const spec = SCHEMA[type];
	const node = { type: spec.type };
	const { attrs } = vnode;
	for (const name in attrs) {
		const issue = scalarIssue(type, name, attrs[name]);
		if (issue !== null) issues.push(`${path}: ${issue}`);
		else if (attrs[name] !== undefined && attrs[name] !== null) node[name] = attrs[name];
	}
	for (const name in spec.scalars) {
		if (!(name in attrs)) {
			const issue = scalarIssue(type, name, undefined);
			if (issue !== null) issues.push(`${path}: ${issue}`);
		}
	}
	for (const [name, value] of Object.entries(DEFAULTS[type] ?? {})) {
		if (node[name] === undefined) node[name] = value;
	}
	const children = spliced(vnode.children);
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
			if (takesText(type)) node.children.push({ type: "text", value: child });
			else issues.push(`${at}: ${type} can't hold ${describe(child)}`);
		} else if (!(child instanceof VNode) || SCHEMA[child.tag] === undefined) {
			issues.push(`${at}: unknown mdast type ${child.tag}`);
		} else if (!accepts(type, child.tag)) {
			issues.push(`${at}: ${type} takes ${describeChildren(type)}, not ${child.tag}`);
		} else node.children.push(lowerNode(child, at, issues));
	});
	return node;
};

// The mdast the vnodes a renders.md rendered say: exactly one node.
export const lower = (vnodes) => {
	const issues = [];
	const roots = spliced(vnodes);
	let tree = null;
	if (roots.length !== 1) {
		issues.push(`a md render renders one node, this one rendered ${roots.length}`);
	} else if (typeof roots[0] === "string" || SCHEMA[roots[0].tag] === undefined) {
		issues.push(`a md render renders an mdast node, not ${describe(roots[0])}`);
	} else tree = lowerNode(roots[0], roots[0].tag, issues);
	if (issues.length > 0) throw new MdAstError(issues);
	return tree;
};
