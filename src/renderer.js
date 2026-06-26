import { isIndexed, isKeyed } from "../deps/immutable.js";
import { NullDomCache, WeakMapDomCache } from "./cache.js";
import { h, render, VComment, VFragment } from "./vdom.js";

export const DATASET_ATTRS = ["nid", "cid", "eid", "vid", "si", "sk"];
export class Renderer {
  constructor(comps) {
    this.comps = comps;
    this.cache = new WeakMapDomCache();
    this.renderTag = h;
  }
  renderFragment(childs) {
    return new VFragment(childs);
  }
  renderComment(text) {
    return new VComment(text);
  }
  setNullCache() {
    this.cache = new NullDomCache();
  }
  renderToDOM(stack, val) {
    const rootNode = document.createElement("div");
    const rOpts = { document };
    render(h("DIV", null, [this.renderRoot(stack, val)]), rootNode, rOpts);
    return rootNode.childNodes[0];
  }
  renderToString(stack, val, cleanAttrs = true) {
    const dom = this.renderToDOM(stack, val);
    if (cleanAttrs) {
      const nodes = dom.querySelectorAll("[data-nid],[data-cid],[data-eid]");
      for (const { dataset } of nodes) for (const name of DATASET_ATTRS) delete dataset[name];
    }
    return dom.innerHTML;
  }
  renderRoot(stack, val, viewName = null) {
    const comp = this.comps.getCompFor(val);
    if (comp === null) return null;
    return this._rValComp(stack, val, comp, comp.getView(viewName).anode, "ROOT", viewName);
  }
  renderIt(stack, node, key, viewName) {
    const comp = this.comps.getCompFor(stack.it);
    return comp ? this._rValComp(stack, stack.it, comp, node, key, viewName) : null;
  }
  // `node` is the parse node of the render site (`<x render>` / `render-it` /
  // `render-each`, or the view's root anode for the app root). It keys the
  // cache as a globally-unique object: node ids alone are unique only within a
  // single view, so the same value rendered by two components (e.g. through a
  // shared dynamic-var sequence) would otherwise collide in the cache.
  _rValComp(stack, val, comp, node, key, viewName) {
    const cacheKey = `${viewName ?? stack.viewsId ?? ""}-${key}`;
    const cachePath = [node, val];
    stack._pushDynBindValuesToArray(cachePath, comp);
    const cachedNode = this.cache.get(cachePath, cacheKey);
    if (cachedNode) return cachedNode;
    const view = viewName ? comp.getView(viewName) : stack.lookupBestView(comp.views, "main");
    // `cid`/`vid` mirror the `data-cid`/`data-vid` baked onto the view's root
    // element, but live in the meta comment so a component whose view is a
    // bare `<x render>` (no DOM element of its own to stamp) still marks its
    // boundary for event-path reconstruction.
    const meta = this._renderMetadata({
      $: "Comp",
      nid: node?.nodeId ?? null,
      cid: comp.id,
      vid: view.name,
    });
    const dom = new VFragment([meta, this.renderView(view, stack)]);
    this.cache.set(cachePath, cacheKey, dom);
    return dom;
  }
  pushEachEntry(r, nid, attrName, key, dom) {
    r.push(this._renderMetadata({ $: "Each", nid, [attrName]: key }), dom);
  }
  renderEach(stack, iterInfo, node, viewName) {
    const { seq, filter, loopWith } = iterInfo.eval(stack);
    const r = [];
    const { iterData, start, end, keys } = unpackLoopResult(
      loopWith.call(stack.it, seq, makeLoopCtx(stack, filter)),
      seq,
    );
    const renderOne = (key, value, attrName) => {
      const dom = this.renderIt(stack.enter(value, { key }, true), node, key, viewName);
      this.pushEachEntry(r, node.nodeId, attrName, key, dom);
    };
    // A `keys` return is authoritative — the handler already filtered, so we
    // render those keys directly and skip `@when`. The positional path keeps
    // the slice-then-filter behavior.
    if (keys) imKeysIter(seq, renderOne, keys);
    else
      getSeqInfo(seq)(
        seq,
        (key, value, attrName) => {
          if (filter.call(stack.it, key, value, iterData)) renderOne(key, value, attrName);
        },
        start,
        end,
      );
    return r;
  }
  renderEachWhen(stack, iterInfo, view, nid) {
    const { seq, filter, loopWith, enricher } = iterInfo.eval(stack);
    const r = [];
    const it = stack.it;
    const { iterData, start, end, keys } = unpackLoopResult(
      loopWith.call(it, seq, makeLoopCtx(stack, filter)),
      seq,
    );
    const renderOne = (key, value, attrName) => {
      const cachePath = enricher ? [view, it, value] : [view, value];
      const binds = { key, value };
      const cacheKey = `${nid}-${key}`;
      if (enricher) enricher.call(it, binds, key, value, iterData);
      const cachedNode = this.cache.get(cachePath, cacheKey);
      if (cachedNode) this.pushEachEntry(r, nid, attrName, key, cachedNode);
      else {
        const dom = this.renderView(view, stack.enter(value, binds, false));
        this.pushEachEntry(r, nid, attrName, key, dom);
        this.cache.set(cachePath, cacheKey, dom);
      }
    };
    // A `keys` return is authoritative — see renderEach.
    if (keys) imKeysIter(seq, renderOne, keys);
    else
      getSeqInfo(seq)(
        seq,
        (key, value, attrName) => {
          if (filter.call(it, key, value, iterData)) renderOne(key, value, attrName);
        },
        start,
        end,
      );
    return r;
  }
  renderView(view, stack) {
    let n = stack.binds[1];
    while (n !== null) {
      const b = n[0];
      if (b.isFrame) {
        if (stack.it !== b.it) break;
        console.error("recursion detected", stack.it, b.it);
        return new VComment("RECURSION AVOIDED");
      }
      n = n[1];
    }
    return view.render(stack, this);
  }
  _renderMetadata(info) {
    return new VComment(`§${JSON.stringify(info)}§`);
  }
  // Prefix a @scope/@enrich-with subtree with a boundary meta so event-path
  // reconstruction replays its binds (mirrors the §Each§ / §Comp§ metas).
  renderScopeMeta(nid, dom) {
    return new VFragment([this._renderMetadata({ $: "Scope", nid }), dom]);
  }
}
export const getSeqInfo = (seq) =>
  isIndexed(seq) ? imIndexedIter : isKeyed(seq) ? imKeyedIter : (seq?.[SEQ_INFO] ?? unkIter);
