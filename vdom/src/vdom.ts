export { applyProperties, isHtmlAttribute } from "./dom-props.ts";
export * from "./types.ts";

import { applyProperties, isHtmlAttribute } from "./dom-props.ts";
import type { DomOptions, KeyIndex, Props, ReorderResult } from "./types.ts";
import {
  DuplicatedKeysWarning,
  InsertMove,
  Moves,
  NewKeyedNodeInReorderWarning,
  ReorderMove,
  type Warning,
} from "./types.ts";

// Virtual DOM Node Types
export class VBase {
  isVText(): this is VText {
    return false;
  }
  isVComment(): this is VComment {
    return false;
  }
  isVFragment(): this is VFragment {
    return false;
  }
  isVNode(): this is VNode {
    return false;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
    return this === other;
  }
  toDom(_opts: DomOptions): Node | null {
    return null;
  }
  diff(other: VBase): PatchPlan {
    const plan = new PatchPlan(this);
    this._walkTo(other, plan, 0);
    return plan;
  }
  _walkTo(other: VBase | null | undefined, plan: PatchPlan, index: number): void {
    if (this === other || this.isEqualTo(other)) {
      return;
    }
    if (other == null) {
      plan.append(index, PATCH_REMOVE);
      return;
    }
    other._diffFrom(this, plan, index);
  }
  _diffFrom(_source: VBase, _patches: PatchPlan, _index: number): void {
    // Base class does nothing - subclasses override
  }
}

// Helper to get child count for tree indexing (only VNode has count)
function nodeSpan(node: VBase | null | undefined): number {
  return node?.isVNode() ? node.count : 0;
}

// Helper to get children array (only VNode/VFragment have children)
function getChilds(node: VBase): VBase[] | undefined {
  if (node.isVNode()) return node.childs;
  if (node.isVFragment()) return node.childs;
  return undefined;
}

