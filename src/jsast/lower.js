// What a renders.js renders to, vnodes, lowered to the ESTree it says, and checked: this is where
// what field, each and render gave is known. Every issue is collected, each at the ESTree path
// of the node it's in (Program.body[0].declarations[0].init), and thrown as one JsAstError.
//
// The markers tutuca wraps components and loop items in are comments, and loops are fragments:
// lowering skips the first and splices the second, so a slot holds what a child component or an
// each renders as if it were written there.
import { VComment, VFragment, VNode, VText } from "../vdom/index.js";
import {
	accepts,
	describeAccepts,
	describeType,
	HOLE,
	isTypeName,
	SCHEMA,
	scalarIssue,
} from "./schema.js";
import { JsAstError } from "./tags.js";

function* spliced(children) {
	for (const child of children) {
		if (child instanceof VComment) continue;
		if (child instanceof VFragment) yield* spliced(child.children);
		else if (child instanceof VText && child.text === "") continue;
		else yield child;
	}
}
const describe = (child) =>
	child instanceof VText ? `text ${JSON.stringify(child.text)}` : describeType(child.tag);

// Defaults for the scalars a tag may leave out, by type; the booleans not here are false.
const DEFAULTS = {
	Program: { sourceType: () => "module" },
	Property: { kind: () => "init" },
	UnaryExpression: { prefix: () => true },
	ArrowFunctionExpression: { expression: (n) => n.body?.type !== "BlockStatement" },
};

const lowerNode = (vnode, path, issues) => {
	const type = vnode.tag;
	const spec = SCHEMA[type];
	const node = { type };
	const attrs = vnode.attrs;
	const before = issues.length;
	for (const name in spec.scalars) {
		const issue = scalarIssue(type, name, attrs[name]);
		if (issue !== null) issues.push(`${path}: ${issue}`);
		else if (attrs[name] !== undefined) node[name] = attrs[name];
		else if (spec.scalars[name].kind === "boolean") node[name] = false;
	}
	for (const name in attrs) {
		if (!(name in spec.scalars)) issues.push(`${path}: ${scalarIssue(type, name, attrs[name])}`);
	}
	// The slots it was given, by name.
	const given = new Map();
	for (const child of spliced(vnode.children)) {
		if (!(child instanceof VNode)) issues.push(`${path}: ${type} can't hold ${describe(child)}`);
		else if (isTypeName(child.tag)) issues.push(`${path}: ${child.tag} needs a slot around it`);
		else if (!(child.tag in spec.slots)) issues.push(`${path}: ${type} has no slot ${child.tag}`);
		else if (given.has(child.tag)) issues.push(`${path}: ${type} has slot ${child.tag} twice`);
		else given.set(child.tag, child);
	}
	for (const [name, slotSpec] of Object.entries(spec.slots)) {
		const content = given.has(name) ? [...spliced(given.get(name).children)] : [];
		const lowered = [];
		content.forEach((child, i) => {
			const at =
				slotSpec.arity === "many" || slotSpec.arity === "holes"
					? `${path}.${name}[${i}]`
					: `${path}.${name}`;
			if (
				!(child instanceof VNode) ||
				!isTypeName(child.tag) ||
				(child.tag !== HOLE && SCHEMA[child.tag] === undefined)
			) {
				const what =
					child instanceof VNode && !isTypeName(child.tag) ? `slot ${child.tag}` : describe(child);
				issues.push(`${at}: expected ${describeAccepts(slotSpec)}, got ${what}`);
			} else if (!accepts(slotSpec, child.tag)) {
				issues.push(`${at}: expected ${describeAccepts(slotSpec)}, got ${describeType(child.tag)}`);
			} else lowered.push(child.tag === HOLE ? null : lowerNode(child, at, issues));
		});
		if (slotSpec.arity === "many" || slotSpec.arity === "holes") node[name] = lowered;
		else {
			if (content.length > 1) issues.push(`${path}.${name}: holds one node, got ${content.length}`);
			if (content.length === 0 && slotSpec.arity === "one")
				issues.push(`${path}: ${type} needs slot ${name}`);
			node[name] = lowered[0] ?? null;
		}
	}
	for (const [name, make] of Object.entries(DEFAULTS[type] ?? {})) {
		if (attrs[name] === undefined) node[name] = make(node);
	}
	// Checks across fields only say something about fields that are fine.
	const issue = issues.length === before ? (spec.check?.(node) ?? null) : null;
	if (issue !== null) issues.push(`${path}: ${type} ${issue}`);
	return node;
};

// The ESTree the vnodes a renders.js rendered say: exactly one node.
export const lower = (vchildren) => {
	const roots = [...spliced(vchildren)];
	const issues = [];
	let tree = null;
	if (roots.length !== 1)
		issues.push(`a js render renders one node, this one rendered ${roots.length}`);
	else {
		const [root] = roots;
		if (!(root instanceof VNode) || !isTypeName(root.tag) || SCHEMA[root.tag] === undefined) {
			const what =
				root instanceof VNode
					? isTypeName(root.tag)
						? `unknown type ${root.tag}`
						: `slot ${root.tag}`
					: describe(root);
			issues.push(`a js render renders an ESTree node, not ${what}`);
		} else tree = lowerNode(root, root.tag, issues);
	}
	if (issues.length > 0) throw new JsAstError(issues);
	return tree;
};
