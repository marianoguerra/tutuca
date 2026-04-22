import {
  applyMutation,
  createRng,
  generateMutation,
  generateTree,
} from "../../test/vdom-genutil.js";
import { VFragment, render as vdomRender, unmount } from "../../src/vdom.js";
import { StresstestResult } from "./results.js";

function compareDom(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === 3 || a.nodeType === 8) return a.data === b.data;
  if (a.nodeType === 1) {
    if (a.tagName !== b.tagName) return false;
    if (a.attributes.length !== b.attributes.length) return false;
    for (let i = 0; i < a.attributes.length; i++) {
      const attr = a.attributes[i];
      if (b.getAttribute(attr.name) !== attr.value) return false;
    }
    if (a.childNodes.length !== b.childNodes.length) return false;
    for (let i = 0; i < a.childNodes.length; i++) {
      if (!compareDom(a.childNodes[i], b.childNodes[i])) return false;
    }
  }
  return true;
}

function serializeTree(node) {
  if (node.nodeType === 3) return { type: "VText", text: node.text };
  if (node.nodeType === 8) return { type: "VComment", text: node.text };
  if (node.nodeType === 1) {
    return {
      type: "VNode",
      tag: node.tag,
      key: node.key,
      attrs: node.attrs,
      childs: node.childs.map(serializeTree),
    };
  }
  return { type: "unknown" };
}

export function stresstest({ iterations = 100000, seed = null, onProgress = null, makeDocument }) {
  const baseSeed = seed ?? Math.floor(Math.random() * 1000000);
  const JSDOM_REFRESH_INTERVAL = 5000;
  let document = makeDocument();
  const startTime = Date.now();
  let passed = 0;

  for (let i = 0; i < iterations; i++) {
    if (i > 0 && i % JSDOM_REFRESH_INTERVAL === 0) {
      document = makeDocument();
      if (typeof Bun !== "undefined") Bun.gc(true);
      else if (typeof globalThis.gc === "function") globalThis.gc();
    }

    const s = baseSeed + i;
    const rng = createRng(s);
    const originalTree = generateTree(rng);
    const mutationCount = Math.floor(rng() * 5) + 1;
    const mutations = [];
    for (let j = 0; j < mutationCount; j++) {
      mutations.push(generateMutation(rng, originalTree));
    }

    let mutatedTree = originalTree;
    const mutationRng = createRng(s + 1000);
    for (const mutation of mutations) {
      mutatedTree = applyMutation(mutatedTree, mutation, mutationRng);
    }

    const container = document.createElement("div");
    const opts = { document };
    vdomRender(originalTree, container, opts);
    vdomRender(mutatedTree, container, opts);

    const expected = document.createElement("div");
    vdomRender(mutatedTree, expected, opts);

    if (!compareDom(container, expected)) {
      return new StresstestResult({
        iterations,
        seed: baseSeed,
        passed,
        failedAt: i + 1,
        failureDetails: {
          seed: s,
          mutationCount,
          originalTree: serializeTree(originalTree),
          mutatedTree: serializeTree(mutatedTree),
          mutations,
          expectedHtml: expected.innerHTML,
          actualHtml: container.innerHTML,
        },
        durationMs: Date.now() - startTime,
      });
    }

    if (rng() < 0.2) {
      const c1 = document.createElement("div");
      const c2 = document.createElement("div");
      const f1 = new VFragment(originalTree.childs);
      const f2 = new VFragment(mutatedTree.childs);
      vdomRender(f1, c1, opts);
      vdomRender(f2, c1, opts);
      vdomRender(f2, c2, opts);
      if (!compareDom(c1, c2)) {
        return new StresstestResult({
          iterations,
          seed: baseSeed,
          passed,
          failedAt: i + 1,
          failureDetails: { seed: s, kind: "vfragment-render-mismatch" },
          durationMs: Date.now() - startTime,
        });
      }
      unmount(c1);
      unmount(c2);
    }

    passed++;
    if (onProgress && (i + 1) % 10000 === 0) {
      onProgress({ i: i + 1, total: iterations, elapsedMs: Date.now() - startTime });
    }
  }

  return new StresstestResult({
    iterations,
    seed: baseSeed,
    passed,
    failedAt: null,
    failureDetails: null,
    durationMs: Date.now() - startTime,
  });
}
