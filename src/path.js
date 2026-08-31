import { seqGet } from "./collection.js";
import { produce } from "./immer.js";

const NONE = Symbol("NONE");
const readKey = (value, key, dval = null) => {
  if (value == null) return dval;
  if (value instanceof Map) return value.has(key) ? value.get(key) : dval;
  if (value instanceof Set) return value.has(key) ? key : dval;
  return Object.hasOwn(value, key) ? value[key] : dval;
};
const writeKey = (value, key, next) => {
  if (value instanceof Map) value.set(key, next);
  else if (value instanceof Set) {
    value.delete(key);
    value.add(next);
  } else value[key] = next;
};
const writeSeqKey = (value, key, next) => {
  if (
    value instanceof Map ||
    value instanceof Set ||
    Array.isArray(value) ||
    Object.hasOwn(value, key)
  )
    writeKey(value, key, next);
  else if (typeof value?.set === "function") value.set(key, next);
  else writeKey(value, key, next);
};
export class Step {
  lookup(_v, dval = null) {
    return dval;
  }
  setDraftValue(_root, _v) {}
  // Re-enter this step while rebuilding a stack. `renderPath` is the dispatch
  // position AFTER this step: a rebuilt frame must carry the same render path
  // the renderer had there, or the provides it publishes would be located wrong.
  enterFrame(stack, next, renderPath) {
    return stack.enter(next, {}, true, renderPath);
  }
  toAbstractPathStep() {
    return this;
  }
  // Freeze any field-resolved key against the value `v` entering this step (see
  // `Path.pinKeys`). Most steps carry no live key and pin to themselves.
  pinKey(_v) {
    return this;
  }
  // A generic `{ field, key? }` descriptor for this step, or null for frame-only
  // steps (binds) that address no field. Used by `Path.toKeys()` so tooling can
  // introspect a path without reaching into Step subclasses.
  toKey() {
    return null;
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
  enterFrame(stack, next, renderPath) {
    return stack.enter(next, { ...this.binds }, false, renderPath);
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
// Like BindStep, but re-evaluates a loop-less @enrich-with handler against the
// rebuilt stack so its custom binds are present when a path is rebuilt.
export class ScopeBindStep extends BindStep {
  constructor(val, binds = {}) {
    super(binds);
    this.val = val;
  }
  enterFrame(stack, next, renderPath) {
    const dyn = this.val.evalAsHandler(stack)?.call(stack.it) ?? {};
    return stack.enter(next, { ...this.binds, ...dyn }, false, renderPath);
  }
  withIndex(i) {
    return new ScopeBindStep(this.val, { ...this.binds, key: i });
  }
  withKey(key) {
    return new ScopeBindStep(this.val, { ...this.binds, key });
  }
}
export class FieldStep extends Step {
  constructor(field) {
    super();
    this.field = field;
  }
  lookup(v, dval = null) {
    return readKey(v, this.field, dval);
  }
  setDraftValue(root, v) {
    writeKey(root, this.field, v);
  }
  withIndex(i) {
    return new SeqStep(this.field, i);
  }
  withKey(k) {
    return new SeqStep(this.field, k);
  }
  toKey() {
    return { field: this.field };
  }
}
export class SeqStep extends Step {
  constructor(field, key) {
    super();
    this.field = field;
    this.key = key;
  }
  lookup(v, dval = null) {
    return seqGet(readKey(v, this.field, null), this.key, dval);
  }
  setDraftValue(root, v) {
    const seq = readKey(root, this.field, null);
    if (seq != null) writeSeqKey(seq, this.key, v);
  }
  enterFrame(stack, next, renderPath) {
    return stack.enter(next, { key: this.key }, true, renderPath);
  }
  toKey() {
    return { field: this.field, key: this.key };
  }
}
export class SeqAccessStep extends Step {
  constructor(seqField, keyField) {
    super();
    this.seqField = seqField;
    this.keyField = keyField;
  }
  lookup(v, dval = null) {
    const seq = readKey(v, this.seqField, NONE);
    const key = readKey(v, this.keyField, NONE);
    return key !== NONE && seq !== NONE ? seqGet(seq, key, dval) : dval;
  }
  setDraftValue(root, v) {
    const seq = readKey(root, this.seqField, NONE);
    const key = readKey(root, this.keyField, NONE);
    if (seq !== NONE && key !== NONE) writeSeqKey(seq, key, v);
  }
  // Resolve `keyField` against `v` now and freeze it as a literal-key `SeqStep`, so a
  // later lookup/setValue lands on this same item even if `keyField` changes meanwhile.
  pinKey(v) {
    const key = readKey(v, this.keyField, NONE);
    return key === NONE ? this : new SeqStep(this.seqField, key);
  }
  // The key is a *field reference* resolved live, so it is unknown without a value;
  // report the seq field (no key) rather than dropping the step, which would shift
  // the indices of later keys. Call `Path.pinKeys(root)` first to get a concrete key.
  toKey() {
    return { field: this.seqField };
  }
}
export class EachBindStep extends Step {
  constructor(iterInfo, key) {
    super();
    this.iterInfo = iterInfo;
    this.key = key;
  }
  lookup(v, _dval) {
    return v;
  }
  // Replay the renderer's per-item binds (key, value + any @enrich-with binds)
  // so a rebuilt stack matches the one @each rendered with.
  enterFrame(stack, next, renderPath) {
    return stack.enter(next, this.iterInfo.enrichBinds(stack, this.key), false, renderPath);
  }
  toAbstractPathStep() {
    return null;
  }
}
export class EachRenderItStep extends SeqStep {
  enterFrame(stack, next, renderPath) {
    return stack
      .enter(next, { key: this.key, value: next }, false, renderPath)
      .enter(next, {}, true, renderPath);
  }
  toAbstractPathStep() {
    return new SeqStep(this.field, this.key);
  }
}
// ---- resume bases on the wire -----------------------------------------
// A `provide` doubles as the path a `<x render="*name">` resumes at, so that
// path has to reach event reconstruction — it travels in the `§Comp§` meta
// comment and on `data-rp`. Only addressing steps have a wire form, which is
// all a base can be made of: the grammar restricts a provide to a field or a
// seq access. A step with no encoding drops the whole path — half a path
// addresses the wrong value, and no path at all is the safe answer.
function stepToJson(step) {
  if (step instanceof SeqStep) return { f: step.field, k: step.key };
  if (step instanceof FieldStep) return { f: step.field };
  if (step instanceof SeqAccessStep) return { f: step.seqField, a: step.keyField };
  return null;
}
function stepFromJson(j) {
  if (j == null || typeof j.f !== "string") return null;
  if (j.k !== undefined) return new SeqStep(j.f, j.k);
  if (j.a !== undefined) return new SeqAccessStep(j.f, j.a);
  return new FieldStep(j.f);
}
export function pathToJson(path) {
  const out = [];
  for (const step of path.steps) {
    const j = stepToJson(step);
    // Null, not `[]`: an empty path addresses the ROOT, so encoding a path we
    // could not write down as one would silently resume the whole app there.
    if (j === null) return null;
    out.push(j);
  }
  return out;
}
function pathFromJson(j) {
  if (!Array.isArray(j)) return null;
  const steps = [];
  for (const item of j) {
    const step = stepFromJson(item);
    if (step === null) return null;
    steps.push(step);
  }
  return new Path(steps);
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
  // Frame-only steps removed, one step per crossed component: `popStep` over the
  // result bubbles through every component.
  compact() {
    const out = [];
    for (const step of this.steps) {
      const s = step.toAbstractPathStep();
      if (s !== null) out.push(s);
    }
    return new Path(out);
  }
  // Resolve every field-keyed step (e.g. `SeqAccessStep`) against `root`, freezing the
  // key as it is *now* so a later lookup/setValue lands on the same item even if the
  // keyField changed meanwhile (e.g. the selected tab moved while an intent was in
  // flight). Returns a new Path with those steps replaced; `this` if nothing pinned.
  pinKeys(root) {
    let curVal = root;
    let out = null;
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const pinned = step.pinKey(curVal);
      // biome-ignore lint/suspicious/noAssignInExpressions: lazy-clone steps on first change
      if (pinned !== step) (out ??= this.steps.slice())[i] = pinned;
      curVal = step.lookup(curVal, NONE);
      if (curVal === NONE) break;
    }
    return out ? new Path(out) : this;
  }
  lookup(v, dval = null) {
    let curVal = v;
    for (const step of this.steps) {
      curVal = step.lookup(curVal, NONE);
      if (curVal === NONE) return dval;
    }
    return curVal;
  }
  // The values entered along the path, root→leaf (root included): index 0 is `root`,
  // the last entry is the leaf this path resolves to. Stops early at the first
  // unresolvable step. Used to walk the component instances on a dispatch path
  // (filter via Components.getCompFor).
  resolveChain(root) {
    const out = [root];
    let curVal = root;
    for (const step of this.steps) {
      curVal = step.lookup(curVal, NONE);
      if (curVal === NONE) break;
      out.push(curVal);
    }
    return out;
  }
  // A flat `[{ field, key? }]` list of the addressing steps, skipping frame-only
  // steps (binds). Generic path introspection so tooling (e.g. the storybook
  // activity log) can identify which subtree a transaction touched without
  // depending on Step internals.
  toKeys() {
    const out = [];
    for (const step of this.steps) {
      const k = step.toKey();
      if (k !== null) out.push(k);
    }
    return out;
  }
  setValue(root, v) {
    if (this.steps.length === 0) return v;
    // Immer owns the ancestor rebuilding. The replacement value is already finalized by
    // the leaf recipe, so this second short recipe only walks and copies the path spine.
    return produce(root, (draft) => {
      let parent = draft;
      for (let i = 0; i < this.steps.length - 1; i++) {
        parent = this.steps[i].lookup(parent, NONE);
        if (parent === NONE) return;
      }
      this.steps.at(-1).setDraftValue(parent, v);
    });
  }
  buildStack(stack) {
    return walkItems(stack, this.steps, stack.renderPath ?? new DispatchPath(), this)?.[0] ?? null;
  }
}
// Walk `items` from `stack`, entering each step's frame and extending
// `renderPath` as it goes. Returns `[stack, renderPath]`, or null on a step
// that does not resolve.
function walkItems(stack, items, renderPath, path) {
  let prev = stack.it;
  for (const step of items) {
    const next = step.lookup(prev, NONE);
    if (next === NONE) {
      console.warn("bad PathItem", { root: stack.it, step, path });
      return null;
    }
    renderPath = renderPath.pushItem(step);
    stack = step.enterFrame(stack, next, renderPath);
    prev = next;
  }
  return [stack, renderPath];
}
const EMPTY_PATH = new Path([]);
// A render path as a stack of continuations. Ordinary rendering extends the top
// frame; rendering a located binding (`<x render="*name">`) pushes a new frame
// based at the value's own absolute path, because that is where the value lives
// and where an edit inside it has to land.
//
// `toTransactionPath` therefore reads the TOP frame alone — the saved frames
// below it are the visual callers, and they matter only to bubbling: `popStep`
// drains the top frame and then pops it, returning to the caller that wrote the
// `*name`. Nested providers shadow by live render ancestry, so nothing here has
// to know who produced a name.
export class DispatchPath {
  constructor(frames = [{ base: EMPTY_PATH, items: [] }]) {
    this.frames = frames;
  }
  // Plain addressing steps in one frame based at the root: what a caller means
  // by "this position" when it has no continuation of its own.
  static ofSteps(steps) {
    return new DispatchPath([{ base: EMPTY_PATH, items: steps.slice() }]);
  }
  get top() {
    return this.frames[this.frames.length - 1];
  }
  _withTopItems(items) {
    const frames = this.frames.slice();
    frames[frames.length - 1] = { base: this.top.base, items };
    return new DispatchPath(frames);
  }
  concat(steps) {
    if (this.frames.length === 0) return DispatchPath.ofSteps(steps);
    return this._withTopItems(this.top.items.concat(steps));
  }
  pushItem(step) {
    return this.concat([step]);
  }
  pushFrame(base) {
    return new DispatchPath(this.frames.concat({ base, items: [] }));
  }
  // Whether bubbling has anywhere left to go: another step in this frame, or a
  // visual caller underneath it.
  canPop() {
    const n = this.frames.length;
    return n > 1 || (n === 1 && this.frames[0].items.length > 0);
  }
  isRoot() {
    return this.toTransactionPath().steps.length === 0;
  }
  // One component closer to the root. At the top of a frame that is popping back
  // to the visual caller, not to the producer's own parent — the caller is where
  // the `*name` was written, and where an unhandled message should keep going.
  popStep() {
    const n = this.frames.length;
    if (n === 0) return this;
    const top = this.frames[n - 1];
    if (top.items.length > 0) return this._withTopItems(top.items.slice(0, -1));
    if (n > 1) return new DispatchPath(this.frames.slice(0, -1));
    return this;
  }
  // Drop frame-only steps inside every frame independently; a frame's base is
  // already addressing-only.
  compact() {
    return new DispatchPath(
      this.frames.map(({ base, items }) => ({ base, items: new Path(items).compact().steps })),
    );
  }
  // A stable string for the ADDRESS this path denotes, for the render cache. The
  // same immutable value can sit at two places in the tree, and a subtree rendered
  // at one of them bakes that address in — the provides it publishes are located
  // there. Frame-only steps address nothing, so they are compacted out: two sites
  // that differ only in binds do render the same subtree.
  get addressKey() {
    this._addressKey ??= renderPathText(this.toTransactionPath().compact());
    return this._addressKey;
  }
  // The active transaction address: the top frame's absolute base followed by
  // its ordinary descendant steps. This is where a mutation lands.
  toTransactionPath() {
    const top = this.top;
    return top === undefined ? EMPTY_PATH : top.base.concat(top.items);
  }
  // Rebuild the render stack this path was dispatched from. A frame with a base
  // re-enters at that absolute value first — replaying the resume a `*name`
  // render performed — and then walks its ordinary items.
  buildStack(stack) {
    let renderPath = new DispatchPath();
    for (let i = 0; i < this.frames.length; i++) {
      const { base, items } = this.frames[i];
      if (i > 0 || base.steps.length > 0) {
        const baseValue = base.lookup(stack.root, NONE);
        if (baseValue === NONE) {
          console.warn("bad frame base", { base, path: this });
          return null;
        }
        renderPath = renderPath.pushFrame(base);
        stack = stack.enter(baseValue, {}, true, renderPath);
      }
      const walked = walkItems(stack, items, renderPath, this);
      if (walked === null) return null;
      [stack, renderPath] = walked;
    }
    return stack;
  }
  static fromNodeAndEventName(node, eventName, rootNode, maxDepth, comps, stopOnNoEvent = true) {
    const parts = [];
    const bubbles = BUBBLING_EVENTS.has(eventName);
    let depth = 0;
    let eventIds = [];
    let handlers = null;
    let nodeRefs = [];
    let isLeafComponent = true;
    // Cross one component boundary `cidNum`: resolve the event handlers (once)
    // and the path part that leaves this component — a step, or a frame when the
    // site resumed at an absolute base. Returns false to signal "no handler on
    // the leaf component" — caller aborts with NO_EVENT_INFO.
    const crossComponent = (cidNum, vid) => {
      const comp = comps.getComponentForId(cidNum);
      let pushPart = true;
      if (handlers === null && (isLeafComponent || bubbles)) {
        handlers = findHandlers(comp, eventIds, vid, eventName);
        if (handlers === null) {
          if (isLeafComponent && stopOnNoEvent && !bubbles) return false;
        } else if (!isLeafComponent) {
          parts.length = 0; // handler bubbled up to an ancestor component: the returned path
          pushPart = false; // must resolve to that component's value, so drop what descends below it
        }
      }
      isLeafComponent = false;
      if (pushPart) {
        const part = resolvePathPart(comp, nodeRefs, vid);
        if (part) parts.push(part);
      }
      eventIds = [];
      nodeRefs = [];
      return true;
    };
    while (node && node !== rootNode && depth < maxDepth) {
      if (node?.dataset) {
        const { eid, cid, vid, rp } = node.dataset;
        if (eid !== undefined) eventIds.push(eid);
        // Meta comments before the element, innermost-first. A `Comp` meta is
        // a component boundary — there is one per rendered component even when
        // its view is a bare `<x render>` that contributes no DOM element of
        // its own (a "passthrough" component). An `Each` meta is an iteration
        // step; an iterated component (`@each`/`render-each` over `<x render-it>`)
        // emits both — the keyless `Comp` for the boundary, then the keyed `Each`
        // outside it — and `RenderItNode.toPathStep` pairs them back up.
        const metas = metaChain(node.previousSibling);
        let sawComp = false;
        for (const m of metas) {
          if (m.$ === "Comp") {
            sawComp = true;
            if (!crossComponent(m.cid, m.vid)) return NO_EVENT_INFO;
            nodeRefs.push({ nid: m.nid, base: pathFromJson(m.base) });
          } else {
            nodeRefs.push({ nid: m.nid, si: m.si, sk: m.sk });
          }
        }
        // A fragment-rooted component stamps `data-cid` on every child but
        // emits a single `Comp` meta (before the first child); later children
        // carry the boundary only on the element itself — and, when the site
        // resumed, its base on `data-rp`.
        if (!sawComp && cid !== undefined) {
          if (!crossComponent(+cid, vid)) return NO_EVENT_INFO;
          if (rp !== undefined) {
            const base = parseRenderPath(rp);
            if (base !== null) nodeRefs.push({ base });
          }
        }
      }
      depth += 1;
      node = node.parentNode;
    }
    parts.reverse();
    let path = new DispatchPath();
    for (const part of parts)
      path = part.base !== undefined ? path.pushFrame(part.base) : path.pushItem(part.step);
    return [path, handlers];
  }
}
// Key one item of a located sequence: the base addresses the sequence, so the
// item is that same field at `key`. A base whose last step resolves its key live
// (`.a[.b]`) addresses one item rather than a sequence and cannot be keyed.
export function keyedPath(path, key) {
  const steps = path.steps;
  const last = steps[steps.length - 1];
  if (last instanceof SeqStep || last instanceof FieldStep)
    return new Path(steps.slice(0, -1).concat(new SeqStep(last.field, key)));
  return null;
}
function renderPathText(path) {
  return JSON.stringify(pathToJson(path));
}
function parseRenderPath(text) {
  try {
    return pathFromJson(JSON.parse(text));
  } catch (err) {
    console.warn("bad render path", err, text);
    return null;
  }
}
// Collect the run of `§…§` meta comments immediately preceding an element,
// innermost-first (closest sibling first). The renderer emits them adjacently,
// one stream entry per crossed component / iteration.
function metaChain(n) {
  const out = [];
  while (n?.nodeType === 8 && n.textContent[0] === "§") {
    try {
      out.push(JSON.parse(n.textContent.slice(1, -1)));
    } catch (err) {
      console.warn(err, n);
    }
    n = n.previousSibling;
  }
  return out;
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
// The path part that leaves one component: `{ base }` when the render site
// resumed at an absolute path (a `*name` target — which contributes no step of
// its own, see RenderNode.toPathStep), otherwise `{ step }`.
function resolvePathPart(comp, nodeRefs, vid) {
  for (let i = 0; i < nodeRefs.length; i++) {
    const ref = nodeRefs[i];
    if (ref.base != null) return { base: ref.base };
    if (ref.nid === undefined || ref.nid === null) continue;
    const ctx = new StepCtx(comp, nodeRefs, i, vid);
    const step = ctx.resolveNode()?.toPathStep(ctx) ?? null;
    if (step !== null) return { step };
  }
  return null;
}
const NO_EVENT_INFO = [null, null];
const BUBBLING_EVENTS = new Set(["drop"]); // Events whose handlers bubble across component boundaries to ancestor components
// A fresh address builder. `ctx.at` is one bound to a dispatcher; this is the
// standalone form, for naming a position outside a handler.
export const path = () => new PathBuilder();
export class PathBuilder {
  constructor() {
    this.pathChanges = [];
  }
  toPath() {
    return new Path(this.pathChanges);
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
