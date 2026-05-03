const NONE = Symbol("NONE");

export class Step {
  lookup(_v, dval = null) {
    return dval;
  }
  setValue(root, _v) {
    return root;
  }
  enterFrame(stack, _prev, next) {
    return stack.enter(next, {}, true);
  }
}
export class BindStep extends Step {
  constructor(binds) {
    super();
    this.binds = binds;
  }
  lookup(v, _dval) {
    return v;
  }
  setValue(_root, v) {
    return v;
  }
  enterFrame(stack, _prev, next) {
    return stack.enter(next, { ...this.binds }, false);
  }
  withIndex(i) {
    return new BindStep({ ...this.binds, key: i });
  }
  withKey(key) {
    return new BindStep({ ...this.binds, key });
  }
}
export class FieldStep extends Step {
  constructor(field) {
    super();
    this.field = field;
  }
  lookup(v, dval = null) {
    return v?.get ? v.get(this.field, dval) : dval;
  }
  setValue(root, v) {
    return root.set(this.field, v);
  }
  withIndex(i) {
    return new SeqIndexStep(this.field, i);
  }
  withKey(k) {
    return new SeqKeyStep(this.field, k);
  }
}
class FieldSeqStep extends Step {
  constructor(field, key) {
    super();
    this.field = field;
    this.key = key;
  }
  lookup(v, dval = null) {
    const o = v?.get(this.field, null);
    return o?.get ? o.get(this.key, dval) : dval;
  }
  setValue(root, v) {
    return root.set(this.field, root.get(this.field).set(this.key, v));
  }
  enterFrame(stack, _prev, next) {
    return stack.enter(next, { key: this.key }, true);
  }
}
export class SeqKeyStep extends FieldSeqStep {}
export class SeqIndexStep extends FieldSeqStep {}
export class SeqAccessStep extends Step {
  constructor(seqField, keyField) {
    super();
    this.seqField = seqField;
    this.keyField = keyField;
  }
  lookup(v, dval = null) {
    const seq = v?.get(this.seqField, NONE);
    const key = v?.get(this.keyField, NONE);
    return key !== NONE && seq?.get ? seq.get(key, dval) : dval;
  }
  setValue(root, v) {
    const seq = root?.get(this.seqField, NONE);
    const key = root?.get(this.keyField, NONE);
    return seq === NONE || key === NONE ? root : root.set(this.seqField, seq.set(key, v));
  }
}
export class EachBindStep extends Step {
  constructor(seqVal, key) {
    super();
    this.seqVal = seqVal;
    this.key = key;
  }
  lookup(v, _dval) {
    return v;
  }
  setValue(_root, v) {
    return v;
  }
  enterFrame(stack, _prev, next) {
    const item = this.seqVal.eval(stack)?.get(this.key, null);
    return stack.enter(next, { key: this.key, value: item }, false);
  }
}
export class EachRenderItStep extends Step {
  constructor(seqField, key) {
    super();
    this.seqField = seqField;
    this.key = key;
  }
  lookup(v, dval = null) {
    const seq = v?.get(this.seqField, null);
    return seq?.get ? seq.get(this.key, dval) : dval;
  }
  setValue(root, v) {
    const seq = root?.get(this.seqField, null);
    return seq ? root.set(this.seqField, seq.set(this.key, v)) : root;
  }
  enterFrame(stack, _prev, next) {
    return stack.enter(next, { key: this.key, value: next }, false).enter(next, {}, true);
  }
}
export class Path {
  constructor(steps = []) {
    this.steps = steps;
  }
  concat(steps) {
    return new Path(this.steps.concat(steps));
  }
  popStep() {
    return new Path(this.steps.slice(0, -1));
  }
  lookup(v, dval = null) {
    let curVal = v;
    for (const step of this.steps) {
      curVal = step.lookup(curVal, NONE);
      if (curVal === NONE) return dval;
    }
    return curVal;
  }
  setValue(root, v) {
    const intermediates = new Array(this.steps.length);
    let curVal = root;
    for (let i = 0; i < this.steps.length; i++) {
      intermediates[i] = curVal;
      curVal = this.steps[i].lookup(curVal, NONE);
      if (curVal === NONE) return root;
    }
    let newVal = v;
    for (let i = this.steps.length - 1; i >= 0; i--) {
      newVal = this.steps[i].setValue(intermediates[i], newVal);
      intermediates[i] = newVal;
    }
    return newVal;
  }
  buildStack(stack) {
    let prev = stack.it;
    for (const step of this.steps) {
      const next = step.lookup(prev, NONE);
      if (next === NONE) {
        console.warn("bad PathItem", { root: stack.it, step, path: this });
        return null;
      }
      stack = step.enterFrame(stack, prev, next);
      prev = next;
    }
    return stack;
  }
  static fromNodeAndEventName(node, eventName, rootNode, maxDepth, comps, stopOnNoEvent = true) {
    const pathSteps = [];
    let depth = 0;
    let eventIds = [];
    let handlers = null;
    let nodeIds = [];
    let isLeafComponent = true;
    while (node && node !== rootNode && depth < maxDepth) {
      if (node?.dataset) {
        const { nid, si, sk } = parseMetaComment(node.previousSibling);
        const { eid, cid, vid } = node.dataset;
        if (eid !== undefined) eventIds.push(eid);
        if (cid !== undefined) {
          const comp = comps.getComponentForId(+cid, vid);
          if (isLeafComponent) {
            handlers = findHandlers(comp, eventIds, vid, eventName);
            if (handlers === null && stopOnNoEvent) return NO_EVENT_INFO;
            isLeafComponent = false;
          }
          const step = resolvePathStep(comp, nodeIds, vid);
          if (step) pathSteps.push(step);
          eventIds = [];
          nodeIds = [];
        }
        if (nid !== undefined) nodeIds.push({ nid, si, sk });
      }
      depth += 1;
      node = node.parentNode;
    }
    return [new Path(pathSteps.reverse()), handlers];
  }
  static fromEvent(e, rNode, maxDepth, comps, stopOnNoEvent = true) {
    const { type, target } = e;
    return Path.fromNodeAndEventName(target, type, rNode, maxDepth, comps, stopOnNoEvent);
  }
}
const EMPTY_META = {};
function parseMetaComment(n) {
  if (n?.nodeType === 8 && n.textContent[0] === "§") {
    const m = parseMetaComment(n.previousSibling);
    if (m !== EMPTY_META) return m;
    try {
      return JSON.parse(n.textContent.slice(1, -1));
    } catch (err) {
      console.warn(err, n);
    }
  }
  return EMPTY_META;
}
function findHandlers(comp, eventIds, vid, eventName) {
  for (const eid of eventIds) {
    const handlers = comp.getEventForId(+eid, vid).getHandlersFor(eventName);
    if (handlers !== null) return handlers;
  }
  return null;
}
class StepCtx {
  constructor(comp, nodeIds, idx, vid) {
    this.comp = comp;
    this.nodeIds = nodeIds;
    this.idx = idx;
    this.vid = vid;
  }
  get meta() {
    return this.nodeIds[this.idx];
  }
  get key() {
    const m = this.meta;
    return m.si !== undefined ? +m.si : m.sk;
  }
  get hasKey() {
    const m = this.meta;
    return m.si !== undefined || m.sk !== undefined;
  }
  next() {
    return this.idx + 1 < this.nodeIds.length
      ? new StepCtx(this.comp, this.nodeIds, this.idx + 1, this.vid)
      : null;
  }
  resolveNode() {
    return this.comp.getNodeForId(+this.meta.nid, this.vid);
  }
  applyKey(pi) {
    if (pi === null) return null;
    const m = this.meta;
    if (m.si !== undefined) return pi.withIndex(+m.si);
    if (m.sk !== undefined) return pi.withKey(m.sk);
    return pi;
  }
}
function resolvePathStep(comp, nodeIds, vid) {
  for (let i = 0; i < nodeIds.length; i++) {
    const ctx = new StepCtx(comp, nodeIds, i, vid);
    const step = ctx.resolveNode().toPathStep(ctx);
    if (step !== null) return step;
  }
  return null;
}
const NO_EVENT_INFO = [null, null];
export class PathBuilder {
  constructor() {
    this.pathChanges = [];
  }
  add(pathChange) {
    this.pathChanges.push(pathChange);
    return this;
  }
  field(name) {
    return this.add(new FieldStep(name));
  }
  index(name, index) {
    return this.add(new SeqIndexStep(name, index));
  }
  key(name, key) {
    return this.add(new SeqKeyStep(name, key));
  }
}
