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
// What every render of one template shares: tag, namespace, the attrs that never change and
// the names of the ones that do. Same-shape vnodes diff by index; different shapes replace.
// Attrs read when the element is created or after its children, so never static.
const DYNAMIC_ONLY = new Set(["value", "checked", "is", "dangerouslySetInnerHTML"]);
export class Shape {
	// attrs: [name, isStatic, value] entries. Static ones are kept, the rest named in order.
	constructor(tag, namespace, attrs) {
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
	}
}
export class VNode extends VBase {
	constructor(shape, values, childs, key) {
		super();
		this.shape = shape;
		this.values = values; // Aligned with shape.names.
		this.childs = childs;
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
			this.childs.length !== other.childs.length
		) {
			return false;
		}
		const a = this.values;
		const b = other.values;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return childsEqual(this.childs, other.childs);
	}
}
// Childs are already normalized: a flat array of vnodes.
export class VFragment extends VBase {
	constructor(childs, key) {
		super();
		this.key = key != null ? String(key) : undefined;
		this.childs = childs;
	}
	isEqualTo(other) {
		return (
			other instanceof VFragment && this.key === other.key && childsEqual(this.childs, other.childs)
		);
	}
}
// Any iterable is spliced into its parent, null and undefined render nothing, other values as text.
export function addChild(childs, child) {
	if (child == null) return;
	if (typeof child !== "string" && typeof child[Symbol.iterator] === "function") {
		for (const c of child) addChild(childs, c);
	} else if (child instanceof VBase) childs.push(child);
	else childs.push(new VText(child));
}
export const toVChilds = (value) => {
	const childs = [];
	addChild(childs, value);
	return childs;
};
const getKey = (child) => child.key;
// A pure vnode walk: much cheaper than morphing, which has to read the DOM at every element.
function childsEqual(a, b) {
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
		appendChildNodes(node, vnode.childs, doc, ns);
		return node;
	}
	if (vnode instanceof VText) return own(doc.createTextNode(vnode.text));
	if (vnode instanceof VComment) return own(doc.createComment(vnode.text));
	const { shape, values } = vnode;
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
	appendChildNodes(node, vnode.childs, doc, childNs(shape, elNs));
	// After the children, so a select's options exist before its value picks one.
	if (valueIdx !== -1 && values[valueIdx] !== undefined) applyValueLast(node, values[valueIdx]);
	if (checkedIdx !== -1 && values[checkedIdx] !== undefined)
		setProp(node, "checked", values[checkedIdx], false);
	return node;
}
function appendChildNodes(parent, childs, doc, ns) {
	for (const child of childs) parent.appendChild(toDom(child, doc, ns));
}
// A shared vnode skips by identity, an equal one by the cheaper vnode walk.
function morphNode(domNode, source, target, doc, ns) {
	if (source === target || source.isEqualTo(target)) return domNode;
	if (
		(source instanceof VText && target instanceof VText) ||
		(source instanceof VComment && target instanceof VComment)
	) {
		domNode.data = target.text;
		return domNode;
	}
	if (source instanceof VNode && target instanceof VNode && source.isSameKind(target)) {
		const { shape } = target;
		const { names, valueIdx, checkedIdx, htmlIdx } = shape;
		const a = source.values;
		const b = target.values;
		const namespaced = isNamespaced(domNode);
		for (let i = 0; i < names.length; i++) {
			if (i !== valueIdx && i !== checkedIdx && a[i] !== b[i])
				setProp(domNode, names[i], b[i], namespaced);
		}
		if (htmlIdx === -1 || !b[htmlIdx]) {
			const elNs = shape.namespace ?? ns;
			morphChildren(domNode, source.childs, target.childs, doc, childNs(shape, elNs));
		}
		if (valueIdx !== -1) {
			// A select reapplies its value whenever it changed, since its options may have.
			const reselect = domNode.tagName === "SELECT" && b[valueIdx] !== undefined;
			if (a[valueIdx] !== b[valueIdx] || reselect) applyValueLast(domNode, b[valueIdx]);
		}
		if (checkedIdx !== -1 && a[checkedIdx] !== b[checkedIdx])
			setProp(domNode, "checked", b[checkedIdx], false);
		return domNode;
	}
	const newNode = toDom(target, doc, ns);
	domNode.parentNode.replaceChild(newNode, domNode);
	return newNode;
}
// A fragment contributes the sum of its children's DOM widths, including zero.
// Snapshot references before editing; virtual indices need not equal DOM indices.
function domWidth(vnode) {
	return vnode instanceof VFragment ? vnode.childs.reduce((n, child) => n + domWidth(child), 0) : 1;
}
function mountBefore(parent, vnode, doc, ns, before) {
	const dom = toDom(vnode, doc, ns);
	const nodes = vnode instanceof VFragment ? Array.from(dom.childNodes) : [dom];
	parent.insertBefore(dom, before);
	return nodes;
}
function morphChildren(
	parentDom,
	oldChilds,
	newChilds,
	doc,
	ns,
	domNodes = ownedChildNodes(parentDom),
	before = null,
) {
	const oldGroups = [];
	const oldKeyMap = new Map();
	let offset = 0;
	for (let i = 0; i < oldChilds.length; i++) {
		const width = domWidth(oldChilds[i]);
		oldGroups.push(domNodes.slice(offset, offset + width));
		offset += width;
		const key = getKey(oldChilds[i]);
		if (key != null) {
			if (oldKeyMap.has(key)) throw new Error(`Duplicate sibling key: ${key}`);
			oldKeyMap.set(key, i);
		}
	}
	const used = new Uint8Array(oldChilds.length);
	let unkeyedCursor = 0;
	// Match unkeyed children in forward order, independently of placement order.
	const matches = newChilds.map((child) => {
		const key = getKey(child);
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
			while (unkeyedCursor < oldChilds.length) {
				const candidate = unkeyedCursor++;
				if (getKey(oldChilds[candidate]) == null) {
					index = candidate;
					break;
				}
			}
		}
		if (index >= 0) used[index] = 1;
		return index;
	});
	const newGroups = new Array(newChilds.length);
	// The next already-placed group provides a real insertion reference. Empty
	// groups leave it unchanged, including through arbitrarily nested fragments.
	for (let j = newChilds.length - 1; j >= 0; j--) {
		const target = newChilds[j];
		const index = matches[j];
		const source = oldChilds[index];
		const oldNodes = oldGroups[index];
		let nodes;
		if (source instanceof VFragment && target instanceof VFragment) {
			nodes = morphChildren(parentDom, source.childs, target.childs, doc, ns, oldNodes, before);
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
	for (let i = 0; i < oldChilds.length; i++) {
		if (used[i]) continue;
		for (const node of oldGroups[i]) parentDom.removeChild(node);
	}
	return newGroups.flat();
}
// Renders childs (a flat array of vnodes) into container, morphing from prev if given.
export function render(doc, container, childs, prev) {
	if (prev) morphChildren(container, prev, childs, doc, null);
	else {
		container.replaceChildren();
		appendChildNodes(container, childs, doc, null);
	}
}
