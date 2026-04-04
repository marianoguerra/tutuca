export const isHtmlAttribute = (propName) =>
  propName[4] === "-" && (propName[0] === "d" || propName[0] === "a");
const isObject = (v) => v !== null && typeof v === "object";
export function applyProperties(node, props, previous) {
  for (const propName in props) {
    const propValue = props[propName];
    if (propValue === undefined) {
      removeProperty(node, propName, previous);
    } else if (isHtmlAttribute(propName)) {
      node.setAttribute(propName, propValue);
    } else if (propName === "dangerouslySetInnerHTML") {
      node.innerHTML = propValue.__html ?? "";
    } else if (isObject(propValue)) {
      patchObject(node, previous, propName, propValue);
    } else if (propName === "className") {
      node.setAttribute("class", propValue);
    } else {
      node[propName] = propValue;
    }
  }
}
function removeProperty(node, propName, previous) {
  const previousValue = previous[propName];
  if (propName === "dangerouslySetInnerHTML") {
    node.innerHTML = "";
  } else if (typeof previousValue === "string" || isHtmlAttribute(propName)) {
    const attrName = propName === "className" ? "class" : propName === "htmlFor" ? "for" : propName;
    node.removeAttribute(attrName);
  } else {
    node[propName] = null;
  }
}
function patchObject(node, previous, propName, propValue) {
  const previousValue = previous?.[propName];
  if (
    isObject(previousValue) &&
    Object.getPrototypeOf(previousValue) !== Object.getPrototypeOf(propValue)
  ) {
    node[propName] = propValue;
    return;
  }
  let current = node[propName];
  if (!isObject(current)) {
    node[propName] = {};
    current = node[propName];
  }
  const target = current;
  for (const k in propValue) {
    target[k] = propValue[k];
  }
}
export class VBase {
  isEqualTo(other) {
    return this === other;
  }
  toDom(_opts) {
    return null;
  }
}
const getKey = (child) => (child instanceof VNode ? child.key : undefined);
const isIterable = (obj) =>
  obj != null && typeof obj !== "string" && typeof obj[Symbol.iterator] === "function";
