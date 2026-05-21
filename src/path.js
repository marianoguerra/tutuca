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
  toAbstractPathStep() {
    return this;
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
  toAbstractPathStep() {
    return null;
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
    return new SeqStep(this.field, i);
  }
  withKey(k) {
    return new SeqStep(this.field, k);
  }
}
export class SeqStep extends Step {
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
    const seq = root?.get(this.field, null);
    return seq ? root.set(this.field, seq.set(this.key, v)) : root;
  }
  enterFrame(stack, _prev, next) {
    return stack.enter(next, { key: this.key }, true);
  }
}
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
  toAbstractPathStep() {
    return null;
  }
}
export class EachRenderItStep extends SeqStep {
  enterFrame(stack, _prev, next) {
    return stack.enter(next, { key: this.key, value: next }, false).enter(next, {}, true);
  }
  toAbstractPathStep() {
    return new SeqStep(this.field, this.key);
  }
}
function warnRawDynStep(op, step) {
  console.warn(`Path.${op} reached a DynStep: call toTransactionPath() first`, step);
}
// A dynamic variable (`*dyn`) used as a render target. The rendered component's
// data lives at the *producer* component (where the dynamic was defined), not at
// the consumer that wrote `<x render="*dyn">`. A DynStep is a marker: it survives
// `compact()` so the dispatch path still walks every intermediate component for
// bubbling, while `Path.toTransactionPath()` teleports it — dropping every step
// interior to the producer..consumer span and splicing in the producer's path.
export class DynStep extends Step {
  constructor(producerCompId, producerSteps) {
    super();
    this.producerCompId = producerCompId;
    this.producerSteps = producerSteps;
    this.interiorCids = new Set(); // component ids crossed from producer..consumer
  }
  // Steps spliced into the transaction path in place of this marker.
  teleportSteps() {
    return this.producerSteps;
  }
  lookup(_v, dval = null) {
    warnRawDynStep("lookup", this);
    return dval;
  }
  setValue(root, _v) {
    warnRawDynStep("setValue", this);
    return root;
  }
  enterFrame(stack, _prev, _next) {
    warnRawDynStep("enterFrame", this);
    return stack;
  }
}
// A dynamic variable used as an *iterated* render target (`@each="*dyn"` with
// `<x render-it>`, or `<x render-each="*dyn">`): the item lives at the producer's
// sequence field, keyed by `key`.
export class DynEachStep extends DynStep {
  constructor(producerCompId, producerSteps, key) {
    super(producerCompId, producerSteps);
    this.key = key;
  }
  teleportSteps() {
    const { producerSteps, key } = this;
    if (producerSteps.length === 0) return producerSteps;
    const last = producerSteps[producerSteps.length - 1];
    return producerSteps.slice(0, -1).concat(new SeqStep(last.field, key));
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
  // The dispatch path: frame-only steps removed, one step per crossed component
  // (DynStep included). `popStep` over it bubbles through every component.
  compact() {
    const out = [];
    for (const step of this.steps) {
      const s = step.toAbstractPathStep();
      if (s !== null) {
        if (s !== step) s._originCid = step._originCid; // keep provenance for teleport
        out.push(s);
      }
    }
    return new Path(out);
  }
  // The abstract path used to apply a transaction: every DynStep is teleported —
  // the steps interior to its producer..consumer span are dropped and the
  // producer's own path spliced in — so a mutation lands on the data's real
  // location. A path with no DynStep is returned unchanged.
  toTransactionPath() {
    let hasDyn = false;
    for (const step of this.steps)
      if (step instanceof DynStep) {
        hasDyn = true;
        break;
      }
    if (!hasDyn) return this;
    const out = [];
    for (const step of this.steps) {
      if (step instanceof DynStep) {
        while (out.length > 0 && step.interiorCids.has(out[out.length - 1]._originCid))
          out.pop();
        for (const ts of step.teleportSteps()) {
          ts._originCid = step.producerCompId;
          out.push(ts);
        }
      } else out.push(step);
    }
    return new Path(out);
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
    const pendingDyns = []; // DynSteps still walking up toward their producer
    const bubbles = BUBBLING_EVENTS.has(eventName);
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
          const cidNum = +cid;
          const comp = comps.getComponentForId(cidNum);
          let pushStep = true;
          if (handlers === null && (isLeafComponent || bubbles)) {
            handlers = findHandlers(comp, eventIds, vid, eventName);
            if (handlers === null) {
              if (isLeafComponent && stopOnNoEvent && !bubbles) return NO_EVENT_INFO;
            } else if (!isLeafComponent) {
              pathSteps.length = 0; // handler bubbled up to an ancestor component: the returned path must
              pendingDyns.length = 0; // resolve to that component's value, so drop the steps that descend below it
              pushStep = false;
            }
          }
          isLeafComponent = false;
          for (const dyn of pendingDyns) dyn.interiorCids.add(cidNum); // crossed below a teleport's producer
          if (pushStep) {
            const step = resolvePathStep(comp, nodeIds, vid);
            if (step) {
              step._originCid = cidNum;
              pathSteps.push(step);
              if (step instanceof DynStep) {
                step.interiorCids.add(cidNum);
                pendingDyns.push(step);
              }
            }
          }
          for (let i = pendingDyns.length - 1; i >= 0; i--)
            if (pendingDyns[i].producerCompId === cidNum) pendingDyns.splice(i, 1); // reached the producer
          eventIds = [];
          nodeIds = [];
        }
        if (nid !== undefined) nodeIds.push({ nid, si, sk });
      }
      depth += 1;
      node = node.parentNode;
    }
    if (pendingDyns.length > 0)
      console.warn("event reconstruction: dynamic-var producer not found", pendingDyns);
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
    const { idx, nodeIds } = this;
    return idx + 1 < nodeIds.length ? new StepCtx(this.comp, nodeIds, idx + 1, this.vid) : null;
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
const BUBBLING_EVENTS = new Set(["drop"]); // Events whose handlers bubble across component boundaries to ancestor components
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
    return this.add(new SeqStep(name, index));
  }
  key(name, key) {
    return this.add(new SeqStep(name, key));
  }
}
