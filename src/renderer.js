import { NullDomCache, WeakMapDomCache } from "./cache.js";
import { makeLoopCtx, walkLoopBindings } from "./iteration.js";
import { keyedPath, pathToJson } from "./path.js";
import { DynVal } from "./value.js";
import { h, render, VComment, VFragment, VNode } from "./vdom.js";

const DATASET_ATTRS = ["nid", "cid", "eid", "vid", "si", "sk", "rp"];
// Stamp the resume base on every element root of a component body. A
// fragment-rooted component emits ONE `§Comp§` meta, before its first child, so
// a later root sibling has to carry the base itself or an event raised there
// would reconstruct without the frame. Copies rather than mutates: a root may be
// a subtree the cache handed back.
function stampRenderBase(vdom, text) {
  if (vdom instanceof VNode)
    return new VNode(
      vdom.tag,
      { ...vdom.attrs, "data-rp": text },
      vdom.childs,
      vdom.key,
      vdom.namespace,
    );
  if (vdom instanceof VFragment)
    return new VFragment(vdom.childs.map((c) => stampRenderBase(c, text)));
  return vdom;
}
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
  // Library utilities for consumers embedding tutuca: render a value to a detached
  // DOM node / an HTML string. Not called by the framework itself.
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
  renderIt(stack, node, key, viewName, base = null) {
    const comp = this.comps.getCompFor(stack.it);
    return comp ? this._rValComp(stack, stack.it, comp, node, key, viewName, base) : null;
  }
  // `node` is the parse node of the render site (`<x render>` / `render-it` /
  // `render-each`, or the view's root anode for the app root). It keys the
  // cache as a globally-unique object: node ids alone are unique only within a
  // single view, so the same value rendered by two components (e.g. through a
  // shared dynamic-var sequence) would otherwise collide in the cache.
  _rValComp(stack, val, comp, node, key, viewName, base = null) {
    // The cached subtree depends on the FULL effective view context: the
    // explicit per-site selector (`viewName`, from `as=`) AND the inherited
    // pushed-view stack (`stack.viewsId`, from `@push-view`) — descendants
    // without their own `as=` resolve against the latter even when this site
    // set one. Keep both; `\x1f` can't appear in a view name or key, so the
    // three fields can't ambiguously merge.
    // The render position is part of the key too: this subtree bakes it in — the
    // provides it publishes are located here, and a resumed site records the base
    // it resumed at — so the same immutable value rendered at two addresses must
    // not share an entry.
    const cacheKey = `${viewName ?? ""}\x1f${stack.viewsId ?? ""}\x1f${key}\x1f${stack.renderPath.addressKey}`;
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
    // `base` is the absolute path this site resumed at, when it rendered a `*name`
    // (or an item of one). Event reconstruction turns it back into a continuation
    // frame: the mutation lands at the value's own location while bubbling still
    // returns to the caller that wrote the `*name`.
    const baseJson = base === null ? null : pathToJson(base);
    const meta = this._renderMetadata({
      $: "Comp",
      nid: node?.nodeId ?? null,
      cid: comp.id,
      vid: view.name,
      ...(baseJson === null ? null : { base: baseJson }),
    });
    const dom = new VFragment([
      meta,
      baseJson === null ? body : stampRenderBase(body, JSON.stringify(baseJson)),
    ]);
    this.cache.set(cachePath, cacheKey, dom);
    return dom;
  }
  pushEachEntry(r, nid, attrName, key, dom) {
    r.push(this._renderMetadata({ $: "Each", nid, [attrName]: key }), dom);
  }
  renderEachWhen(stack, each) {
    const { iterInfo, node: view, nodeId: nid } = each;
    const { seq, filter, loopWith, enricher } = iterInfo.eval(stack);
    // A dynamic sequence carries the absolute path it lives at, so each item is
    // that path keyed — and iterating it resumes there, exactly as rendering one
    // does. `pendingFrame` hands the base to the component boundary below, which
    // is the first place there is DOM to record it on.
    const seqPath =
      iterInfo.val instanceof DynVal
        ? (stack.lookupDynamicLocated(iterInfo.val.name)?.path ?? null)
        : null;
    const r = [];
    const it = stack.it;
    const renderOne = (key, value, attrName, binds) => {
      const itemBase = seqPath === null ? null : keyedPath(seqPath, key);
      const itemStep = itemBase === null ? each.itemStep(key) : null;
      const itemPath =
        itemBase !== null
          ? stack.renderPath.pushFrame(itemBase)
          : itemStep !== null
            ? stack.renderPath.pushItem(itemStep)
            : stack.renderPath;
      const cachePath = enricher ? [view, it, value] : [view, value];
      // Include the inherited pushed-view stack: this repeated subtree may hold
      // `<x render>` descendants that resolve against it (see _rValComp).
      const cacheKey = `${stack.viewsId ?? ""}\x1f${nid}\x1f${key}\x1f${itemPath.addressKey}`;
      const cachedNode = this.cache.get(cachePath, cacheKey);
      if (cachedNode) this.pushEachEntry(r, nid, attrName, key, cachedNode);
      else {
        const dom = this.renderView(
          view,
          stack.enter(value, binds, false, itemPath, itemBase !== null),
        );
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