// Helper to get key from a VBase (only VNode has keys)
function getKey(node: VBase | null | undefined): string | undefined {
  return node?.isVNode() ? node.key : undefined;
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
    if (child.isVFragment()) {
      for (const c of (child as VFragment).childs) {
        normalizedChildren.push(c);
      }
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
  isVText(): this is VText {
    return true;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
    return !!other?.isVText() && this.text === (other as VText).text;
  }
  toDom(opts: DomOptions): Text {
    return opts.document.createTextNode(this.text);
  }
  _diffFrom(source: VBase, plan: PatchPlan, index: number): void {
    if (!source.isVText() || source.text !== this.text) {
      plan.append(index, new PatchCharData(this));
    }
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
  isVComment(): this is VComment {
    return true;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
    return !!other?.isVComment() && this.text === (other as VComment).text;
  }
  toDom(opts: DomOptions): Comment {
    return opts.document.createComment(this.text);
  }
  _diffFrom(source: VBase, plan: PatchPlan, index: number): void {
    if (!source.isVComment() || source.text !== this.text) {
      plan.append(index, new PatchCharData(this));
    }
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
  isVFragment(): this is VFragment {
    return true;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
    if (!other?.isVFragment() || this.childs.length !== other.childs.length) {
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
  _diffFrom(source: VBase, plan: PatchPlan, index: number): void {
    if (source.isVFragment()) {
      this._diffChildren(source, plan, index);
    } else {
      plan.append(index, new PatchNode(this));
    }
  }
  _diffChildren(source: VFragment, plan: PatchPlan, index: number): void {
    diffChildren(source.childs, this.childs, null, plan, index);
  }
}

export class VNode extends VBase {
  tag: string;
  attrs: Props;
  childs: VBase[];
  key: string | undefined;
  namespace: string | null;
  count: number;
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
    const normalized: VBase[] = [];
    if (childs) {
      addChild(normalized, childs);
    }
    this.childs = normalized;
    this.key = key != null ? String(key) : undefined;
    this.namespace = typeof namespace === "string" ? namespace : null;

    // Calculate descendant count for efficient tree indexing
    let count = 0;
    for (const child of this.childs) {
      count += 1;
      if (child.isVNode()) {
        count += child.count || 0;
      }
    }
    this.count = count;

    // Cache attribute count for fast equality checks
    let attrCount = 0;
    for (const _ in this.attrs) {
      attrCount++;
    }
    this.attrCount = attrCount;
  }
  get nodeType(): 1 {
    return 1;
  }
  isVNode(): this is VNode {
    return true;
  }
  isEqualTo(other: VBase | null | undefined): boolean {
    if (
      !other?.isVNode() ||
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
  _diffFrom(source: VBase, plan: PatchPlan, index: number): void {
    if (
      source.isVNode() &&
      source.tag === this.tag &&
      source.namespace === this.namespace &&
      source.key === this.key
    ) {
      // Same tag, diff props and children
      const propsDiff = diffProps(source.attrs, this.attrs);
      if (propsDiff) {
        plan.append(index, new PatchProps(source.attrs, propsDiff));
      }
      this._diffChildren(source, plan, index);
    } else {
      // Replace with this node
      plan.append(index, new PatchNode(this));
    }
  }
  _diffChildren(source: VNode, plan: PatchPlan, index: number): void {
    diffChildren(source.childs, this.childs, source.tag, plan, index);
  }
}

function diffChildren(
  sourceChilds: VBase[],
  targetChilds: VBase[],
  parentTag: string | null,
  plan: PatchPlan,
  index: number,
): void {
  if (sourceChilds.length === 0 && targetChilds.length === 0) return;

  const orderedSet = reorder(sourceChilds, targetChilds);
  const reorderedChilds = orderedSet.children;

  if (orderedSet.duplicatedKeys) {
    plan.addWarning(
      new DuplicatedKeysWarning(orderedSet.duplicatedKeys, parentTag, index),
    );
  }

  const sourceLen = sourceChilds.length;
  const reorderedLen = reorderedChilds.length;
  const len = sourceLen > reorderedLen ? sourceLen : reorderedLen;
  const rootIndex = index;

  for (let i = 0; i < len; i++) {
    const leftNode = sourceChilds[i];
    const rightNode = reorderedChilds[i];
    index += 1;

    if (!leftNode) {
      if (rightNode) {
        plan.append(rootIndex, new PatchInsert(rightNode));
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
    plan.append(rootIndex, new PatchReorder(orderedSet.moves));
  }
}

const EMPTY_WARNINGS: Warning[] = [];

// Patch Plan - container for all patches from a diff operation
export class PatchPlan {
  source: VBase;
  patches: Record<number, PatchBase[]>;
  size: number;
  _warnings: Warning[] | null;
  _indices: number[];

  constructor(source: VBase) {
    this.source = source;
    this.patches = {};
    this.size = 0;
    this._warnings = null;
    this._indices = [];
  }

  get warnings(): Warning[] {
    return this._warnings ?? EMPTY_WARNINGS;
  }

  addWarning(warning: Warning): void {
    if (this._warnings) {
      this._warnings.push(warning);
    } else {
      this._warnings = [warning];
    }
  }

  hasWarnings(): boolean {
    return this._warnings !== null;
  }

  append(index: number, patch: PatchBase): void {
    const apply = this.patches[index];
    if (apply) {
      apply.push(patch);
    } else {
      this.patches[index] = [patch];
      this._indices.push(index);
      this.size++;
    }
  }

  get(index: number): PatchBase[] | undefined {
    return this.patches[index];
  }

  indices(): number[] {
    this._indices.sort((a, b) => a - b);
    return this._indices;
  }

  applyTo(rootNode: Node, options: DomOptions): Node {
    const indices = this.indices();
    if (indices.length === 0) {
      return rootNode;
    }

    const index = domIndex(rootNode, this.source, indices);

    for (let i = 0; i < indices.length; i++) {
      const nodeIndex = indices[i];
      const domNode = index[nodeIndex];
      if (domNode) {
        const patchList = this.patches[nodeIndex];
        for (let j = 0; j < patchList.length; j++) {
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

// Patch Types
export class PatchBase {
  applyPatch(domNode: Node, _options: DomOptions): Node | null {
    return domNode;
  }
}

function replaceNode(domNode: Node, vnode: VBase, options: DomOptions): Node {
  const parentNode = domNode.parentNode;
  const newNode = vnode.toDom(options);
  if (parentNode && newNode && newNode !== domNode) {
    parentNode.replaceChild(newNode, domNode);
  }
  return newNode || domNode;
}

export class PatchCharData extends PatchBase {
  targetNode: VText | VComment;
  nodeType: number;

  constructor(targetNode: VText | VComment) {
    super();
    this.targetNode = targetNode;
    this.nodeType = targetNode.isVText() ? 3 : 8;
  }
  applyPatch(domNode: Node, options: DomOptions): Node {
    if (domNode.nodeType === this.nodeType) {
      (domNode as CharacterData).data = this.targetNode.text;
      return domNode;
    }
    return replaceNode(domNode, this.targetNode, options);
  }
}

export { PatchCharData as PatchText, PatchCharData as PatchComment };

export class PatchRemove extends PatchBase {
  applyPatch(domNode: Node, _options: DomOptions): null {
    const parentNode = domNode.parentNode;
    if (parentNode) {
      parentNode.removeChild(domNode);
    }
    return null;
  }
}

const PATCH_REMOVE = new PatchRemove();

export class PatchInsert extends PatchBase {
  nodeToInsert: VBase;

  constructor(nodeToInsert: VBase) {
    super();
    this.nodeToInsert = nodeToInsert;
  }
  applyPatch(domNode: Node, options: DomOptions): Node {
    const newNode = this.nodeToInsert.toDom(options);
    if (domNode && newNode) {
      domNode.appendChild(newNode);
    }
    return domNode;
  }
}

export class PatchReorder extends PatchBase {
  moves: Moves;

  constructor(moves: Moves) {
    super();
    this.moves = moves;
  }
  applyPatch(domNode: Node, _options: DomOptions): Node {
    const childNodes = domNode.childNodes;
    const keyMap: Record<string, ChildNode> = {};

    for (let i = 0; i < this.moves.removes.length; i++) {
      const remove = this.moves.removes[i];
      const node = childNodes[remove.from];
      if (remove.key) {
        keyMap[remove.key] = node;
      }
      domNode.removeChild(node);
    }

    let length = childNodes.length;
    for (let j = 0; j < this.moves.inserts.length; j++) {
      const insert = this.moves.inserts[j];
      const node = keyMap[insert.key];
      // Skip if node not found (undefined behavior - new keyed node during reorder)
      if (node) {
        domNode.insertBefore(node, insert.to >= length++ ? null : childNodes[insert.to]);
      }
    }

    return domNode;
  }
}

export class PatchNode extends PatchBase {
  newNode: VBase;

  constructor(newNode: VBase) {
    super();
    this.newNode = newNode;
  }
  applyPatch(domNode: Node, options: DomOptions): Node {
    return replaceNode(domNode, this.newNode, options);
  }
}

export class PatchProps extends PatchBase {
  previousAttrs: Props;
  propsDiff: Props;

  constructor(previousAttrs: Props, propsDiff: Props) {
    super();
    this.previousAttrs = previousAttrs;
    this.propsDiff = propsDiff;
  }
  applyPatch(domNode: Node, _options: DomOptions): Node {
    applyProperties(domNode as Element, this.propsDiff, this.previousAttrs);
    return domNode;
  }
}

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

// List reordering algorithm
function reorder(oldChildren: VBase[], newChildren: VBase[]): ReorderResult {
  const rawNew = keyIndex(newChildren);

  if (rawNew.free.length === newChildren.length) {
    return {
      children: newChildren,
      moves: null,
      duplicatedKeys: rawNew.duplicatedKeys,
      newKeyedNodes: null,
    };
  }

  const rawOld = keyIndex(oldChildren);

  // Merge duplicated keys from both sides into one set
  let duplicatedKeys: Set<string> | null = null;
  if (rawNew.duplicatedKeys || rawOld.duplicatedKeys) {
    duplicatedKeys = new Set<string>();
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
      newKeyedNodes: null,
    };
  }

  // Build effective key maps: if duplicates exist, rebuild for both sides;
  // otherwise use raw results directly
  let newKeys: Record<string, number>;
  let newFree: number[];
  let oldKeys: Record<string, number>;
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
  let newKeyedNodes: string[] | null = null;
  for (let j = 0; j < newChildren.length; j++) {
    const newItem = newChildren[j];
    const newKey = effectiveKey(newItem, duplicatedKeys);

    if (newKey) {
      if (!Object.hasOwn(oldKeys, newKey)) {
        reordered.push(newItem);
        if (!newKeyedNodes) newKeyedNodes = [];
        newKeyedNodes.push(newKey);
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

  return { children: reordered, moves, duplicatedKeys, newKeyedNodes };
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
      removes.push(removeFromArray(simulate, simulateIndex, null));
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

    // Wanted unkeyed, simulate keyed — remove simulate
    if (simulateKey) {
      removes.push(removeFromArray(simulate, simulateIndex, simulateKey));
      continue;
    }

    // Both unkeyed, simulate exhausted — advance
    k++;
  }

  while (simulateIndex < simulate.length) {
    const simulateItem = simulate[simulateIndex];
    removes.push(
      removeFromArray(
        simulate,
        simulateIndex,
        effectiveKey(simulateItem, duplicatedKeys),
      ),
    );
  }

  if (removes.length === deletedItems && !inserts.length) {
    return null;
  }

  return new Moves(removes, inserts);
}

function removeFromArray(
  arr: (VBase | null)[],
  index: number,
  key: string | null | undefined,
): ReorderMove {
  arr.splice(index, 1);
  return new ReorderMove(index, key);
}

function buildKeyMaps(
  children: VBase[],
  duplicatedKeys: Set<string>,
): { keys: Record<string, number>; free: number[] } {
  const keys: Record<string, number> = {};
  const free: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const key = getKey(children[i]);
    if (key && !duplicatedKeys.has(key)) {
      keys[key] = i;
    } else {
      free.push(i);
    }
  }
  return { keys, free };
}

function keyIndex(children: VBase[]): KeyIndex {
  const keys: Record<string, number> = {};
  const free: number[] = [];
  let duplicatedKeys: Set<string> | null = null;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const key = getKey(child);
    if (key) {
      if (key in keys) {
        if (!duplicatedKeys) {
          duplicatedKeys = new Set();
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

function domIndex(rootNode: Node, tree: VBase, indices: number[]): Record<number, Node> {
  if (!indices || indices.length === 0) {
    return {};
  }
  return buildDomNodeMap(rootNode, tree, indices, {}, 0);
}

function buildDomNodeMap(
  rootNode: Node,
  tree: VBase,
  indices: number[],
  nodes: Record<number, Node>,
  rootIndex: number,
): Record<number, Node> {
  if (rootNode) {
    if (indexInRange(indices, rootIndex, rootIndex)) {
      nodes[rootIndex] = rootNode;
    }

    const vChildren = getChilds(tree);

    if (vChildren) {
      const childNodes = rootNode.childNodes;

      for (let i = 0; i < vChildren.length; i++) {
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

function indexInRange(indices: number[], left: number, right: number): boolean {
  if (indices.length === 0) {
    return false;
  }

  let minIndex = 0;
  let maxIndex = indices.length - 1;

  while (minIndex <= maxIndex) {
    const currentIndex = ((maxIndex + minIndex) / 2) >> 0;
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

// Cache for storing previous vnodes per container (enables diff/patch on re-render)
const renderCache = new WeakMap<Element, { vnode: VBase; dom: Node }>();

// Render function - renders a virtual DOM tree into a container element
export function render(
  vnode: VBase,
  container: Element,
  options: DomOptions,
): Node | null {
  const cached = renderCache.get(container);

  if (cached) {
    const wasFragment = cached.vnode.isVFragment();
    const isFragment = vnode.isVFragment();

    if (wasFragment !== isFragment) {
      // Root type changed between VFragment and non-VFragment — full re-render
      renderCache.delete(container);
      return render(vnode, container, options);
    }

    const plan = cached.vnode.diff(vnode);
    const rootNode = wasFragment ? container : cached.dom;
    const newDom = plan.applyTo(rootNode, options);
    renderCache.set(container, { vnode, dom: isFragment ? container : newDom });
    return newDom;
  }

  // Initial render
  const domNode = vnode.toDom(options);
  if (domNode) {
    container.innerHTML = "";
    container.appendChild(domNode);
    const isFragment = vnode.isVFragment();
    renderCache.set(container, { vnode, dom: isFragment ? container : domNode });
  }
  return domNode;
}

// Unmount function - clears the render cache and container
export function unmount(container: Element): void {
  renderCache.delete(container);
  container.innerHTML = "";
}

// Hyperscript helper types
type HChildren = HChild | HChild[];

interface HProperties {
  key?: string | number;
  namespace?: string;
  [key: string]: unknown;
}

// Hyperscript helper
export function h(
  tagName: string,
  properties?: HProperties | null,
  children?: HChildren,
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