// Clamp a `@loop-with` `{ start, end }` range to `[0, size]` using
// `Array.prototype.slice` semantics: end-exclusive, negatives count from the
// end, `undefined` means the natural bound. `start`/`end` are positional.
export const normalizeRange = (start, end, size) => {
  let s = start == null ? 0 : start < 0 ? size + start : start;
  let e = end == null ? size : end < 0 ? size + end : end;
  s = s < 0 ? 0 : s > size ? size : s;
  e = e < 0 ? 0 : e > size ? size : e;
  return [s, e < s ? s : e];
};
// Defaults when `@each` has no `@when` / `@loop-with` attr.
export const filterAlwaysTrue = (_v, _k, _seq) => true;
export const nullLoopWith = (seq) => ({ iterData: { seq } });
// Read a `@loop-with` handler's result: `{ iterData, start, end, keys }`, all
// optional. `iterData` defaults to `{ seq }` so `@when`/`@enrich-with` can
// still reach the sequence when a handler omits it. `keys` (an explicit,
// ordered list of original keys to visit) takes precedence over `start`/`end`:
// the handler has already filtered/sorted/sliced, so the renderer visits
// exactly those keys — binding `@key` to each original key, which keeps event
// dispatch and two-way binding identity intact across filtering and paging.
export const unpackLoopResult = (result, seq) => {
  const r = result ?? {};
  return { iterData: r.iterData ?? { seq }, start: r.start, end: r.end, keys: r.keys };
};
// Walk an explicit, ordered list of original `keys`, visiting `seq.get(key)`
// for each. The meta-key attr matches the positional walkers (`si` for indexed
// sequences, `sk` otherwise) so event-path reconstruction resolves the key.
// `@when` is NOT applied here — a `keys` return means the handler already
// decided exactly what renders.
const imKeysIter = (seq, visit, keys) => {
  const attrName = isIndexed(seq) ? "si" : "sk";
  for (const key of keys) visit(key, seq.get(key), attrName);
};
// The context object passed to a `@loop-with` handler as its 2nd argument:
//   loopWith.call(it, seq, { lookup, filter })
// `lookup(name)` reads a scope `@`-binding (e.g. one published by an ancestor
// `@enrich-with`), so the handler can reuse already-computed values instead of
// recomputing them. `filter(key, value, iterData)` wraps the resolved `@when`
// predicate (always-true when there is no `@when`), so the handler can apply
// the declared filter while building its key slice. An object so it can grow.
export const makeLoopCtx = (stack, filter) => ({
  lookup: (name) => stack.lookupBind(name),
  filter: (key, value, iterData) => filter.call(stack.it, key, value, iterData),
});
const imIndexedIter = (seq, visit, start, end) => {
  // Random access skips the prefix/suffix entirely; `i` stays the original
  // index so `data-si` and path lookups (`EachBindStep`) keep their identity.
  const [s, e] = normalizeRange(start, end, seq.size);
  for (let i = s; i < e; i++) visit(i, seq.get(i), "si");
};
const imKeyedIter = (seq, visit, start, end) => {
  // Keyed maps have no positional random access; the prefix is counted but
  // not visited/rendered, and iteration breaks once past `end`.
  const [s, e] = normalizeRange(start, end, seq.size);
  let i = 0;
  for (const [k, v] of seq.toSeq().entries()) {
    if (i >= e) break;
    if (i >= s) visit(k, v, "sk");
    i++;
  }
};
const unkIter = () => {};
// A `SEQ_INFO` walker is `(seq, visit, start, end) => void`: it must honor the
// positional `[start, end)` range (see `normalizeRange`) and preserve each
// item's original key. Walkers may ignore the range, in which case the slice
// simply does not apply for that sequence type.
export const SEQ_INFO = Symbol.for("tutuca.seqInfo");
