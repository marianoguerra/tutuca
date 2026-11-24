export const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";
// Core: explicit fragments preserve a virtual boundary without creating DOM nodes.
export class VBase {}
export class VText extends VBase {
	constructor(text) {
		super();
		this.text = String(text);
	}
	isEqualTo(other) {
		return other instanceof VText && this.text === other.text;
	}
}
export class VComment extends VBase {
	constructor(text) {
		super();
		this.text = text;
	}
	isEqualTo(other) {
		return other instanceof VComment && this.text === other.text;
	}
}
// What every render of one template shares: tag, namespace, the attrs that never change, the
// names of the ones that do and, when the view fixes them, its children's layout. Same-shape
// vnodes diff by index; different shapes replace.
// Attrs read when the element is created or after its children, so never static.
const NO_NAMES = [];
const DYNAMIC_ONLY = new Set(["value", "checked", "is", "dangerouslySetInnerHTML"]);
export class Shape {
	// attrs: [name, isStatic, value] entries. Static ones are kept, the rest named in order.
	// kids: what each child always is, when every render has the same ones (planElement): the
	// Shape of an element, or the vnode itself of a constant text or comment; null when they vary.
	// fixedChildren: kids that have no keys either, so two renders' children pair by index.
	constructor(tag, namespace, attrs, kids = null, fixedChildren = false) {
		if (namespace == null) {
			const lower = tag.toLowerCase();
			if (lower === "svg" || lower === "math") {
				namespace = lower === "svg" ? SVG_NS : MATH_NS;
				tag = lower;
			}
		}
		const staticAttrs = {};
		const names = [];
		for (const [name, isStatic, value] of attrs) {
			if (isStatic && !DYNAMIC_ONLY.has(name)) staticAttrs[name] = value;
			else names.push(name);
		}
		this.tag = tag;
		this.namespace = typeof namespace === "string" ? namespace : null;
		this.staticAttrs = staticAttrs; // Set when the element is created, never diffed.
		this.names = names;
		this.valueIdx = names.indexOf("value");
		this.checkedIdx = names.indexOf("checked");
		this.isIdx = names.indexOf("is");
		this.htmlIdx = names.indexOf("dangerouslySetInnerHTML");
		this.isSelect = tag.toLowerCase() === "select";
		this.kids = kids;
		this.fixedChildren = kids !== null && fixedChildren;
		// Whether cloning a template makes it: not a custom element, whose constructor would run
		// for the template too, or a customized built-in, which createElement has to be told of.
		this.plain = this.isIdx === -1 && !tag.includes("-");
		this.template = null; // { doc, ns, node }: the last skeleton built of it (templateOf).
		this.late = NO_NAMES; // The static attrs a clone loses, set again on each one (skeletonOf).
	}
}
export class VNode extends VBase {
	/** @param {Shape} shape @param {VBase[]} children */
	constructor(shape, values, children, key) {
		super();
		this.shape = shape;
		this.values = values; // Aligned with shape.names.
		this.children = children;
		this.key = key != null ? String(key) : undefined;
	}
	get tag() {
		return this.shape.tag;
	}
	get namespace() {
		return this.shape.namespace;
	}
	// All attrs by name, for tools; rendering reads shape and values directly.
	get attrs() {
		const attrs = { ...this.shape.staticAttrs };
		this.shape.names.forEach((name, i) => {
			attrs[name] = this.values[i];
		});
		return attrs;
	}
	isSameKind(other) {
		return this.shape === other.shape && this.key === other.key;
	}
	isEqualTo(other) {
		if (this === other) return true;
		if (
			!(other instanceof VNode) ||
			!this.isSameKind(other) ||
			this.children.length !== other.children.length
		) {
			return false;
		}
		const a = this.values;
		const b = other.values;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return childrenEqual(this.children, other.children);
	}
}
// Children are already normalized: a flat array of vnodes.
export class VFragment extends VBase {
	/** @param {VBase[]} children */
	constructor(children, key) {
		super();
		this.key = key != null ? String(key) : undefined;
		this.children = children;
		this._width = -1;
	}
	// How many DOM nodes it renders as: the sum of its children's, which can be none.
	get width() {
		if (this._width === -1) {
			let width = 0;
			for (const child of this.children) width += child instanceof VFragment ? child.width : 1;
			this._width = width;
		}
		return this._width;
	}
	isEqualTo(other) {
		return (
			this === other ||
			(other instanceof VFragment &&
				this.key === other.key &&
				childrenEqual(this.children, other.children))
		);
	}
}
// A function as a child is a view reading a method where it meant its result (field("score") for
// score(x) { ... }): its source as text looks like part of the page, so it shows as an error.
export const functionChildText = (fn) =>
	`⚠ ${fn.name || "a function"} is a function, not a value: read what it returns`;
