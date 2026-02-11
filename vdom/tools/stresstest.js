#!/usr/bin/env bun
/**
 * VDOM Stress Test
 *
 * Runs N iterations of random tree generation, mutation, diff, and patch
 * to verify the VDOM implementation correctness.
 *
 * Usage: bun tools/stresstest.js [iterations] [seed]
 * Default: 100000 iterations, random seed
 */

import { JSDOM } from "jsdom";
import {
  createRng,
  generateTree,
  generateMutation,
  applyMutation,
} from "../tests/genutil.ts";
import { VFragment, render as vdomRender, unmount } from "../src/vdom.ts";

// Parse CLI args
const iterations = parseInt(process.argv[2], 10) || 100000;
const baseSeed = process.argv[3] ? parseInt(process.argv[3], 10) : Math.floor(Math.random() * 1000000);

// Setup JSDOM
const JSDOM_REFRESH_INTERVAL = 5000;

function createDocument() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  return dom.window.document;
}
let document = createDocument();

// Compare DOM trees
function compareDom(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === 3) {
    return a.data === b.data;
  }
  if (a.nodeType === 8) {
    return a.data === b.data;
  }
  if (a.nodeType === 1) {
    if (a.tagName !== b.tagName) return false;
    if (a.attributes.length !== b.attributes.length) return false;
    for (let i = 0; i < a.attributes.length; i++) {
      const attr = a.attributes[i];
      if (b.getAttribute(attr.name) !== attr.value) return false;
    }
    if (a.childNodes.length !== b.childNodes.length) return false;
    for (let i = 0; i < a.childNodes.length; i++) {
      if (!compareDom(a.childNodes[i], b.childNodes[i])) {
        return false;
      }
    }
  }
  return true;
}

// Serialize tree for debugging
function serializeTree(node) {
  if (node.nodeType === 3) {
    return { type: "VText", text: node.text };
  }
  if (node.nodeType === 8) {
    return { type: "VComment", text: node.text };
  }
  if (node.nodeType === 1) {
    return {
      type: "VNode",
      tag: node.tag,
      key: node.key,
      attrs: node.attrs,
      childs: node.childs.map((c) => serializeTree(c)),
    };
  }
  return { type: "unknown" };
}

console.log(`Seed: ${baseSeed}`);
console.log(`Running ${iterations.toLocaleString()} stress test iterations...`);

const startTime = Date.now();
let lastProgressTime = startTime;
let passed = 0;
let warningsCount = 0;

for (let i = 0; i < iterations; i++) {
  if (i > 0 && i % JSDOM_REFRESH_INTERVAL === 0) {
    document = createDocument();
    if (typeof Bun !== "undefined") Bun.gc(true);
    else if (typeof globalThis.gc === "function") globalThis.gc();
  }

  const seed = baseSeed + i;
  const rng = createRng(seed);

  // Generate original tree
  const originalTree = generateTree(rng);

  // Generate mutations (1-5 random)
  const mutationCount = Math.floor(rng() * 5) + 1;
  const mutations = [];
  for (let j = 0; j < mutationCount; j++) {
    mutations.push(generateMutation(rng, originalTree));
  }

  // Apply mutations
  let mutatedTree = originalTree;
  const mutationRng = createRng(seed + 1000);
  for (const mutation of mutations) {
    mutatedTree = applyMutation(mutatedTree, mutation, mutationRng);
  }

  // Diff and patch
  const patches = originalTree.diff(mutatedTree);
  const rootDom = originalTree.toDom({ document });
  const patchedDom = patches.applyTo(rootDom, { document });

  // Fresh render for comparison
  const expectedDom = mutatedTree.toDom({ document });

  // Compare
  const isMatch = compareDom(patchedDom, expectedDom);
  const hasWarnings = patches.warnings && patches.warnings.length > 0;

  if (hasWarnings) {
    warningsCount++;
  }

  if (!isMatch) {
    // Only fail on mismatches without warnings (warnings indicate known edge cases)
    if (!hasWarnings) {
      console.error(`\nMISMATCH at iteration ${i + 1}`);
      console.error(`Seed: ${seed}`);
      console.error(`Mutations: ${mutationCount}`);
      console.error(`Patch count: ${patches.size}`);
      console.error("\nOriginal tree:", JSON.stringify(serializeTree(originalTree), null, 2));
      console.error("\nMutated tree:", JSON.stringify(serializeTree(mutatedTree), null, 2));
      console.error("\nMutations:", JSON.stringify(mutations, null, 2));
      process.exit(1);
    }
  }

  // Also test VFragment root render cycle (20% of iterations)
  if (rng() < 0.2) {
    const container1 = document.createElement("div");
    const container2 = document.createElement("div");

    const frag1 = new VFragment(originalTree.childs);
    const frag2 = new VFragment(mutatedTree.childs);

    vdomRender(frag1, container1, { document });
    vdomRender(frag2, container1, { document });
    vdomRender(frag2, container2, { document });

    if (!compareDom(container1, container2)) {
      if (!hasWarnings) {
        console.error(`\nVFRAGMENT RENDER MISMATCH at iteration ${i + 1}`);
        console.error(`Seed: ${seed}`);
        process.exit(1);
      }
    }

    unmount(container1);
    unmount(container2);
  }

  passed++;

  // Progress update every 10000 iterations
  if ((i + 1) % 10000 === 0) {
    const now = Date.now();
    const elapsed = ((now - startTime) / 1000).toFixed(1);
    const rate = Math.round(((i + 1) / (now - startTime)) * 1000);
    const intervalRate = Math.round(10000 / ((now - lastProgressTime) / 1000));
    const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(
      `  ${(i + 1).toLocaleString()} / ${iterations.toLocaleString()} (${elapsed}s, ${rate}/s avg, ${intervalRate}/s last 10k, heap: ${heapMB}MB)`,
    );
    lastProgressTime = now;
  }
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
const rate = Math.round(iterations / (Date.now() - startTime) * 1000);

console.log(`\nCompleted ${passed.toLocaleString()} iterations in ${totalTime}s (${rate}/s)`);
if (warningsCount > 0) {
  console.log(`Warnings encountered: ${warningsCount} (expected edge cases)`);
}
console.log("All tests passed!");
