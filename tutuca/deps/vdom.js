// src/dom-props.ts
function isHtmlAttribute(propName) {
  return propName[4] === "-" && (propName[0] === "d" || propName[0] === "a");
}
function getDomProp(node, propName) {
  return node[propName];
}
function setDomProp(node, propName, value) {
  node[propName] = value;
}
function applyProperties(node, props, previous) {
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
var PROP_TO_ATTR = {
  className: "class",
  htmlFor: "for"
};
function removeProperty(node, propName, previous) {
  if (previous) {
    const previousValue = previous[propName];
    if (isHtmlAttribute(propName)) {
      node.removeAttribute(propName);
    } else if (typeof previousValue === "string") {
      setDomProp(node, propName, "");
      const attrName = PROP_TO_ATTR[propName] || propName;
      node.removeAttribute(attrName);
    } else {
      setDomProp(node, propName, null);
    }
  }
}
function patchObject(node, previous, propName, propValue) {
  const previousValue = previous ? previous[propName] : undefined;
  if (previousValue && typeof previousValue === "object" && Object.getPrototypeOf(previousValue) !== Object.getPrototypeOf(propValue)) {
    setDomProp(node, propName, propValue);
    return;
  }
  if (typeof getDomProp(node, propName) !== "object" || getDomProp(node, propName) === null) {
    setDomProp(node, propName, {});
  }
  for (const k in propValue) {
    getDomProp(node, propName)[k] = propValue[k];
  }
}
// src/types.ts
var SET_ATTR_NOT_SUPPORTED = 0;
var SET_ATTR_OK = 1;
var SET_ATTR_OVERRIDE = 2;
var SET_ATTR_OVERRIDE_SAME = 3;

class ReorderMove {
  from;
  key;
  constructor(from, key) {
    this.from = from;
    this.key = key;
  }
}

class InsertMove {
  key;
  to;
  constructor(key, to) {
    this.key = key;
    this.to = to;
  }
}

class Moves {
  removes;
  inserts;
  constructor(removes, inserts) {
    this.removes = removes;
    this.inserts = inserts;
  }
}

class Warning {
  type;
  message;
  constructor(type, message) {
    this.type = type;
    this.message = message;
  }
}

class DuplicatedKeysWarning extends Warning {
  duplicatedKeys;
  parentTag;
  parentIndex;
  constructor(duplicatedKeys, parentTag, parentIndex) {
    const keys = [...duplicatedKeys].join(", ");
    super("DuplicatedKeys", `Duplicate keys found: [${keys}] in ${parentTag || "fragment"} at index ${parentIndex}`);
    this.duplicatedKeys = duplicatedKeys;
    this.parentTag = parentTag;
    this.parentIndex = parentIndex;
  }
}

class NewKeyedNodeInReorderWarning extends Warning {
  key;
  parentTag;
  parentIndex;
  constructor(key, parentTag, parentIndex) {
    super("NewKeyedNodeInReorder", `New keyed node "${key}" added during reorder in ${parentTag || "fragment"} at index ${parentIndex}. This is undefined behavior.`);
    this.key = key;
    this.parentTag = parentTag;
    this.parentIndex = parentIndex;
  }
}
// src/vdom.ts
class VBase {
  isVText() {
    return false;
  }
  isVComment() {
    return false;
  }
  isVFragment() {
    return false;
  }
  isVNode() {
    return false;
  }
  isEqualTo(other) {
    return this === other;
  }
  toDom(_opts) {
    return null;
  }
  setAttr(_k, _v) {
    return SET_ATTR_NOT_SUPPORTED;
  }
  diff(other) {
    const plan = new PatchPlan(this);
    this._walkTo(other, plan, 0);
    return plan;
  }
  _walkTo(other, plan, index) {
    if (this === other || this.isEqualTo(other)) {
      return;
    }
    if (other == null) {
      plan.appendRemove(index);
      return;
    }
    other._diffFrom(this, plan, index);
  }
  _diffFrom(_source, _patches, _index) {}
}
function nodeSpan(node) {
  return node?.isVNode() ? node.count : 0;
}
function getChilds(node) {
  if (node.isVNode())
    return node.childs;
  if (node.isVFragment())
    return node.childs;
  return;
}
function getKey(node) {
  return node?.isVNode() ? node.key : undefined;
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
    if (child.isVFragment()) {
      for (const c of child.childs) {
        normalizedChildren.push(c);
      }
    } else {
      normalizedChildren.push(child);
    }
  } else {
    normalizedChildren.push(new VText(child));
  }
}