// Any iterable is spliced into its parent, null and undefined render nothing, other values as text.
export function addChild(children, child) {
	if (child == null) return;
	if (typeof child === "function") {
		console.error(functionChildText(child));
		children.push(new VText(functionChildText(child)));
	} else if (typeof child !== "string" && typeof child[Symbol.iterator] === "function") {
		for (const c of child) addChild(children, c);
	} else if (child instanceof VBase) children.push(child);
	else children.push(new VText(child));
}
export const toVChildren = (value) => {
	const children = [];
	addChild(children, value);
	return children;
};
// Whether two renders' children are equal, as a pure vnode walk.
export function childrenEqual(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !a[i].isEqualTo(b[i])) return false;
	return true;
}
// DOM: building and patching real nodes from vnodes
// ns is the namespace children inherit from their parent, null for HTML.
const isNamespaced = (node) => node.namespaceURI !== null && node.namespaceURI !== HTML_NS;
const isForeignObject = (tag) => tag.length === 13 && tag.toLowerCase() === "foreignobject";
const childNs = (shape, ns) => (ns === SVG_NS && isForeignObject(shape.tag) ? null : ns);
const NEVER_ASSIGN_STR =
	"width height href list form tabIndex download rowSpan colSpan role popover";
const NEVER_ASSIGN = new Set(NEVER_ASSIGN_STR.split(" "));
const PROP_ATTR_NAME = { className: "class", htmlFor: "for" };
function setProp(node, name, value, namespaced) {
	if (name === "dangerouslySetInnerHTML") {
		if (value === undefined) node.replaceChildren();
		else {
			const html = value.__html ?? "";
			// Skip the re-parse when the markup is identical (preact does the same).
			if (html !== node.innerHTML) node.innerHTML = html;
		}
		return;
	}
	if (typeof value === "function") return;
	const usesProp = !namespaced && !NEVER_ASSIGN.has(name) && name in node;
	if (usesProp && value != null) {
		try {
			node[name] = value;
			return;
		} catch {}
	}
	if (value == null || (value === false && name[4] !== "-")) {
		if (usesProp) {
			try {
				node[name] = "";
			} catch {}
			node.removeAttribute(PROP_ATTR_NAME[name] ?? name);
		} else node.removeAttribute(name);
	} else node.setAttribute(name, value);
}
function applyValueLast(node, value) {
	if (node.tagName === "PROGRESS" && (value == null || value === 0)) {
		node.removeAttribute("value");
	} else {
		setProp(node, "value", value, isNamespaced(node));
	}
}
// The nodes render made. Morphing matches vnodes to these only, so nodes other code put in a
// rendered element (an extension, a third-party widget) don't shift the match, and stay.
const owned = new WeakSet();
const own = (node) => {
	owned.add(node);
	return node;
};
const ownedChildNodes = (parent) => Array.from(parent.childNodes).filter((n) => owned.has(n));
function nextOwnedSibling(node) {
	let next = node.nextSibling;
	while (next !== null && !owned.has(next)) next = next.nextSibling;
	return next;
}
function toDom(vnode, doc, ns) {
	if (vnode instanceof VFragment) {
		const node = doc.createDocumentFragment();
		appendChildNodes(node, vnode.children, doc, ns);
		return node;
	}
	if (vnode instanceof VText) return own(doc.createTextNode(vnode.text));
	if (vnode instanceof VComment) return own(doc.createComment(vnode.text));
	const { shape, values } = vnode;
	// OPT: an element whose children the view fixes is cloned whole from its template, in a
	// document whose nodes clone (a page's: a terminal's, src/tui/tdom.js, builds them).
	if (shape.kids !== null && shape.kids.length > 0 && shape.plain && doc.cloneNode !== undefined) {
		return fill(templateOf(shape, doc, ns).cloneNode(true), vnode, doc, ns);
	}
	const { names, staticAttrs, valueIdx, checkedIdx } = shape;
	const elNs = shape.namespace ?? ns;
	const is = shape.isIdx === -1 ? null : values[shape.isIdx];
	const createOpts = is != null ? { is } : undefined;
	const node =
		elNs === null
			? doc.createElement(shape.tag, createOpts)
			: doc.createElementNS(elNs, shape.tag, createOpts);
	own(node);
	const namespaced = isNamespaced(node);
	for (const name in staticAttrs) setProp(node, name, staticAttrs[name], namespaced);
	for (let i = 0; i < names.length; i++) {
		if (i !== valueIdx && i !== checkedIdx) setProp(node, names[i], values[i], namespaced);
	}
	appendChildNodes(node, vnode.children, doc, childNs(shape, elNs));
	applyLast(node, shape, values);
	return node;
}
// After the children, so a select's options exist before its value picks one.
function applyLast(node, { valueIdx, checkedIdx }, values) {
	if (valueIdx !== -1 && values[valueIdx] !== undefined) applyValueLast(node, values[valueIdx]);
	if (checkedIdx !== -1 && values[checkedIdx] !== undefined)
		setProp(node, "checked", values[checkedIdx], false);
}
function appendChildNodes(parent, children, doc, ns) {
	for (const child of children) parent.appendChild(toDom(child, doc, ns));
}
// Templates: what every element of a shape starts as, built once and cloned.
// Whether a clone has what setting the static attr name gave node: an attribute is copied, a
// property that doesn't reflect one (indeterminate, a media element's muted) isn't.
function survivesClone(node, clone, name) {
	if (!(name in node)) return true;
	const a = node[name];
	const b = clone[name];
	return a === b || (typeof a === "object" && a !== null && String(a) === String(b));
}
// The element every vnode of shape starts as, in a parent of namespace ns: its static attrs set
// and, when its children are fixed (shape.kids), theirs inside it. Its nodes are not owned.
function skeletonOf(shape, doc, ns) {
	const { staticAttrs, kids } = shape;
	const elNs = shape.namespace ?? ns;
	const node = elNs === null ? doc.createElement(shape.tag) : doc.createElementNS(elNs, shape.tag);
	const namespaced = isNamespaced(node);
	for (const name in staticAttrs) setProp(node, name, staticAttrs[name], namespaced);
	if (!namespaced) {
		const clone = node.cloneNode(false);
		const late = [];
		for (const name in staticAttrs) if (!survivesClone(node, clone, name)) late.push(name);
		shape.late = late.length > 0 ? late : NO_NAMES;
	}
	if (kids !== null) {
		const kidNs = childNs(shape, elNs);
		for (const kid of kids) {
			if (kid instanceof Shape) node.appendChild(skeletonOf(kid, doc, kidNs));
			else if (kid instanceof VText) node.appendChild(doc.createTextNode(kid.text));
			else node.appendChild(doc.createComment(kid.text));
		}
	}
	return node;
}
function templateOf(shape, doc, ns) {
	const had = shape.template;
	if (had !== null && had.doc === doc && had.ns === ns) return had.node;
	const node = skeletonOf(shape, doc, ns);
	shape.template = { doc, ns, node };
	return node;
}
// Makes node, a clone of the skeleton of vnode's shape, the element toDom makes for vnode: owned,
// with the attrs that vary and the children the skeleton doesn't have.
function fill(node, vnode, doc, ns) {
	const { shape, values, children } = vnode;
	const { names, staticAttrs, late, kids, valueIdx, checkedIdx } = shape;
	own(node);
	const elNs = shape.namespace ?? ns;
	const namespaced = elNs !== null && elNs !== HTML_NS;
	for (let i = 0; i < late.length; i++) setProp(node, late[i], staticAttrs[late[i]], namespaced);
	for (let i = 0; i < names.length; i++) {
		if (i !== valueIdx && i !== checkedIdx) setProp(node, names[i], values[i], namespaced);
	}
	const kidNs = childNs(shape, elNs);
	if (kids === null) appendChildNodes(node, children, doc, kidNs);
	else if (kids.length !== children.length) {
		// Not a vnode the shape's view made: its children are whatever it has.
		node.replaceChildren();
		appendChildNodes(node, children, doc, kidNs);
	} else {
		let dom = node.firstChild;
		for (let i = 0; i < kids.length; i++) {
			const next = dom.nextSibling;
			const child = children[i];
			if (child === kids[i]) own(dom);
			else if (child.shape === kids[i]) fill(dom, child, doc, kidNs);
			else node.replaceChild(toDom(child, doc, kidNs), dom);
			dom = next;
		}
	}
	applyLast(node, shape, values);
	return node;
}
// Morphing: one walk over the two renders, which reads the DOM only where they differ.
// A rendered element that isn't looked up until something in it changes: the node at index
// among parent's owned children, as they were before this morph changed any.
class Ref {
	parent = null;
	index = 0;
	node = null;
	kids = null;
	get() {
		if (this.node === null) this.node = this.parent.children()[this.index];
		return this.node;
	}
	children() {
		if (this.kids === null) this.kids = ownedChildNodes(this.get());
		return this.kids;
	}
}
// OPT: one Ref per depth of the walk, used again by every element at that depth: most elements
// are the same as before, and would make one only to drop it.
const refs = [];
let depth = 0;
let deepest = 0; // How many of refs hold nodes of the morph going on.
function enter(parent, index, node) {
	if (depth === refs.length) refs.push(new Ref());
	const ref = refs[depth++];
	if (depth > deepest) deepest = depth;
	ref.parent = parent;
	ref.index = index;
	ref.node = node;
	ref.kids = null;
	return ref;
}
// Morphs a, children whose DOM nodes start at offset among ref's, into b. Those that pair by
// index (the same key, a fragment for a fragment), as far as they do, are morphed in order, so
// the nodes after the ones being morphed are still where ref's children say; matching by key
// would pair them the same. The rest, if any, are matched by key (morphChildren).
function morphList(ref, a, b, offset, doc, ns) {
	const count = Math.min(a.length, b.length);
	let i = 0;
	for (; i < count; i++) {
		const s = a[i];
		const t = b[i];
		if (s === t) offset += s instanceof VFragment ? s.width : 1;
		else if (s instanceof VFragment) {
			if (!(t instanceof VFragment) || s.key !== t.key) break;
			morphList(ref, s.children, t.children, offset, doc, ns);
			offset += s.width;
		} else {
			if (t instanceof VFragment || s.key !== t.key) break;
			morphAt(ref, offset++, s, t, doc, ns);
		}
	}
	if (i === a.length && i === b.length) return;
	let end = offset;
	for (let k = i; k < a.length; k++) end += a[k] instanceof VFragment ? a[k].width : 1;
	const kids = ref.children();
	const nodes = kids.slice(offset, end);
	const before = kids[end] ?? null;
	if (i === 0) morphChildren(ref.get(), a, b, doc, ns, nodes, before);
	else morphChildren(ref.get(), a.slice(i), b.slice(i), doc, ns, nodes, before, b, i);
}
// OPT: children the view fixes (shape.fixedChildren) pair by index, without looking.
function morphFixed(ref, a, b, doc, ns) {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) morphAt(ref, i, a[i], b[i], doc, ns);
}
// Morphs source, the vnode of the node at index among ref's children, into target.
function morphAt(ref, index, source, target, doc, ns) {
	if (source instanceof VNode && target instanceof VNode && source.isSameKind(target)) {
		morphElement(enter(ref, index, null), source, target, doc, ns);
		depth--;
	} else if (
		(source instanceof VText && target instanceof VText) ||
		(source instanceof VComment && target instanceof VComment)
	) {
		if (source.text !== target.text) ref.children()[index].data = target.text;
	} else {
		const old = ref.children()[index];
		old.parentNode.replaceChild(toDom(target, doc, ns), old);
	}
}
// Morphs source, the vnode of ref's element, into target, of the same kind.
function morphElement(ref, source, target, doc, ns) {
	const { shape } = target;
	const { names, valueIdx, checkedIdx, htmlIdx } = shape;
	const a = source.values;
	const b = target.values;
	// A select reapplies its value whenever anything in it changed, since its options may have.
	if (shape.isSelect && valueIdx !== -1 && source.isEqualTo(target)) return;
	const elNs = shape.namespace ?? ns;
	for (let i = 0; i < names.length; i++) {
		if (i !== valueIdx && i !== checkedIdx && a[i] !== b[i])
			setProp(ref.get(), names[i], b[i], elNs !== null && elNs !== HTML_NS);
	}
	if (htmlIdx === -1 || !b[htmlIdx]) {
		const kidNs = childNs(shape, elNs);
		if (shape.fixedChildren) morphFixed(ref, source.children, target.children, doc, kidNs);
		else morphList(ref, source.children, target.children, 0, doc, kidNs);
	}
	if (valueIdx !== -1) {
		const reselect = shape.isSelect && b[valueIdx] !== undefined;
		if (a[valueIdx] !== b[valueIdx] || reselect) applyValueLast(ref.get(), b[valueIdx]);
	}
	if (checkedIdx !== -1 && a[checkedIdx] !== b[checkedIdx])
		setProp(ref.get(), "checked", b[checkedIdx], false);
}
// Morphs source, domNode's vnode, into target; returns the node target has, domNode or a new one.
function morphNode(domNode, source, target, doc, ns) {
	if (source === target) return domNode;
	if (source instanceof VNode && target instanceof VNode && source.isSameKind(target)) {
		morphElement(enter(null, 0, domNode), source, target, doc, ns);
		depth--;
		return domNode;
	}
	if (
		(source instanceof VText && target instanceof VText) ||
		(source instanceof VComment && target instanceof VComment)
	) {
		if (source.text !== target.text) domNode.data = target.text;
		return domNode;
	}
	const newNode = toDom(target, doc, ns);
	domNode.parentNode.replaceChild(newNode, domNode);
	return newNode;
}
function mountBefore(parent, vnode, doc, ns, before) {
	const dom = toDom(vnode, doc, ns);
	const nodes = vnode instanceof VFragment ? Array.from(dom.childNodes) : [dom];
	parent.insertBefore(dom, before);
	return nodes;
}
// Morphs children that don't pair by index: matched by key, or in order when they have none, then
// placed, mounted or removed. domNodes are the nodes oldChildren have, before the node after them.
// The first paired of siblings are the ones already paired by index: their keys are taken.
function morphChildren(
	parentDom,
	oldChildren,
	newChildren,
	doc,
	ns,
	domNodes,
	before,
	siblings = null,
	paired = 0,
) {
	const oldGroups = [];
	const oldKeyMap = new Map();
	for (let i = 0; i < paired; i++) {
		const key = siblings[i].key;
		if (key != null) oldKeyMap.set(key, -1);
	}
	let offset = 0;
	for (let i = 0; i < oldChildren.length; i++) {
		const child = oldChildren[i];
		const width = child instanceof VFragment ? child.width : 1;
		oldGroups.push(domNodes.slice(offset, offset + width));
		offset += width;
		const key = child.key;
		if (key != null) {
			if (oldKeyMap.has(key)) throw new Error(`Duplicate sibling key: ${key}`);
			oldKeyMap.set(key, i);
		}
	}
	const used = new Uint8Array(oldChildren.length);
	let unkeyedCursor = 0;
	// Match unkeyed children in forward order, independently of placement order.
	const matches = newChildren.map((child) => {
		const key = child.key;
		let index = -1;
		if (key != null) {
			const previous = oldKeyMap.get(key);
			if (previous === -1 || (previous !== undefined && used[previous])) {
				throw new Error(`Duplicate sibling key: ${key}`);
			}
			index = previous ?? -1;
			// Remember newly introduced keys in the map we already use for matching.
			if (previous === undefined) oldKeyMap.set(key, -1);
		} else {
			while (unkeyedCursor < oldChildren.length) {
				const candidate = unkeyedCursor++;
				if (oldChildren[candidate].key == null) {
					index = candidate;
					break;
				}
			}
		}
		if (index >= 0) used[index] = 1;
		return index;
	});
	const newGroups = new Array(newChildren.length);
	// The next already-placed group provides a real insertion reference. Empty
	// groups leave it unchanged, including through arbitrarily nested fragments.
	for (let j = newChildren.length - 1; j >= 0; j--) {
		const target = newChildren[j];
		const index = matches[j];
		const source = oldChildren[index];
		const oldNodes = oldGroups[index];
		let nodes;
		if (source === target && source instanceof VFragment) {
			// OPT: a shared fragment (a cached render's loop) has the nodes it had: only placed.
			nodes = oldNodes;
			const last = nodes.at(-1);
			if (last !== undefined && nextOwnedSibling(last) !== before) {
				for (const node of nodes) parentDom.insertBefore(node, before);
			}
		} else if (source instanceof VFragment && target instanceof VFragment) {
			nodes = morphChildren(parentDom, source.children, target.children, doc, ns, oldNodes, before);
		} else if (source && !(source instanceof VFragment) && !(target instanceof VFragment)) {
			const node = morphNode(oldNodes[0], source, target, doc, ns);
			if (nextOwnedSibling(node) !== before) {
				parentDom.insertBefore(node, before);
			}
			nodes = [node];
		} else {
			nodes = mountBefore(parentDom, target, doc, ns, before);
			if (oldNodes) for (const node of oldNodes) parentDom.removeChild(node);
		}
		newGroups[j] = nodes;
		if (nodes.length) before = nodes[0];
	}
	for (let i = 0; i < oldChildren.length; i++) {
		if (used[i]) continue;
		for (const node of oldGroups[i]) parentDom.removeChild(node);
	}
	return newGroups.flat();
}
// Puts children (a flat array of vnodes) in container: morphs what prev rendered there into them,
// or, without prev, replaces what container holds.
export function morph(doc, container, children, prev) {
	if (prev) {
		// A morph inside this one (an element that renders when it's made) walks deeper, and a
		// throw leaves the walk where this one started.
		const start = depth;
		try {
			morphList(enter(null, 0, container), prev, children, 0, doc, null);
		} finally {
			depth = start;
			if (start === 0) {
				for (let i = 0; i < deepest; i++) refs[i].node = refs[i].kids = null;
				deepest = 0;
			}
		}
	} else {
		container.replaceChildren();
		appendChildNodes(container, children, doc, null);
	}
}
