export const HTML_NS = "http://www.w3.org/1999/xhtml";
export const SVG_NS = "http://www.w3.org/2000/svg";
export const MATH_NS = "http://www.w3.org/1998/Math/MathML";
// SVG / MathML elements expose their attributes as read-only IDL properties
// (`cx`, `viewBox`, …), so on a namespaced node every attribute must go
// through setAttribute rather than the `node[prop] = val` property path.
const isNamespaced = (node) => {
  const ns = node.namespaceURI;
  return ns !== null && ns !== HTML_NS;
};
// Per SVG spec, <foreignObject> is itself an SVG element but its children
// are HTML — every descent into a foreignObject must switch the inherited
// namespace back to null (HTML).
const isForeignObject = (tag) => tag.length === 13 && tag.toLowerCase() === "foreignobject";
// Namespace inherited from the nearest namespaced ancestor: VNodes get their
// own namespace from h() or the template parser, but children created via
// the `h()` API don't know about their parent. opts.namespace threads the
// inherited value through toDom and morphChildren.
const effectiveNs = (vnode, opts) => vnode.namespace ?? opts.namespace ?? null;
// Compute the namespace to pass to this vnode's children.
function childOpts(vnode, ns, opts) {
  const target = ns === SVG_NS && isForeignObject(vnode.tag) ? null : ns;
  return target === (opts.namespace ?? null) ? opts : { ...opts, namespace: target };
}
// Property names that exist on DOM nodes but whose setters misbehave for our
// purposes (mirrors preact/src/diff/props.js setProperty). Forces setAttribute.
const NEVER_ASSIGN = new Set([
  "width",
  "height",
  "href",
  "list",
  "form",
  "tabIndex",
  "download",
  "rowSpan",
  "colSpan",
  "role",
  "popover",
]);
export function applyProperties(node, props) {
  const namespaced = isNamespaced(node);
  for (const name in props) setProp(node, name, props[name], namespaced);
}
// Route a single attribute. Borrowed from preact: prefer IDL property
// assignment when the name exists on the node (it reflects to the attribute),
// otherwise use setAttribute. Lowercase HTML attributes whose IDL property is
// camelCase (`tabindex` → `tabIndex`, `readonly` → `readOnly`, …) fail the
// `in` check and fall through to setAttribute, which is the correct path.
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
  if (!namespaced && !NEVER_ASSIGN.has(name) && name in node) {
    try {
      node[name] = value == null ? "" : value;
      return;
    } catch {}
  }
  // `data-*` / `aria-*` preserve a literal "false" since it's semantically
  // distinct from the attribute being absent; everything else removes.
  if (value == null || (value === false && name[4] !== "-")) node.removeAttribute(name);
  else node.setAttribute(name, value);
}
// `value` and `checked` must be applied AFTER siblings/children, so that
// (a) <input min=… max=… value=…> clamps the value against the final range,
// (b) <select><option> diff completes before we tell the select which option
//     should be selected. Mirrors preact/src/diff/index.js end-of-diffElementNodes.
function applyValueLast(node, value) {
  // <progress value=0> via the IDL setter is treated as indeterminate;
  // force the attribute path so the bar shows 0% instead of unknown.
  if (node.tagName === "PROGRESS" && (value == null || value === 0)) {
    node.removeAttribute("value");
  } else {
    setProp(node, "value", value, isNamespaced(node));
  }
}
export class VBase {}
const getKey = (child) => (child instanceof VNode ? child.key : undefined);
const isIterable = (obj) =>
  obj != null && typeof obj !== "string" && typeof obj[Symbol.iterator] === "function";