class VText extends VBase {
  text;
  constructor(text) {
    super();
    this.text = String(text);
  }
  get nodeType() {
    return 3;
  }
  isVText() {
    return true;
  }
  isEqualTo(other) {
    return !!other?.isVText() && this.text === other.text;
  }
  toDom(opts) {
    return opts.document.createTextNode(this.text);
  }
  _diffFrom(source, plan, index) {
    if (!source.isVText() || source.text !== this.text) {
      plan.appendText(index, this);
    }
  }
}

class VComment extends VBase {
  text;
  constructor(text) {
    super();
    this.text = text;
  }
  get nodeType() {
    return 8;
  }
  isVComment() {
    return true;
  }
  isEqualTo(other) {
    return !!other?.isVComment() && this.text === other.text;
  }
  toDom(opts) {
    return opts.document.createComment(this.text);
  }
  _diffFrom(source, plan, index) {
    if (!source.isVComment() || source.text !== this.text) {
      plan.appendComment(index, this);
    }
  }
}

class VFragment extends VBase {
  childs;
  constructor(childs) {
    super();
    const normalized = [];
    for (const child of childs) {
      addChild(normalized, child);
    }
    this.childs = normalized;
  }
  get nodeType() {
    return 11;
  }
  isVFragment() {
    return true;
  }
  isEqualTo(other) {
    if (!other?.isVFragment() || this.childs.length !== other.childs.length) {
      return false;
    }
    for (let i = 0;i < this.childs.length; i++) {
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
  setAttr(k, v) {
    for (const child of this.childs) {
      child.setAttr(k, v);
    }
    return SET_ATTR_OK;
  }
  _diffFrom(source, plan, index) {
    if (source.isVFragment()) {
      this._diffChildren(source, plan, index);
    } else {
      plan.appendNode(index, this);
    }
  }
  _diffChildren(source, plan, index) {
    diffChildren(source.childs, this.childs, null, plan, index);
  }
}

class VNode extends VBase {
  tag;
  attrs;
  childs;
  key;
  namespace;
  count;
  attrCount;
  constructor(tag, attrs, childs, key, namespace) {
    super();
    this.tag = tag;
    this.attrs = attrs || {};
    const normalized = [];
    if (childs) {
      for (const child of childs) {
        addChild(normalized, child);
      }
    }
    this.childs = normalized;
    this.key = key != null ? String(key) : undefined;
    this.namespace = typeof namespace === "string" ? namespace : null;
    let count = 0;
    for (const child of this.childs) {
      count += 1;
      if (child.isVNode()) {
        count += child.count || 0;
      }
    }
    this.count = count;
    let attrCount = 0;
    for (const _ in this.attrs) {
      attrCount++;
    }
    this.attrCount = attrCount;
  }
  get nodeType() {
    return 1;
  }
  isVNode() {
    return true;
  }
  isEqualTo(other) {
    if (!other?.isVNode() || this.tag !== other.tag || this.key !== other.key || this.namespace !== other.namespace || this.attrCount !== other.attrCount || this.childs.length !== other.childs.length) {
      return false;
    }
    for (const key in this.attrs) {
      if (this.attrs[key] !== other.attrs[key]) {
        return false;
      }
    }
    for (let i = 0;i < this.childs.length; i++) {
      if (!this.childs[i].isEqualTo(other.childs[i])) {
        return false;
      }
    }
    return true;
  }
  toDom(opts) {
    const doc = opts.document;
    const node = this.namespace === null ? doc.createElement(this.tag) : doc.createElementNS(this.namespace, this.tag);
    applyProperties(node, this.attrs, {});
    for (const child of this.childs) {
      const childNode = child.toDom(opts);
      if (childNode) {
        node.appendChild(childNode);
      }
    }
    return node;
  }
  setAttr(k, v) {
    if (k in this.attrs) {
      if (this.attrs[k] === v) {
        return SET_ATTR_OVERRIDE_SAME;
      }
      this.attrs[k] = v;
      return SET_ATTR_OVERRIDE;
    }
    this.attrs[k] = v;
    this.attrCount++;
    return SET_ATTR_OK;
  }
  _diffFrom(source, plan, index) {
    if (source.isVNode() && source.tag === this.tag && source.namespace === this.namespace && source.key === this.key) {
      const propsDiff = diffProps(source.attrs, this.attrs);
      if (propsDiff) {
        plan.appendProps(index, source.attrs, propsDiff);
      }
      this._diffChildren(source, plan, index);
    } else {
      plan.appendNode(index, this);
    }
  }
  _diffChildren(source, plan, index) {
    diffChildren(source.childs, this.childs, source.tag, plan, index);
  }
}
function diffChildren(sourceChilds, targetChilds, parentTag, plan, index) {
  if (sourceChilds.length === 0 && targetChilds.length === 0)
    return;
  const orderedSet = reorder(sourceChilds, targetChilds);
  const reorderedChilds = orderedSet.children;
  if (orderedSet.duplicatedKeys) {
    plan.addWarning(new DuplicatedKeysWarning(orderedSet.duplicatedKeys, parentTag, index));
  }
  const sourceLen = sourceChilds.length;
  const reorderedLen = reorderedChilds.length;
  const len = sourceLen > reorderedLen ? sourceLen : reorderedLen;
  const rootIndex = index;
  for (let i = 0;i < len; i++) {
    const leftNode = sourceChilds[i];
    const rightNode = reorderedChilds[i];
    index += 1;
    if (!leftNode) {
      if (rightNode) {
        plan.appendInsert(rootIndex, rightNode);
      }
    } else {
      leftNode._walkTo(rightNode, plan, index);
    }
    index += nodeSpan(leftNode);
  }
  if (orderedSet.newKeyedNodes && orderedSet.moves) {
    for (const key of orderedSet.newKeyedNodes) {
      plan.addWarning(new NewKeyedNodeInReorderWarning(key, parentTag, rootIndex));
    }
  }
  if (orderedSet.moves) {
    plan.appendReorder(rootIndex, orderedSet.moves);
  }
}
var EMPTY_WARNINGS = [];

class PatchPlan {
  source;
  patches;
  size;
  _warnings;
  _indices;
  constructor(source) {
    this.source = source;
    this.patches = {};
    this.size = 0;
    this._warnings = null;
    this._indices = [];
  }
  get warnings() {
    return this._warnings ?? EMPTY_WARNINGS;
  }
  addWarning(warning) {
    if (this._warnings) {
      this._warnings.push(warning);
    } else {
      this._warnings = [warning];
    }
  }
  hasWarnings() {
    return this._warnings !== null;
  }
  append(index, patch) {
    const apply = this.patches[index];
    if (apply) {
      apply.push(patch);
    } else {
      this.patches[index] = [patch];
      this._indices.push(index);
      this.size++;
    }
  }
  appendText(index, target) {
    this.append(index, new PatchCharData(target));
  }
  appendComment(index, target) {
    this.append(index, new PatchCharData(target));
  }
  appendRemove(index) {
    this.append(index, PATCH_REMOVE);
  }
  appendInsert(index, vNode) {
    this.append(index, new PatchInsert(vNode));
  }
  appendReorder(index, moves) {
    this.append(index, new PatchReorder(moves));
  }
  appendNode(index, target) {
    this.append(index, new PatchNode(target));
  }
  appendProps(index, previousAttrs, propsDiff) {
    this.append(index, new PatchProps(previousAttrs, propsDiff));
  }
  get(index) {
    return this.patches[index];
  }
  indices() {
    this._indices.sort((a, b) => a - b);
    return this._indices;
  }
  applyTo(rootNode, options) {
    const indices = this.indices();
    if (indices.length === 0) {
      return rootNode;
    }
    const index = domIndex(rootNode, this.source, indices);
    for (let i = 0;i < indices.length; i++) {
      const nodeIndex = indices[i];
      const domNode = index[nodeIndex];
      if (domNode) {
        const patchList = this.patches[nodeIndex];
        for (let j = 0;j < patchList.length; j++) {
          const newNode = patchList[j].applyPatch(domNode, options);
          if (domNode === rootNode && newNode) {
            rootNode = newNode;
          }
        }
      }
    }
    return rootNode;
  }
}

class PatchBase {
  applyPatch(domNode, _options) {
    return domNode;
  }
}
function replaceNode(domNode, vnode, options) {
  const parentNode = domNode.parentNode;
  const newNode = vnode.toDom(options);
  if (parentNode && newNode && newNode !== domNode) {
    parentNode.replaceChild(newNode, domNode);
  }
  return newNode || domNode;
}

class PatchCharData extends PatchBase {
  targetNode;
  nodeType;
  constructor(targetNode) {
    super();
    this.targetNode = targetNode;
    this.nodeType = targetNode.isVText() ? 3 : 8;
  }
  applyPatch(domNode, options) {
    if (domNode.nodeType === this.nodeType) {
      domNode.data = this.targetNode.text;
      return domNode;
    }
    return replaceNode(domNode, this.targetNode, options);
  }
}
class PatchRemove extends PatchBase {
  applyPatch(domNode, _options) {
    const parentNode = domNode.parentNode;
    if (parentNode) {
      parentNode.removeChild(domNode);
    }
    return null;
  }
}
var PATCH_REMOVE = new PatchRemove;

class PatchInsert extends PatchBase {
  nodeToInsert;
  constructor(nodeToInsert) {
    super();
    this.nodeToInsert = nodeToInsert;
  }
  applyPatch(domNode, options) {
    const newNode = this.nodeToInsert.toDom(options);
    if (domNode && newNode) {
      domNode.appendChild(newNode);
    }
    return domNode;
  }
}

class PatchReorder extends PatchBase {
  moves;
  constructor(moves) {
    super();
    this.moves = moves;
  }
  applyPatch(domNode, _options) {
    const childNodes = domNode.childNodes;
    const keyMap = {};
    for (let i = 0;i < this.moves.removes.length; i++) {
      const remove = this.moves.removes[i];
      const node = childNodes[remove.from];
      if (remove.key) {
        keyMap[remove.key] = node;
      }
      domNode.removeChild(node);
    }
    let length = childNodes.length;
    for (let j = 0;j < this.moves.inserts.length; j++) {
      const insert = this.moves.inserts[j];
      const node = keyMap[insert.key];
      if (node) {
        domNode.insertBefore(node, insert.to >= length++ ? null : childNodes[insert.to]);
      }
    }
    return domNode;
  }
}

class PatchNode extends PatchBase {
  newNode;
  constructor(newNode) {
    super();
    this.newNode = newNode;
  }
  applyPatch(domNode, options) {
    return replaceNode(domNode, this.newNode, options);
  }
}

class PatchProps extends PatchBase {
  previousAttrs;
  propsDiff;
  constructor(previousAttrs, propsDiff) {
    super();
    this.previousAttrs = previousAttrs;
    this.propsDiff = propsDiff;
  }
  applyPatch(domNode, _options) {
    applyProperties(domNode, this.propsDiff, this.previousAttrs);
    return domNode;
  }
}
function diffProps(a, b) {
  let diff = null;
  for (const aKey in a) {
    if (!(aKey in b)) {
      diff = diff || {};
      diff[aKey] = undefined;
      continue;
    }
    const aValue = a[aKey];
    const bValue = b[aKey];
    if (aValue === bValue) {} else if (typeof aValue === "object" && aValue !== null && typeof bValue === "object" && bValue !== null) {
      if (Object.getPrototypeOf(bValue) !== Object.getPrototypeOf(aValue)) {
        diff = diff || {};
        diff[aKey] = bValue;
      } else {
        const objectDiff = diffProps(aValue, bValue);
        if (objectDiff) {
          diff = diff || {};
          diff[aKey] = objectDiff;
        }
      }
    } else {
      diff = diff || {};
      diff[aKey] = bValue;
    }
  }
  for (const bKey in b) {
    if (!(bKey in a)) {
      diff = diff || {};
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
      newKeyedNodes: null
    };
  }
  const rawOld = keyIndex(oldChildren);
  let duplicatedKeys = null;
  if (rawNew.duplicatedKeys || rawOld.duplicatedKeys) {
    duplicatedKeys = new Set;
    if (rawNew.duplicatedKeys) {
      for (const key of rawNew.duplicatedKeys) {
        duplicatedKeys.add(key);
      }
    }
    if (rawOld.duplicatedKeys) {
      for (const key of rawOld.duplicatedKeys) {
        duplicatedKeys.add(key);
      }
    }
  }
  if (rawOld.free.length === oldChildren.length) {
    return {
      children: newChildren,
      moves: null,
      duplicatedKeys,
      newKeyedNodes: null
    };
  }
  let newKeys;
  let newFree;
  let oldKeys;
  if (duplicatedKeys) {
    const updatedNew = buildKeyMaps(newChildren, duplicatedKeys);
    newKeys = updatedNew.keys;
    newFree = updatedNew.free;
    oldKeys = buildKeyMaps(oldChildren, duplicatedKeys).keys;
  } else {
    newKeys = rawNew.keys;
    newFree = rawNew.free;
    oldKeys = rawOld.keys;
  }
  const reordered = [];
  let freeIndex = 0;
  const freeCount = newFree.length;
  let deletedItems = 0;
  for (let i = 0;i < oldChildren.length; i++) {
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
  let newKeyedNodes = null;
  for (let j = 0;j < newChildren.length; j++) {
    const newItem = newChildren[j];
    const newKey = effectiveKey(newItem, duplicatedKeys);
    if (newKey) {
      if (!Object.hasOwn(oldKeys, newKey)) {
        reordered.push(newItem);
        if (!newKeyedNodes)
          newKeyedNodes = [];
        newKeyedNodes.push(newKey);
      }
    } else if (j >= lastFreeIndex) {
      reordered.push(newItem);
    }
  }
  const moves = computeMoves(reordered, newChildren, newKeys, duplicatedKeys, deletedItems);
  return { children: reordered, moves, duplicatedKeys, newKeyedNodes };
}
function computeMoves(reordered, newChildren, newKeys, duplicatedKeys, deletedItems) {
  const simulate = reordered.slice();
  let simulateIndex = 0;
  const removes = [];
  const inserts = [];
  const wantedKeys = new Array(newChildren.length);
  for (let i = 0;i < newChildren.length; i++) {
    wantedKeys[i] = effectiveKey(newChildren[i], duplicatedKeys);
  }
  for (let k = 0;k < newChildren.length; ) {
    const wantedKey = wantedKeys[k];
    let simulateItem = simulate[simulateIndex];
    let simulateKey = effectiveKey(simulateItem, duplicatedKeys);
    while (simulateItem === null && simulate.length) {
      removes.push(removeFromArray(simulate, simulateIndex, null));
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
        removes.push(removeFromArray(simulate, simulateIndex, simulateKey));
        simulateItem = simulate[simulateIndex];
        simulateKey = effectiveKey(simulateItem, duplicatedKeys);
        if (simulateItem && simulateKey === wantedKey) {
          simulateIndex++;
          k++;
          continue;
        }
      }
      inserts.push(new InsertMove(wantedKey, k));
      k++;
      continue;
    }
    if (simulateKey) {
      removes.push(removeFromArray(simulate, simulateIndex, simulateKey));
      continue;
    }
    k++;
  }
  while (simulateIndex < simulate.length) {
    const simulateItem = simulate[simulateIndex];
    removes.push(removeFromArray(simulate, simulateIndex, effectiveKey(simulateItem, duplicatedKeys)));
  }
  if (removes.length === deletedItems && !inserts.length) {
    return null;
  }
  return new Moves(removes, inserts);
}
function removeFromArray(arr, index, key) {
  arr.splice(index, 1);
  return new ReorderMove(index, key);
}
function buildKeyMaps(children, duplicatedKeys) {
  const keys = {};
  const free = [];
  for (let i = 0;i < children.length; i++) {
    const key = getKey(children[i]);
    if (key && !duplicatedKeys.has(key)) {
      keys[key] = i;
    } else {
      free.push(i);
    }
  }
  return { keys, free };
}
function keyIndex(children) {
  const keys = {};
  const free = [];
  let duplicatedKeys = null;
  for (let i = 0;i < children.length; i++) {
    const child = children[i];
    const key = getKey(child);
    if (key) {
      if (key in keys) {
        if (!duplicatedKeys) {
          duplicatedKeys = new Set;
        }
        duplicatedKeys.add(key);
      }
      keys[key] = i;
    } else {
      free.push(i);
    }
  }
  return { keys, free, duplicatedKeys };
}
function domIndex(rootNode, tree, indices) {
  if (!indices || indices.length === 0) {
    return {};
  }
  return buildDomNodeMap(rootNode, tree, indices, {}, 0);
}
function buildDomNodeMap(rootNode, tree, indices, nodes, rootIndex) {
  if (rootNode) {
    if (indexInRange(indices, rootIndex, rootIndex)) {
      nodes[rootIndex] = rootNode;
    }
    const vChildren = getChilds(tree);
    if (vChildren) {
      const childNodes = rootNode.childNodes;
      for (let i = 0;i < vChildren.length; i++) {
        rootIndex += 1;
        const vChild = vChildren[i];
        const nextIndex = rootIndex + nodeSpan(vChild);
        if (indexInRange(indices, rootIndex, nextIndex)) {
          buildDomNodeMap(childNodes[i], vChild, indices, nodes, rootIndex);
        }
        rootIndex = nextIndex;
      }
    }
  }
  return nodes;
}
function indexInRange(indices, left, right) {
  if (indices.length === 0) {
    return false;
  }
  let minIndex = 0;
  let maxIndex = indices.length - 1;
  while (minIndex <= maxIndex) {
    const currentIndex = (maxIndex + minIndex) / 2 >> 0;
    const currentItem = indices[currentIndex];
    if (minIndex === maxIndex) {
      return currentItem >= left && currentItem <= right;
    } else if (currentItem < left) {
      minIndex = currentIndex + 1;
    } else if (currentItem > right) {
      maxIndex = currentIndex - 1;
    } else {
      return true;
    }
  }
  return false;
}
var renderCache = new WeakMap;
function render(vnode, container, options) {
  const cached = renderCache.get(container);
  if (cached) {
    const wasFragment = cached.vnode.isVFragment();
    const isFragment = vnode.isVFragment();
    if (wasFragment !== isFragment) {
      renderCache.delete(container);
      return render(vnode, container, options);
    }
    const plan = cached.vnode.diff(vnode);
    const rootNode = wasFragment ? container : cached.dom;
    const newDom = plan.applyTo(rootNode, options);
    renderCache.set(container, { vnode, dom: isFragment ? container : newDom });
    return newDom;
  }
  const domNode = vnode.toDom(options);
  if (domNode) {
    container.innerHTML = "";
    container.appendChild(domNode);
    const isFragment = vnode.isVFragment();
    renderCache.set(container, { vnode, dom: isFragment ? container : domNode });
  }
  return domNode;
}
function unmount(container) {
  renderCache.delete(container);
  container.innerHTML = "";
}
function h(tagName, properties, children) {
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
export {
  unmount,
  render,
  isHtmlAttribute,
  h,
  applyProperties,
  Warning,
  VText,
  VNode,
  VFragment,
  VComment,
  VBase,
  SET_ATTR_OVERRIDE_SAME,
  SET_ATTR_OVERRIDE,
  SET_ATTR_OK,
  SET_ATTR_NOT_SUPPORTED,
  ReorderMove,
  PatchCharData as PatchText,
  PatchReorder,
  PatchRemove,
  PatchProps,
  PatchPlan,
  PatchNode,
  PatchInsert,
  PatchCharData as PatchComment,
  PatchCharData,
  PatchBase,
  NewKeyedNodeInReorderWarning,
  Moves,
  InsertMove,
  DuplicatedKeysWarning
};
