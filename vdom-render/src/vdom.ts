export { applyProperties, isHtmlAttribute } from "./dom-props.ts";
export * from "./types.ts";

import { applyProperties, isHtmlAttribute } from "./dom-props.ts";
import type { DomOptions, Props } from "./types.ts";
import { DuplicatedKeysWarning, type Warning } from "./types.ts";

// Extended options for render with warning callback
export interface RenderOptions extends DomOptions {
  onWarning?: (warning: Warning) => void;
}

// ---- Internal reorder types ----

interface ReorderMove {
  from: number;
  key: string | null | undefined;
}

interface InsertMove {
  key: string;
  to: number;
}

interface Moves {
  removes: ReorderMove[];
  inserts: InsertMove[];
}

interface ReorderResult {
  children: (VBase | null)[];
  moves: Moves | null;
  duplicatedKeys: Set<string> | null;
}

interface KeyIndex {
  keys: Record<string, number>;
  free: number[];
  duplicatedKeys: Set<string> | null;
}

// ---- VBase hierarchy ----

export class VBase {
  isEqualTo(other: VBase | null | undefined): boolean {
    return this === other;
  }
  toDom(_opts: DomOptions): Node | null {
    return null;
  }
}

// Helper to get key from a VBase (only VNode has keys)
function getKey(node: VBase | null | undefined): string | undefined {
  return node instanceof VNode ? node.key : undefined;
}

// Helper to get effective key (undefined for duplicate keys)
function effectiveKey(
  node: VBase | null | undefined,
  duplicatedKeys: Set<string> | null,
): string | undefined {
  const key = getKey(node);
  return key && duplicatedKeys?.has(key) ? undefined : key;
}

function isIterable(obj: unknown): obj is Iterable<unknown> {
  return (
    obj != null &&
    typeof obj !== "string" &&
    typeof (obj as Record<symbol, unknown>)[Symbol.iterator] === "function"
  );
}

// Hyperscript child type (used by VFragment constructor and h())
type HChild = VBase | string | number | boolean | null | undefined | HChild[];

function addChild(normalizedChildren: VBase[], child: HChild | HChild[]): void {
  if (child == null) {
    return;
  }
  if (isIterable(child)) {
    for (const c of child) {
      addChild(normalizedChildren, c);
    }
  } else if (child instanceof VBase) {
    // Flatten VFragment children into parent — fragments are transparent in the DOM
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
  text: string;

  constructor(text: unknown) {
    super();
    this.text = String(text);
  }
  get nodeType(): 3 {
    return 3;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
    return other instanceof VText && this.text === other.text;
  }
  toDom(opts: DomOptions): Text {
    return opts.document.createTextNode(this.text);
  }
}

export class VComment extends VBase {
  text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }
  get nodeType(): 8 {
    return 8;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
    return other instanceof VComment && this.text === other.text;
  }
  toDom(opts: DomOptions): Comment {
    return opts.document.createComment(this.text);
  }
}

export class VFragment extends VBase {
  childs: VBase[];