function addChild(normalizedChildren, child) {
  if (child == null) return;
  if (isIterable(child)) {
    for (const c of child) {
      addChild(normalizedChildren, c);
    }
  } else if (child instanceof VBase) {
    if (child instanceof VFragment) {
      normalizedChildren.push(...child.childs);
    } else {
      normalizedChildren.push(child);
    }
  } else {
    normalizedChildren.push(new VText(child));
  }
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
    if (!(other instanceof VFragment) || this.childs.length !== other.childs.length) {
      return false;
    }
    for (let i = 0; i < this.childs.length; i++) {
      if (!this.childs[i].isEqualTo(other.childs[i])) {
        return false;
      }
    }
    return true;
  }
  toDom(opts) {
    const fragment = opts.document.createDocumentFragment();
    for (const child of this.childs) {
      const childNode = child.toDom(opts);
      if (childNode) {
        fragment.appendChild(childNode);
      }
    }
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
  isEqualTo(other) {
    if (
      !(other instanceof VNode) ||
      this.tag !== other.tag ||
      this.key !== other.key ||
      this.namespace !== other.namespace ||
      this.childs.length !== other.childs.length
    ) {
      return false;
    }
    for (const key in this.attrs) {
      if (this.attrs[key] !== other.attrs[key]) {
        return false;
      }
    }
    for (const key in other.attrs) {
      if (!Object.hasOwn(this.attrs, key)) {
        return false;
      }
    }
    for (let i = 0; i < this.childs.length; i++) {
      if (!this.childs[i].isEqualTo(other.childs[i])) {
        return false;
      }
    }
    return true;
  }
  toDom(opts) {
    const doc = opts.document;
    const node =
      this.namespace === null
        ? doc.createElement(this.tag)
        : doc.createElementNS(this.namespace, this.tag);
    applyProperties(node, this.attrs, {});
    for (const child of this.childs) {
      const childNode = child.toDom(opts);
      if (childNode) {
        node.appendChild(childNode);
      }
    }
    return node;
  }
}
function diffProps(a, b) {
  let diff = null;
  for (const aKey in a) {
    if (!Object.hasOwn(b, aKey)) {
      diff ??= {};
      diff[aKey] = undefined;
      continue;
    }
    const aValue = a[aKey];
    const bValue = b[aKey];
    if (aValue === bValue) {
    } else if (isObject(aValue) && isObject(bValue)) {
      if (Object.getPrototypeOf(bValue) !== Object.getPrototypeOf(aValue)) {
        diff ??= {};
        diff[aKey] = bValue;
      } else {
        const objectDiff = diffProps(aValue, bValue);
        if (objectDiff) {
          diff ??= {};
          diff[aKey] = objectDiff;
        }
      }
    } else {
      diff ??= {};
      diff[aKey] = bValue;
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
function replaceNode(domNode, vnode, options) {
  const parentNode = domNode.parentNode;
  const newNode = vnode.toDom(options);
  if (parentNode && newNode && newNode !== domNode) {
    parentNode.replaceChild(newNode, domNode);
  }
  return newNode || domNode;
}
const bothInstanceOf = (a, b, C) => a instanceof C && b instanceof C;
function morphNode(domNode, source, target, opts) {
  if (source === target || source.isEqualTo(target)) return domNode;
  if (bothInstanceOf(source, target, VText) || bothInstanceOf(source, target, VComment)) {
    domNode.data = target.text;
    return domNode;
  }
  if (
    bothInstanceOf(source, target, VNode) &&
    source.tag === target.tag &&
    source.namespace === target.namespace &&
    source.key === target.key
  ) {
    const propsDiff = diffProps(source.attrs, target.attrs);
    if (propsDiff) {
      applyProperties(domNode, propsDiff, source.attrs);
    }
    if (!target.attrs.dangerouslySetInnerHTML) {
      morphChildren(domNode, source.childs, target.childs, source.tag, opts);
    }
    return domNode;
  }
  if (bothInstanceOf(source, target, VFragment)) {
    morphChildren(domNode, source.childs, target.childs, null, opts);
    return domNode;
  }
  return replaceNode(domNode, target, opts);
}
function morphChildren(parentDom, oldChilds, newChilds, _parentTag, opts) {
  if (oldChilds.length === 0) {
    for (const child of newChilds) {
      const node = child.toDom(opts);
      if (node) parentDom.appendChild(node);
    }
    return;
  }
  if (newChilds.length === 0) {
    while (parentDom.firstChild) {
      parentDom.removeChild(parentDom.firstChild);
    }
    return;
  }
  const domNodes = Array.from(parentDom.childNodes);
  const oldKeyMap = {};
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
      if (newKey in oldKeyMap && !used[oldKeyMap[newKey]]) {
        oldIdx = oldKeyMap[newKey];
      }
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
      const dom = domNodes[oldIdx];
      const newDom = morphNode(dom, oldChilds[oldIdx], newChild, opts);
      const ref = parentDom.childNodes[j] ?? null;
      if (newDom !== ref) parentDom.insertBefore(newDom, ref);
    } else {
      const dom = newChild.toDom(opts);
      if (dom) {
        const ref = parentDom.childNodes[j] ?? null;
        parentDom.insertBefore(dom, ref);
      }
    }
  }
  for (let i = oldChilds.length - 1; i >= 0; i--) {
    if (!used[i] && domNodes[i].parentNode === parentDom) {
      parentDom.removeChild(domNodes[i]);
    }
  }
}
var renderCache = new WeakMap();
export function render(vnode, container, options) {
  const cached = renderCache.get(container);
  const isFragment = vnode instanceof VFragment;
  if (cached) {
    const wasFragment = cached.vnode instanceof VFragment;
    if (wasFragment === isFragment) {
      const rootNode = wasFragment ? container : cached.dom;
      const newDom = morphNode(rootNode, cached.vnode, vnode, options);
      const domToCache = isFragment ? container : newDom;
      renderCache.set(container, { vnode, dom: domToCache });
      return newDom;
    }
    renderCache.delete(container);
  }
  const domNode = vnode.toDom(options);
  if (domNode) {
    container.innerHTML = "";
    container.appendChild(domNode);
    const domToCache = isFragment ? container : domNode;
    renderCache.set(container, { vnode, dom: domToCache });
  }
  return domNode;
}
export function unmount(container) {
  renderCache.delete(container);
  container.innerHTML = "";
}
export function h(tagName, properties, children) {
  const tag = tagName.toUpperCase();
  const props = {};
  let key, namespace;
  if (properties) {
    for (const propName in properties) {
      const propVal = properties[propName];
      switch (propName) {
        case "key":
          key = propVal;
          break;
        case "namespace":
          namespace = propVal;
          break;
        case "class":
          props.className = propVal;
          break;
        case "for":
          props.htmlFor = propVal;
          break;
        default:
          props[propName] = isHtmlAttribute(propName) ? String(propVal) : propVal;
      }
    }
  }
  const normalizedChildren = [];
  addChild(normalizedChildren, children);
  return new VNode(tag, props, normalizedChildren, key, namespace);
}
