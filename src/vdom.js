export const isHtmlAttribute = (propName) =>
  propName[4] === "-" && (propName[0] === "d" || propName[0] === "a");
const isObject = (v) => v !== null && typeof v === "object";
const prototypesDiffer = (a, b) => Object.getPrototypeOf(a) !== Object.getPrototypeOf(b);
export function applyProperties(node, props, previous) {
  for (const propName in props) {
    const propValue = props[propName];
    if (propValue === undefined) removeProperty(node, propName, previous);
    else if (isHtmlAttribute(propName)) node.setAttribute(propName, propValue);
    else if (propName === "dangerouslySetInnerHTML") node.innerHTML = propValue.__html ?? "";
    else if (isObject(propValue)) patchObject(node, previous, propName, propValue);
    else if (propName === "className") node.setAttribute("class", propValue);
    else node[propName] = propValue;
  }
}
function removeProperty(node, propName, previous) {
  const previousValue = previous[propName];
  if (propName === "dangerouslySetInnerHTML") node.replaceChildren();
  else if (propName === "className") node.removeAttribute("class");
  else if (propName === "htmlFor") node.removeAttribute("for");
  else if (typeof previousValue === "string" || isHtmlAttribute(propName))
    node.removeAttribute(propName);
  else node[propName] = null;
}
function patchObject(node, previous, propName, propValue) {
  const previousValue = previous?.[propName];
  if (isObject(previousValue) && prototypesDiffer(previousValue, propValue)) {
    node[propName] = propValue;
    return;
  }
  if (!isObject(node[propName])) node[propName] = {};
  const target = node[propName];
  for (const k in propValue) target[k] = propValue[k];
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
    const node =
      this.namespace === null
        ? doc.createElement(this.tag)
        : doc.createElementNS(this.namespace, this.tag);
    if (this.tag === "SELECT" && "value" in this.attrs) {
      const { value, ...rest } = this.attrs;
      applyProperties(node, rest, {});
      appendChildNodes(node, this.childs, opts);
      applyProperties(node, { value }, {});
    } else {
      applyProperties(node, this.attrs, {});
      appendChildNodes(node, this.childs, opts);
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
      continue;
    }
    const aValue = a[aKey];
    const bValue = b[aKey];
    if (aValue === bValue) continue;
    if (isObject(aValue) && isObject(bValue)) {
      if (prototypesDiffer(bValue, aValue)) {
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
      const isSelect = source.tag === "SELECT";
      if (propsDiff) {
        if (isSelect && "value" in propsDiff) {
          const { value: _v, ...rest } = propsDiff;
          applyProperties(domNode, rest, source.attrs);
        } else applyProperties(domNode, propsDiff, source.attrs);
      }
      if (!target.attrs.dangerouslySetInnerHTML)
        morphChildren(domNode, source.childs, target.childs, opts);
      if (isSelect && target.attrs.value !== undefined)
        applyProperties(domNode, { value: target.attrs.value }, source.attrs);
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