  constructor(childs: HChild[]) {
    super();
    const normalized: VBase[] = [];
    addChild(normalized, childs);
    this.childs = normalized;
  }
  get nodeType(): 11 {
    return 11;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
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
  toDom(opts: DomOptions): DocumentFragment {
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
  tag: string;
  attrs: Props;
  childs: VBase[];
  key: string | undefined;
  namespace: string | null;
  attrCount: number;

  constructor(
    tag: string,
    attrs?: Props | null,
    childs?: VBase[] | null,
    key?: string | number | null,
    namespace?: string | null,
  ) {
    super();
    this.tag = tag;
    this.attrs = attrs || {};
    this.childs = childs || [];
    this.key = key != null ? String(key) : undefined;
    this.namespace = typeof namespace === "string" ? namespace : null;

    // Cache attribute count for fast equality checks
    this.attrCount = Object.keys(this.attrs).length;
  }
  get nodeType(): 1 {
    return 1;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
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
    // Single loop is sufficient since attrCount matches
    for (const key in this.attrs) {
      if (this.attrs[key] !== other.attrs[key]) {
        return false;
      }
    }
    // Compare children
    for (let i = 0; i < this.childs.length; i++) {
      if (!this.childs[i].isEqualTo(other.childs[i])) {
        return false;
      }
    }
    return true;
  }
  toDom(opts: DomOptions): Element {
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

// ---- diffProps ----

function diffProps(a: Props, b: Props): Props | null {
  let diff: Props | null = null;

  for (const aKey in a) {
    if (!(aKey in b)) {
      diff = diff || {};
      diff[aKey] = undefined;
      continue;
    }

    const aValue = a[aKey];
    const bValue = b[aKey];

    if (aValue === bValue) {
      // No change
    } else if (
      typeof aValue === "object" &&
      aValue !== null &&
      typeof bValue === "object" &&
      bValue !== null
    ) {
      if (Object.getPrototypeOf(bValue) !== Object.getPrototypeOf(aValue)) {
        diff = diff || {};
        diff[aKey] = bValue;
      } else {
        const objectDiff = diffProps(aValue as Props, bValue as Props);
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

// ---- List reordering algorithm ----

function reorder(oldChildren: VBase[], newChildren: VBase[]): ReorderResult {
  const rawNew = keyIndex(newChildren);

  if (rawNew.free.length === newChildren.length) {
    return {
      children: newChildren,
      moves: null,
      duplicatedKeys: rawNew.duplicatedKeys,
    };
  }

  const rawOld = keyIndex(oldChildren);

  // Merge duplicated keys from both sides into one set
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

  // Build effective key maps: if duplicates exist, rebuild for both sides;
  // otherwise use raw results directly
  let newKeys: Record<string, number>;
  let newFree: number[];
  let oldKeys: Record<string, number>;
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

  const reordered: (VBase | null)[] = [];
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

  const lastFreeIndex =
    freeIndex >= newFree.length ? newChildren.length : newFree[freeIndex];

  // Append new items not present in old children
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

  const moves = computeMoves(
    reordered,
    newChildren,
    newKeys,
    duplicatedKeys,
    deletedItems,
  );

  return { children: reordered, moves, duplicatedKeys };
}

function computeMoves(
  reordered: (VBase | null)[],
  newChildren: VBase[],
  newKeys: Record<string, number>,
  duplicatedKeys: Set<string> | null,
  deletedItems: number,
): Moves | null {
  const simulate = reordered.slice();
  let simulateIndex = 0;
  const removes: ReorderMove[] = [];
  const inserts: InsertMove[] = [];

  // Precompute wanted keys for newChildren
  const wantedKeys: (string | undefined)[] = new Array(newChildren.length);
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

    // Match — advance both
    if (simulateItem && simulateKey === wantedKey) {
      simulateIndex++;
      k++;
      continue;
    }

    // Wanted is keyed
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

    // Wanted unkeyed, simulate keyed — remove simulate
    if (simulateKey) {
      simulate.splice(simulateIndex, 1);
      removes.push({ from: simulateIndex, key: simulateKey });
      continue;
    }

    // Both unkeyed, simulate exhausted — advance
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

function keyIndex(children: VBase[], excludeKeys?: Set<string> | null): KeyIndex {
  const keys: Record<string, number> = {};
  const free: number[] = [];
  let duplicatedKeys: Set<string> | null = null;

  for (let i = 0; i < children.length; i++) {
    const key = getKey(children[i]);
    if (key && !excludeKeys?.has(key)) {
      if (key in keys) {
        if (!duplicatedKeys) duplicatedKeys = new Set();
        duplicatedKeys.add(key);
      }
      keys[key] = i;
    } else {
      free.push(i);
    }
  }

  return { keys, free, duplicatedKeys };
}

// ---- Morph functions ----

function replaceNode(domNode: Node, vnode: VBase, options: DomOptions): Node {
  const parentNode = domNode.parentNode;
  const newNode = vnode.toDom(options);
  if (parentNode && newNode && newNode !== domNode) {
    parentNode.replaceChild(newNode, domNode);
  }
  return newNode || domNode;
}

function morphNode(
  domNode: Node,
  source: VBase,
  target: VBase,
  opts: RenderOptions,
): Node {
  if (source === target || source.isEqualTo(target)) return domNode;

  // Both VText or both VComment — update text content
  if (
    (source instanceof VText && target instanceof VText) ||
    (source instanceof VComment && target instanceof VComment)
  ) {
    (domNode as CharacterData).data = (target as VText | VComment).text;
    return domNode;
  }

  // Both VNode with same tag/ns/key — morph props + children
  if (
    source instanceof VNode &&
    target instanceof VNode &&
    source.tag === target.tag &&
    source.namespace === target.namespace &&
    source.key === target.key
  ) {
    const propsDiff = diffProps(source.attrs, target.attrs);
    if (propsDiff) {
      applyProperties(domNode as Element, propsDiff, source.attrs);
    }
    morphChildren(domNode, source.childs, target.childs, source.tag, opts);
    return domNode;
  }

  // Both VFragment — morph children
  if (source instanceof VFragment && target instanceof VFragment) {
    morphChildren(domNode, source.childs, target.childs, null, opts);
    return domNode;
  }

  // Incompatible types — replace
  return replaceNode(domNode, target, opts);
}

function morphChildren(
  parentDom: Node,
  oldChilds: VBase[],
  newChilds: VBase[],
  parentTag: string | null,
  opts: RenderOptions,
): void {
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

  // Emit warnings
  if (orderedSet.duplicatedKeys && opts.onWarning) {
    opts.onWarning(new DuplicatedKeysWarning(orderedSet.duplicatedKeys, parentTag, 0));
  }

  // Capture DOM children before mutations
  const domChildren = Array.from(parentDom.childNodes);

  const oldLen = oldChilds.length;
  const reorderedLen = reorderedChilds.length;
  const len = Math.max(oldLen, reorderedLen);

  // Track DOM nodes that need removal (null in reordered = deleted old child)
  const toRemove: ChildNode[] = [];

  // Phase 1: Morph each aligned pair
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
      // Old child was deleted (null in reordered)
      // If moves exist, applyMoves handles the removal; otherwise we do it
      if (!orderedSet.moves && domChildren[i]) {
        toRemove.push(domChildren[i]);
      }
    }
  }

  // Remove deleted children (only when moves is null)
  for (const node of toRemove) {
    if (node.parentNode === parentDom) {
      parentDom.removeChild(node);
    }
  }

  // Phase 2: Apply reorder moves
  if (orderedSet.moves) {
    applyMoves(parentDom, orderedSet.moves);
  }
}

function applyMoves(domNode: Node, moves: Moves): void {
  const childNodes = domNode.childNodes;
  const keyMap: Record<string, ChildNode> = {};
  for (let i = 0; i < moves.removes.length; i++) {
    const remove = moves.removes[i];
    const node = childNodes[remove.from];
    if (remove.key) keyMap[remove.key] = node;
    domNode.removeChild(node);
  }
  let length = childNodes.length;
  for (let j = 0; j < moves.inserts.length; j++) {
    const insert = moves.inserts[j];
    const node = keyMap[insert.key];
    // Skip if node not found — new keyed node created in Phase 1 already has its DOM node
    if (node) {
      domNode.insertBefore(node, insert.to >= length++ ? null : childNodes[insert.to]);
    }
  }
}

// ---- renderCache, render(), unmount() ----

const renderCache = new WeakMap<Element, { vnode: VBase; dom: Node }>();

export function render(
  vnode: VBase,
  container: Element,
  options: RenderOptions,
): Node | null {
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

    // Root type changed between VFragment and non-VFragment — full re-render
    renderCache.delete(container);
  }

  // Initial render (or type-change re-render)
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

export function unmount(container: Element): void {
  renderCache.delete(container);
  container.innerHTML = "";
}

// ---- Hyperscript helper ----

interface HProperties {
  key?: string | number;
  namespace?: string;
  [key: string]: unknown;
}

export function h(
  tagName: string,
  properties?: HProperties | null,
  children?: HChild | HChild[],
): VNode {
  const tag = tagName.toUpperCase();
  const props: Props = {};
  let key: string | number | undefined;
  let namespace: string | undefined;

  if (properties) {
    for (const propName in properties) {
      if (propName === "key") {
        key = properties[propName] as string | number | undefined;
      } else if (propName === "namespace") {
        namespace = properties[propName] as string | undefined;
      } else if (propName === "class") {
        props.className = properties[propName];
      } else if (isHtmlAttribute(propName)) {
        // aria-* and data-* attributes have no boolean representation.
        // A `false` value is different from the attribute not being
        // present, so we can't remove it. Stringify all values.
        props[propName] = String(properties[propName]);
      } else {
        props[propName] = properties[propName];
      }
    }
  }

  // Normalize children (flattening nested arrays)
  const normalizedChildren: VBase[] = [];
  addChild(normalizedChildren, children);

  return new VNode(tag, props, normalizedChildren, key, namespace);
}
