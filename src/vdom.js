export function isHtmlAttribute(propName) {
  return propName[4] === "-" && (propName[0] === "d" || propName[0] === "a");
}
function getDomProp(node, propName) {
  return node[propName];
}
function setDomProp(node, propName, value) {
  node[propName] = value;
}
export function applyProperties(node, props, previous) {
  for (const propName in props) {
    const propValue = props[propName];
    if (propValue === undefined) {
      removeProperty(node, propName, previous);
    } else if (isHtmlAttribute(propName)) {
      node.setAttribute(propName, propValue);
    } else {
      if (typeof propValue === "object" && propValue !== null) {
        patchObject(node, previous, propName, propValue);
      } else {
        setDomProp(node, propName, propValue);
      }
    }
  }
}
function removeProperty(node, propName, previous) {
  const previousValue = previous[propName];
  if (isHtmlAttribute(propName)) {
    node.removeAttribute(propName);
  } else if (typeof previousValue === "string") {
    setDomProp(node, propName, "");
    const attrName = propName === "className" ? "class" : propName === "htmlFor" ? "for" : propName;
    node.removeAttribute(attrName);
  } else {
    setDomProp(node, propName, null);
  }
}
function patchObject(node, previous, propName, propValue) {
  const previousValue = previous?.[propName];
  if (
    previousValue &&
    typeof previousValue === "object" &&
    Object.getPrototypeOf(previousValue) !== Object.getPrototypeOf(propValue)
  ) {
    setDomProp(node, propName, propValue);
    return;
  }
  let current = getDomProp(node, propName);
  if (typeof current !== "object" || current === null) {
    setDomProp(node, propName, {});
    current = getDomProp(node, propName);
  }
  const target = current;
  for (const k in propValue) {
    target[k] = propValue[k];
  }
}
export class Warning {
  constructor(type, message) {
    this.type = type;
    this.message = message;
  }
}
export class DuplicatedKeysWarning extends Warning {
  constructor(duplicatedKeys, parentTag, parentIndex) {
    const keys = [...duplicatedKeys].join(", ");
    super(
      "DuplicatedKeys",
      `Duplicate keys found: [${keys}] in ${parentTag || "fragment"} at index ${parentIndex}. Nodes with duplicated keys are matched positionally.`,
    );
    this.duplicatedKeys = duplicatedKeys;
    this.parentTag = parentTag;
    this.parentIndex = parentIndex;
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
function getKey(node) {
  return node instanceof VNode ? node.key : undefined;
}
function effectiveKey(node, duplicatedKeys) {
  const key = getKey(node);
  return key && duplicatedKeys?.has(key) ? undefined : key;
}
function isIterable(obj) {
  return obj != null && typeof obj !== "string" && typeof obj[Symbol.iterator] === "function";
}
function addChild(normalizedChildren, child) {
  if (child == null) {
    return;
  }
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
    const normalized = [];
    addChild(normalized, childs);
    this.childs = normalized;
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
    this.attrCount = Object.keys(this.attrs).length;
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
      this.attrCount !== other.attrCount ||
      this.childs.length !== other.childs.length
    ) {
      return false;
    }
    for (const key in this.attrs) {
      if (this.attrs[key] !== other.attrs[key]) {
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
    } else if (
      typeof aValue === "object" &&
      aValue !== null &&
      typeof bValue === "object" &&
      bValue !== null
    ) {
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
function reorder(oldChildren, newChildren) {
  const rawNew = keyIndex(newChildren);
  if (rawNew.free.length === newChildren.length) {
    return {
      children: newChildren,
      moves: null,
      duplicatedKeys: rawNew.duplicatedKeys,
    };
  }
  const rawOld = keyIndex(oldChildren);
  const duplicatedKeys =
    rawNew.duplicatedKeys || rawOld.duplicatedKeys
      ? new Set([...(rawNew.duplicatedKeys || []), ...(rawOld.duplicatedKeys || [])])
      : null;
  if (rawOld.free.length === oldChildren.length) {
    return {
      children: newChildren,
      moves: null,
      duplicatedKeys,
    };
  }
  let newKeys;
  let newFree;
  let oldKeys;
  if (duplicatedKeys) {
    const updatedNew = keyIndex(newChildren, duplicatedKeys);
    newKeys = updatedNew.keys;
    newFree = updatedNew.free;
    oldKeys = keyIndex(oldChildren, duplicatedKeys).keys;
  } else {
    newKeys = rawNew.keys;
    newFree = rawNew.free;
    oldKeys = rawOld.keys;
  }
  const reordered = [];
  let freeIndex = 0;
  const freeCount = newFree.length;
  let deletedItems = 0;
  for (let i = 0; i < oldChildren.length; i++) {
    const oldItem = oldChildren[i];
    const oldKey = effectiveKey(oldItem, duplicatedKeys);
    if (oldKey) {
      if (Object.hasOwn(newKeys, oldKey)) {
        const itemIndex = newKeys[oldKey];
        reordered.push(newChildren[itemIndex]);
      } else {
        deletedItems++;
        reordered.push(null);
      }
    } else {
      if (freeIndex < freeCount) {
        const itemIndex = newFree[freeIndex++];
        reordered.push(newChildren[itemIndex]);
      } else {
        deletedItems++;
        reordered.push(null);
      }
    }
  }
  const lastFreeIndex = freeIndex >= newFree.length ? newChildren.length : newFree[freeIndex];
  for (let j = 0; j < newChildren.length; j++) {
    const newItem = newChildren[j];
    const newKey = effectiveKey(newItem, duplicatedKeys);
    if (newKey) {
      if (!Object.hasOwn(oldKeys, newKey)) {
        reordered.push(newItem);
      }
    } else if (j >= lastFreeIndex) {
      reordered.push(newItem);
    }
  }
  const moves = computeMoves(reordered, newChildren, newKeys, duplicatedKeys, deletedItems);
  return { children: reordered, moves, duplicatedKeys };
}
function computeMoves(reordered, newChildren, newKeys, duplicatedKeys, deletedItems) {
  const simulate = reordered.slice();
  let simulateIndex = 0;
  const removes = [];
  const inserts = [];
  const wantedKeys = new Array(newChildren.length);
  for (let i = 0; i < newChildren.length; i++) {
    wantedKeys[i] = effectiveKey(newChildren[i], duplicatedKeys);
  }
  for (let k = 0; k < newChildren.length; ) {
    const wantedKey = wantedKeys[k];
    let simulateItem = simulate[simulateIndex];
    let simulateKey = effectiveKey(simulateItem, duplicatedKeys);
    while (simulateItem === null && simulate.length) {
      simulate.splice(simulateIndex, 1);
      removes.push({ from: simulateIndex, key: null });
      simulateItem = simulate[simulateIndex];
      simulateKey = effectiveKey(simulateItem, duplicatedKeys);
    }
    if (simulateItem && simulateKey === wantedKey) {
      simulateIndex++;
      k++;
      continue;
    }
    if (wantedKey) {
      if (simulateKey && newKeys[simulateKey] !== k + 1) {
        simulate.splice(simulateIndex, 1);
        removes.push({ from: simulateIndex, key: simulateKey });
        simulateItem = simulate[simulateIndex];
        simulateKey = effectiveKey(simulateItem, duplicatedKeys);
        if (simulateItem && simulateKey === wantedKey) {
          simulateIndex++;
          k++;
          continue;
        }
      }
      inserts.push({ key: wantedKey, to: k });
      k++;
      continue;
    }
    if (simulateKey) {
      simulate.splice(simulateIndex, 1);
      removes.push({ from: simulateIndex, key: simulateKey });
      continue;
    }
    k++;
  }
  while (simulateIndex < simulate.length) {
    const simulateItem = simulate[simulateIndex];
    simulate.splice(simulateIndex, 1);
    removes.push({
      from: simulateIndex,
      key: effectiveKey(simulateItem, duplicatedKeys),
    });
  }
  if (removes.length === deletedItems && !inserts.length) {
    return null;
  }
  return { removes, inserts };
}
function keyIndex(children, excludeKeys) {
  const keys = {};
  const free = [];
  let duplicatedKeys = null;
  for (let i = 0; i < children.length; i++) {
    const key = getKey(children[i]);
    if (key && !excludeKeys?.has(key)) {
      if (key in keys) {
        duplicatedKeys ??= new Set();
        duplicatedKeys.add(key);
      }
      keys[key] = i;
    } else {
      free.push(i);
    }
  }
  return { keys, free, duplicatedKeys };
}
function replaceNode(domNode, vnode, options) {
  const parentNode = domNode.parentNode;
  const newNode = vnode.toDom(options);
  if (parentNode && newNode && newNode !== domNode) {
    parentNode.replaceChild(newNode, domNode);
  }
  return newNode || domNode;
}
function morphNode(domNode, source, target, opts) {
  if (source === target || source.isEqualTo(target)) return domNode;
  if (
    (source instanceof VText && target instanceof VText) ||
    (source instanceof VComment && target instanceof VComment)
  ) {
    domNode.data = target.text;
    return domNode;
  }
  if (
    source instanceof VNode &&
    target instanceof VNode &&
    source.tag === target.tag &&
    source.namespace === target.namespace &&
    source.key === target.key
  ) {
    const propsDiff = diffProps(source.attrs, target.attrs);
    if (propsDiff) {
      applyProperties(domNode, propsDiff, source.attrs);
    }
    morphChildren(domNode, source.childs, target.childs, source.tag, opts);
    return domNode;
  }
  if (source instanceof VFragment && target instanceof VFragment) {
    morphChildren(domNode, source.childs, target.childs, null, opts);
    return domNode;
  }
  return replaceNode(domNode, target, opts);
}
function morphChildren(parentDom, oldChilds, newChilds, parentTag, opts) {
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
  const orderedSet = reorder(oldChilds, newChilds);
  const reorderedChilds = orderedSet.children;
  if (orderedSet.duplicatedKeys && opts.onWarning) {
    opts.onWarning(new DuplicatedKeysWarning(orderedSet.duplicatedKeys, parentTag, 0));
  }
  const domChildren = Array.from(parentDom.childNodes);
  const oldLen = oldChilds.length;
  const reorderedLen = reorderedChilds.length;
  const len = Math.max(oldLen, reorderedLen);
  const toRemove = [];
  for (let i = 0; i < len; i++) {
    const leftNode = oldChilds[i];
    const rightNode = reorderedChilds[i];
    if (!leftNode && rightNode) {
      const newNode = rightNode.toDom(opts);
      if (newNode) parentDom.appendChild(newNode);
    } else if (leftNode && rightNode) {
      const domChild = domChildren[i];
      if (domChild) {
        morphNode(domChild, leftNode, rightNode, opts);
      }
    } else if (leftNode && !rightNode) {
      if (!orderedSet.moves && domChildren[i]) {
        toRemove.push(domChildren[i]);
      }
    }
  }
  for (const node of toRemove) {
    if (node.parentNode === parentDom) {
      parentDom.removeChild(node);
    }
  }
  if (orderedSet.moves) {
    applyMoves(parentDom, orderedSet.moves);
  }
}
function applyMoves(domNode, moves) {
  const childNodes = domNode.childNodes;
  const keyMap = {};
  for (const remove of moves.removes) {
    const node = childNodes[remove.from];
    if (remove.key) keyMap[remove.key] = node;
    domNode.removeChild(node);
  }
  let length = childNodes.length;
  for (let j = 0; j < moves.inserts.length; j++) {
    const insert = moves.inserts[j];
    const node = keyMap[insert.key];
    if (node) {
      domNode.insertBefore(node, insert.to >= length++ ? null : childNodes[insert.to]);
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
      renderCache.set(container, {
        vnode,
        dom: isFragment ? container : newDom,
      });
      return newDom;
    }
    renderCache.delete(container);
  }
  const domNode = vnode.toDom(options);
  if (domNode) {
    container.innerHTML = "";
    container.appendChild(domNode);
    renderCache.set(container, {
      vnode,
      dom: isFragment ? container : domNode,
    });
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
  let key;
  let namespace;
  if (properties) {
    for (const propName in properties) {
      if (propName === "key") {
        key = properties[propName];
      } else if (propName === "namespace") {
        namespace = properties[propName];
      } else if (propName === "class") {
        props.className = properties[propName];
      } else if (propName === "for") {
        props.htmlFor = properties[propName];
      } else if (isHtmlAttribute(propName)) {
        props[propName] = String(properties[propName]);
      } else {
        props[propName] = properties[propName];
      }
    }
  }
  const normalizedChildren = [];
  addChild(normalizedChildren, children);
  return new VNode(tag, props, normalizedChildren, key, namespace);
}
