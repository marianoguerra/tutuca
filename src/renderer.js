import { NullDomCache, WeakMapDomCache } from "./cache.js";
import { makeLoopCtx, walkLoopBindings } from "./iteration.js";
import { h, render, VComment, VFragment } from "./vdom.js";

export {
  callEnricher,
  filterAlwaysTrue,
  getSeqInfo,
  makeLoopCtx,
  normalizeRange,
  nullLoopWith,
  SEQ_INFO,
  unpackLoopResult,
} from "./iteration.js";

const DATASET_ATTRS = ["nid", "cid", "eid", "vid", "si", "sk"];
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
    // The cached subtree depends on the FULL effective view context: the
    // explicit per-site selector (`viewName`, from `as=`) AND the inherited
    // pushed-view stack (`stack.viewsId`, from `@push-view`) — descendants
    // without their own `as=` resolve against the latter even when this site
    // set one. Keep both; `\x1f` can't appear in a view name or key, so the
    // three fields can't ambiguously merge.
    const cacheKey = `${viewName ?? ""}\x1f${stack.viewsId ?? ""}\x1f${key}`;
    const cachePath = [node, val];
    stack._pushDynBindValuesToArray(cachePath, comp);
    const cachedNode = this.cache.get(cachePath, cacheKey);
    if (cachedNode) return cachedNode;
    const view = viewName ? comp.getView(viewName) : stack.lookupBestView(comp.views, "main");
    const body = this.renderView(view, stack);
    // A component that renders nothing (e.g. its view root is `@show`-hidden)
    // has no DOM to carry events or two-way binds, so it needs no boundary.
    // Emitting a `§Comp§` meta anyway leaves it dangling before the next
    // sibling: event-path reconstruction would then cross this absent component
    // and resolve the sibling's node id inside this (node-less) view, crashing
    // with a null `getNodeForId` — see resolvePathStep in path.js.
    if (body == null) return null;
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
    const dom = new VFragment([meta, body]);
    this.cache.set(cachePath, cacheKey, dom);
    return dom;
  }
  pushEachEntry(r, nid, attrName, key, dom) {
    r.push(this._renderMetadata({ $: "Each", nid, [attrName]: key }), dom);
  }
  renderEachWhen(stack, iterInfo, view, nid) {
    const { seq, filter, loopWith, enricher } = iterInfo.eval(stack);
    const r = [];
    const it = stack.it;
    const renderOne = (key, value, attrName, binds) => {
      const cachePath = enricher ? [view, it, value] : [view, value];
      // Include the inherited pushed-view stack: this repeated subtree may hold
      // `<x render>` descendants that resolve against it (see _rValComp).
      const cacheKey = `${stack.viewsId ?? ""}\x1f${nid}\x1f${key}`;
      const cachedNode = this.cache.get(cachePath, cacheKey);
      if (cachedNode) this.pushEachEntry(r, nid, attrName, key, cachedNode);
      else {
        const dom = this.renderView(view, stack.enter(value, binds, false));
        // A `@show`-hidden item view renders null: skip its boundary so it
        // leaves no dangling `§Each§` meta before the next visible sibling.
        if (dom != null) this.pushEachEntry(r, nid, attrName, key, dom);
        this.cache.set(cachePath, cacheKey, dom);
      }
    };
    walkLoopBindings(
      { seq, it, filter, loopWith, enricher, ctx: makeLoopCtx(stack, filter) },
      renderOne,
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
  // Prefix a loop-less @enrich-with subtree with a boundary meta so event-path
  // reconstruction replays its binds (mirrors the §Each§ / §Comp§ metas).
  renderScopeMeta(nid, dom) {
    return new VFragment([this._renderMetadata({ $: "Scope", nid }), dom]);
  }
}