function childsEqual(a, b) {
  if (a === b) return true;
  for (let i = 0; i < a.length; i++) if (!a[i].isEqualTo(b[i])) return false;
  return true;
}
function appendChildNodes(parent, childs, opts) {
  for (const child of childs) parent.appendChild(child.toDom(opts));
}
function addChild(normalizedChildren, child) {
  if (child == null) return;
  if (isIterable(child)) {
    for (const c of child) addChild(normalizedChildren, c);
  } else if (child instanceof VBase) {
    if (child instanceof VFragment) normalizedChildren.push(...child.childs);
    else normalizedChildren.push(child);
  } else normalizedChildren.push(new VText(child));
}
export class VText extends VBase {
  constructor(text) {
    super();
    this.text = String(text);
  }
  get nodeType() {
    return 3;
  }
  isEqualTo(other) {
    return other instanceof VText && this.text === other.text;
  }
  toDom(opts) {
    return opts.document.createTextNode(this.text);
  }
}
export class VComment extends VBase {
  constructor(text) {
    super();
    this.text = text;
  }
  get nodeType() {
    return 8;
  }
  isEqualTo(other) {
    return other instanceof VComment && this.text === other.text;
  }
  toDom(opts) {
    return opts.document.createComment(this.text);
  }
}
export class VFragment extends VBase {
  constructor(childs) {
    super();
    this.childs = [];
    addChild(this.childs, childs);
  }
  get nodeType() {
    return 11;
  }
  isEqualTo(other) {
    if (!(other instanceof VFragment) || this.childs.length !== other.childs.length) return false;
    return childsEqual(this.childs, other.childs);
  }
  toDom(opts) {
    const fragment = opts.document.createDocumentFragment();
    appendChildNodes(fragment, this.childs, opts);
    return fragment;
  }
}
export class VNode extends VBase {
  constructor(tag, attrs, childs, key, namespace) {
    super();
    this.tag = tag;
    this.attrs = attrs ?? {};
    this.childs = childs ?? [];
    this.key = key != null ? String(key) : undefined;
    this.namespace = typeof namespace === "string" ? namespace : null;
  }
  get nodeType() {
    return 1;
  }
  isSameKind(other) {
    return this.tag === other.tag && this.namespace === other.namespace && this.key === other.key;
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
    if (this.attrs !== other.attrs) {
      for (const key in this.attrs) if (this.attrs[key] !== other.attrs[key]) return false;
      for (const key in other.attrs) if (!Object.hasOwn(this.attrs, key)) return false;
    }
    return childsEqual(this.childs, other.childs);
  }
  toDom(opts) {
    const doc = opts.document;
    const ns = effectiveNs(this, opts);
    // h() uppercases all-lowercase HTML tags for cheap identity comparisons.
    // When the inherited namespace says we're really inside SVG/MathML, undo
    // that normalization so createElementNS uses the spec-cased local name
    // (`rect`, not `RECT`). Mixed-case tags (linearGradient, foreignObject)
    // are already preserved by h() and pass through here untouched.
    const tag =
      ns !== null && this.tag === this.tag.toUpperCase() ? this.tag.toLowerCase() : this.tag;
    // `is` opts customised built-in elements (e.g. <button is="x-cool">).
    // Must be passed at construction time; setAttribute later does NOT upgrade.
    const attrs = this.attrs;
    const createOpts = attrs.is != null ? { is: attrs.is } : undefined;
    const node =
      ns === null ? doc.createElement(tag, createOpts) : doc.createElementNS(ns, tag, createOpts);
    const cOpts = childOpts(this, ns, opts);
    if ("value" in attrs || "checked" in attrs) {
      const { value, checked, ...rest } = attrs;
      applyProperties(node, rest);
      appendChildNodes(node, this.childs, cOpts);
      if (value !== undefined) applyValueLast(node, value);
      if (checked !== undefined) setProp(node, "checked", checked, false);
    } else {
      applyProperties(node, attrs);
      appendChildNodes(node, this.childs, cOpts);
    }
    return node;
  }
}
function diffProps(a, b) {
  if (a === b) return null;
  let diff = null;
  for (const aKey in a) {
    if (!Object.hasOwn(b, aKey)) {
      diff ??= {};
      diff[aKey] = undefined;
    } else if (a[aKey] !== b[aKey]) {
      diff ??= {};
      diff[aKey] = b[aKey];
    }
  }
  for (const bKey in b) {
    if (!Object.hasOwn(a, bKey)) {
      diff ??= {};
      diff[bKey] = b[bKey];
    }
  }
  return diff;
}
function morphNode(domNode, source, target, opts) {
  if (source === target || source.isEqualTo(target)) return domNode;
  const type = source.nodeType;
  if (type === target.nodeType) {
    if (type === 3 || type === 8) {
      domNode.data = target.text;
      return domNode;
    }
    if (type === 1 && source.isSameKind(target)) {
      const propsDiff = diffProps(source.attrs, target.attrs);
      let pendingValue;
      let pendingChecked;
      let applyValue = false;
      let applyChecked = false;
      if (propsDiff) {
        if ("value" in propsDiff || "checked" in propsDiff) {
          const { value, checked, ...rest } = propsDiff;
          applyProperties(domNode, rest);
          if ("value" in propsDiff) {
            pendingValue = value;
            applyValue = true;
          }
          if ("checked" in propsDiff) {
            pendingChecked = checked;
            applyChecked = true;
          }
        } else applyProperties(domNode, propsDiff);
      }
      if (!target.attrs.dangerouslySetInnerHTML) {
        const ns = effectiveNs(target, opts);
        morphChildren(domNode, source.childs, target.childs, childOpts(target, ns, opts));
      }
      // For <select>, re-apply value even when not in the diff: changing the
      // <option> children can silently shift dom.value to "".
      if (!applyValue && source.tag === "SELECT" && target.attrs.value !== undefined) {
        pendingValue = target.attrs.value;
        applyValue = true;
      }
      if (applyValue) applyValueLast(domNode, pendingValue);
      if (applyChecked) setProp(domNode, "checked", pendingChecked, false);
      return domNode;
    }
    if (type === 11) {
      morphChildren(domNode, source.childs, target.childs, opts);
      return domNode;
    }
  }
  const newNode = target.toDom(opts);
  domNode.parentNode?.replaceChild(newNode, domNode);
  return newNode;
}
function morphChildren(parentDom, oldChilds, newChilds, opts) {
  if (oldChilds.length === 0) {
    appendChildNodes(parentDom, newChilds, opts);
    return;
  }
  if (newChilds.length === 0) {
    parentDom.replaceChildren();
    return;
  }
  if (oldChilds.length === newChilds.length) {
    let hasKey = false;
    for (let i = 0; i < oldChilds.length; i++) {
      if (getKey(oldChilds[i]) != null || getKey(newChilds[i]) != null) {
        hasKey = true;
        break;
      }
    }
    if (!hasKey) {
      let dom = parentDom.firstChild;
      for (let i = 0; i < oldChilds.length; i++) {
        const next = dom.nextSibling;
        morphNode(dom, oldChilds[i], newChilds[i], opts);
        dom = next;
      }
      return;
    }
  }
  const domNodes = Array.from(parentDom.childNodes);
  const oldKeyMap = Object.create(null);
  for (let i = 0; i < oldChilds.length; i++) {
    const key = getKey(oldChilds[i]);
    if (key != null) oldKeyMap[key] = i;
  }
  const used = new Uint8Array(oldChilds.length);
  let unkeyedCursor = 0;
  for (let j = 0; j < newChilds.length; j++) {
    const newChild = newChilds[j];
    const newKey = getKey(newChild);
    let oldIdx = -1;
    if (newKey != null) {
      if (newKey in oldKeyMap && !used[oldKeyMap[newKey]]) oldIdx = oldKeyMap[newKey];
    } else {
      while (unkeyedCursor < oldChilds.length) {
        if (!used[unkeyedCursor] && getKey(oldChilds[unkeyedCursor]) == null) {
          oldIdx = unkeyedCursor++;
          break;
        }
        unkeyedCursor++;
      }
    }
    if (oldIdx >= 0) {
      used[oldIdx] = 1;
      const newDom = morphNode(domNodes[oldIdx], oldChilds[oldIdx], newChild, opts);
      const ref = parentDom.childNodes[j] ?? null;
      if (newDom !== ref) parentDom.insertBefore(newDom, ref);
    } else {
      const ref = parentDom.childNodes[j] ?? null;
      parentDom.insertBefore(newChild.toDom(opts), ref);
    }
  }
  for (let i = oldChilds.length - 1; i >= 0; i--)
    if (!used[i] && domNodes[i].parentNode === parentDom) parentDom.removeChild(domNodes[i]);
}
export function render(vnode, container, options, prev) {
  const isFragment = vnode instanceof VFragment;
  if (prev && prev.vnode instanceof VFragment === isFragment) {
    const oldDom = isFragment ? container : prev.dom;
    const newDom = morphNode(oldDom, prev.vnode, vnode, options);
    return { vnode, dom: isFragment ? container : newDom };
  }
  const domNode = vnode.toDom(options);
  container.replaceChildren(domNode);
  return { vnode, dom: isFragment ? container : domNode };
}
export const unmount = (container) => container.replaceChildren();
export function h(tagName, properties, children, namespace) {
  const props = {};
  let key;
  if (properties) {
    for (const propName in properties) {
      const propVal = properties[propName];
      if (propName === "key") key = propVal;
      else if (propName === "namespace") namespace = namespace ?? propVal;
      else props[propName] = propVal;
    }
  }
  // Auto-detect SVG / MathML root tags so callers can write
  // `h("svg", null, [h("rect")])` without threading namespace by hand;
  // children inherit at render time via opts.namespace (see toDom).
  if (namespace == null) {
    const lower = tagName.toLowerCase();
    if (lower === "svg") {
      namespace = SVG_NS;
      tagName = "svg";
    } else if (lower === "math") {
      namespace = MATH_NS;
      tagName = "math";
    }
  }
  // HTML tag names are case-insensitive; normalize ALL-lowercase tags to
  // uppercase for cheap identity comparisons. Mixed-case tags (SVG / MathML
  // localnames like `linearGradient`, `foreignObject`) are preserved so they
  // render with the right case in their namespace.
  const c = tagName.charCodeAt(0);
  const tag =
    namespace == null && c >= 97 && c <= 122 && tagName === tagName.toLowerCase()
      ? tagName.toUpperCase()
      : tagName;
  const normalizedChildren = [];
  addChild(normalizedChildren, children);
  return new VNode(tag, props, normalizedChildren, key, namespace);
}
