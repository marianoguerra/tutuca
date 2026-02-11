import { isIndexed, isKeyed } from "../deps/immutable.js";
import { NullDomCache, WeakMapDomCache } from "./cache.js";

export const DATASET_ATTRS = ["nid", "cid", "eid", "vid", "si", "sk"];
export class Renderer {
  constructor(comps, h, fragment, comment, renderFn, getSeqInfo, cache) {
    this.comps = comps;
    this.h = h;
    this.fragment = fragment;
    this.comment = comment;
    this.renderFn = renderFn;
    this.getSeqInfo = getSeqInfo ?? basicGetSeqInfo;
    this.cache = cache ?? new WeakMapDomCache();
  }
  setNullCache() {
    this.cache = new NullDomCache();
  }
  renderToDOM(stack, val) {
    const rootNode = document.createElement("div");
    this.renderFn(this.h("div", null, [this.renderRoot(stack, val)]), rootNode);
    return rootNode.childNodes[0];
  }
  renderToString(stack, val, cleanAttrs = true) {
    const dom = this.renderToDOM(stack, val, this.renderFn);
    if (cleanAttrs) {
      const nodes = dom.querySelectorAll("[data-nid],[data-cid],[data-eid]");
      for (const { dataset } of nodes) {
        for (const name of DATASET_ATTRS) {
          delete dataset[name];
        }
      }
    }
    return dom.innerHTML;
  }
  renderRoot(stack, val, viewName = null) {
    const c = this.comps.getCompFor(val);
    const nid = c.getView(viewName).anode.nodeId ?? null;
    return c ? this._rValComp(stack, val, c, nid, "ROOT", viewName) : null;
  }
  renderIt(stack, nodeId, key, viewName) {
    const c = this.comps.getCompFor(stack.it);
    return c ? this._rValComp(stack, stack.it, c, nodeId, key, viewName) : null;
  }
  _rValComp(stack, val, comp, nid, key, viewName) {
    const cacheKey = `${viewName ?? stack.viewsId ?? ""}${nid}-${key}`;
    const cachedNode = this.cache.get(val, cacheKey);
    if (cachedNode) {
      return cachedNode;
    }
    const view = viewName
      ? comp.getView(viewName)
      : stack.lookupBestView(comp.views, "main");
    const meta = this.renderMetadata("Comp", { nid });
    const dom = this.renderFragment([meta, view.render(stack, this)]);
    this.cache.set(val, cacheKey, dom);
    return dom;
  }
  renderEach(stack, iterInfo, nodeId, viewName) {
    const { seq, filter, loopWith } = iterInfo.eval(stack);
    const [attrName, gen] = this.getSeqInfo(seq);
    const r = [];
    const iterData = loopWith.call(stack.it, seq);
    for (const [key, value] of gen(seq)) {
      if (filter.call(stack.it, key, value, iterData)) {
        const newStack = stack.enter(value, { key }, true);
        const dom = this.renderIt(newStack, nodeId, key, viewName);
        r.push(this.renderMetadata("Each", { nid: nodeId, [attrName]: key }));
        r.push(dom);
      }
    }
    return r;
  }
  renderEachWhen(stack, iterInfo, node, nid) {
    const { seq, filter, loopWith, enricher } = iterInfo.eval(stack);
    const [attrName, gen] = this.getSeqInfo(seq);
    const hasEnricher = !!enricher;
    const r = [];
    const iterData = loopWith.call(stack.it, seq);
    for (const [key, value] of gen(seq)) {
      if (filter.call(stack.it, key, value, iterData)) {
        const bindings = { key, value };
        const cacheKey = `${nid}-${key}`;
        let cachedNode;
        if (hasEnricher) {
          enricher.call(stack.it, bindings, key, value, iterData);
          cachedNode = this.cache.get2(stack.it, value, cacheKey);
        } else {
          cachedNode = this.cache.get(value, cacheKey);
        }
        if (cachedNode) {
          r.push(this.renderMetadata("Each", { nid, [attrName]: key }));
          r.push(cachedNode);
          continue;
        }
        const newStack = stack.enter(value, bindings, false);
        const dom = node.render(newStack, this);
        r.push(this.renderMetadata("Each", { nid, [attrName]: key }));
        if (hasEnricher) {
          this.cache.set2(stack.it, value, cacheKey, dom);
        } else {
          this.cache.set(value, cacheKey, dom);
        }
        r.push(dom);
      }
    }
    return r;
  }
  renderText(text) {
    return text;
  }
  renderMetadata(type, info) {
    info.$ = type; // MUT
    return this.renderComment(`§${JSON.stringify(info)}§`);
  }

  renderComment(text) {
    return this.comment(text); // TODO: rename comment to renderComment
  }
  renderEmpty(_text) {
    return null;
  }
  renderTag(tagName, attrs, childs) {
    return this.h(tagName, attrs, childs);
  }
  renderFragment(childs) {
    return this.fragment(childs);
  }
}
function* imIndexedEntries(seq) {
  let i = 0;
  for (const v of seq) yield [i++, v];
}
function* imKeyedEntries(obj) {
  for (const [key, value] of obj.toSeq().entries()) yield [key, value];
}
export const seqInfoByClass = new Map();
const idxInfo = ["si", imIndexedEntries];
const keyInfo = ["sk", imKeyedEntries];
const unkInfo = ["si", function* nullEntries(_obj) {}];
function basicGetSeqInfo(seq) {
  return isIndexed(seq)
    ? idxInfo
    : isKeyed(seq)
      ? keyInfo
      : (seqInfoByClass.get(seq?.constructor) ?? unkInfo);
}
