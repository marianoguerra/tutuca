import { isIndexed, isKeyed } from "../deps/immutable.js";
import { NullDomCache, WeakMapDomCache } from "./cache.js";
import { h, render, VComment, VFragment } from "./vdom.js";

export const DATASET_ATTRS = ["nid", "cid", "eid", "vid", "si", "sk"];
export class Renderer {
  constructor(comps) {
    this.comps = comps;
    this.cache = new WeakMapDomCache();
  }
  getSeqInfo(seq) {
    return isIndexed(seq)
      ? imIndexedIter
      : isKeyed(seq)
        ? imKeyedIter
        : (seqInfoByClass.get(seq?.constructor) ?? unkIter);
  }
  renderTag(tag, attrs, childs) {
    return h(tag, attrs, childs);
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
    render(h("div", null, [this.renderRoot(stack, val)]), rootNode, rOpts);
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
    const nid = comp.getView(viewName).anode.nodeId ?? null;
    return comp ? this._rValComp(stack, val, comp, nid, "ROOT", viewName) : null;
  }
  renderIt(stack, nodeId, key, viewName) {
    const comp = this.comps.getCompFor(stack.it);
    return comp ? this._rValComp(stack, stack.it, comp, nodeId, key, viewName) : null;
  }
  _rValComp(stack, val, comp, nid, key, viewName) {
    const cacheKey = `${viewName ?? stack.viewsId ?? ""}${nid}-${key}`;
    const cachedNode = this.cache.get(val, cacheKey);
    if (cachedNode) return cachedNode;
    const view = viewName ? comp.getView(viewName) : stack.lookupBestView(comp.views, "main");
    const meta = this._renderMetadata({ $: "Comp", nid });
    const dom = new VFragment([meta, this.renderView(view, stack)]);
    this.cache.set(val, cacheKey, dom);
    return dom;
  }
  pushEachEntry(r, nid, attrName, key, dom) {
    r.push(this._renderMetadata({ $: "Each", nid, [attrName]: key }), dom);
  }
  renderEach(stack, iterInfo, nodeId, viewName) {
    const { seq, filter, loopWith } = iterInfo.eval(stack);
    const r = [];
    const iterData = loopWith.call(stack.it, seq);
    this.getSeqInfo(seq)(seq, (key, value, attrName) => {
      if (filter.call(stack.it, key, value, iterData)) {
        const newStack = stack.enter(value, { key }, true);
        const dom = this.renderIt(newStack, nodeId, key, viewName);
        this.pushEachEntry(r, nodeId, attrName, key, dom);
      }
    });
    return r;
  }
  renderEachWhen(stack, iterInfo, view, nid) {
    const { seq, filter, loopWith, enricher } = iterInfo.eval(stack);
    const r = [];
    const iterData = loopWith.call(stack.it, seq);
    const it = stack.it;
    this.getSeqInfo(seq)(seq, (key, value, attrName) => {
      if (filter.call(it, key, value, iterData)) {
        const bindings = { key, value };
        const cacheKey = `${nid}-${key}`;
        let cachedNode;
        if (enricher) {
          enricher.call(it, bindings, key, value, iterData);
          cachedNode = this.cache.get2(it, value, cacheKey);
        } else cachedNode = this.cache.get(value, cacheKey);
        if (cachedNode) {
          this.pushEachEntry(r, nid, attrName, key, cachedNode);
          return;
        }
        const newStack = stack.enter(value, bindings, false);
        const dom = this.renderView(view, newStack);
        this.pushEachEntry(r, nid, attrName, key, dom);
        if (enricher) this.cache.set2(it, value, cacheKey, dom);
        else this.cache.set(value, cacheKey, dom);
      }
    });
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
}
const imIndexedIter = (seq, visit) => {
  let i = 0;
  for (const v of seq) visit(i++, v, "si");
};
const imKeyedIter = (seq, visit) => {
  for (const [k, v] of seq.toSeq().entries()) visit(k, v, "sk");
};
const unkIter = () => {};
export const seqInfoByClass = new Map();
