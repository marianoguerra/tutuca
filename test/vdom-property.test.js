import { beforeEach, describe, expect, test } from "bun:test";
import fc from "fast-check";
import { h, VComment, VFragment, VNode, VText, render as vdomRender } from "../src/vdom.js";
import { assertEqualDom, setupJsdom } from "./dom.js";
import {
  applyMutation,
  collectPaths,
  createRng,
  generateMutation,
  generateTree,
} from "./vdom-genutil.js";

let document;
beforeEach(() => {
  document = setupJsdom();
});

describe("property-based tests", () => {
  // Arbitrary for generating valid tag names
  const tagNameArb = fc.constantFrom("div", "span", "p", "section", "article");
  // Arbitrary for generating simple text content
  const textArb = fc.string({ minLength: 0, maxLength: 20 });
  test("render then re-render produces equivalent DOM", () => {
    fc.assert(
      fc.property(tagNameArb, textArb, textArb, (tag, text1, text2) => {
        const vdom1 = h(tag, null, text1);
        const vdom2 = h(tag, null, text2);
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        vdomRender(vdom1, c1, { document });
        vdomRender(vdom2, c1, { document });
        vdomRender(vdom2, c2, { document });
        return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
      }),
      { numRuns: 100 },
    );
  });
  test("identical trees preserve DOM reference", () => {
    fc.assert(
      fc.property(tagNameArb, textArb, (tag, text) => {
        const vdom1 = h(tag, null, text);
        const vdom2 = h(tag, null, text);
        const container = document.createElement("div");
        vdomRender(vdom1, container, { document });
        const ref = container.childNodes[0];
        vdomRender(vdom2, container, { document });
        return container.childNodes[0] === ref;
      }),
      { numRuns: 100 },
    );
  });
  test("keyed children maintain identity after reorder", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 5 }), {
          minLength: 2,
          maxLength: 8,
        }),
        (keys) => {
          // Ensure unique keys
          const uniqueKeys = [...new Set(keys)];
          if (uniqueKeys.length < 2) return true;
          const leftNode = h(
            "div",
            null,
            uniqueKeys.map((k) => h("div", { key: k, id: k }, k)),
          );
          // Shuffle keys
          const shuffledKeys = [...uniqueKeys].sort(() => Math.random() - 0.5);
          const rightNode = h(
            "div",
            null,
            shuffledKeys.map((k) => h("div", { key: k, id: k }, k)),
          );
          const container = document.createElement("div");
          vdomRender(leftNode, container, { document });
          vdomRender(rightNode, container, { document });
          const newRoot = container.childNodes[0];
          // Check that all children are in correct order
          for (let i = 0; i < shuffledKeys.length; i++) {
            const child = newRoot.childNodes[i];
            if (child.id !== shuffledKeys[i]) return false;
          }
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
  test("adding and removing children works correctly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (count1, count2) => {
          const children1 = Array.from({ length: count1 }, (_, i) =>
            h("span", { key: `k${i}` }, `child${i}`),
          );
          const children2 = Array.from({ length: count2 }, (_, i) =>
            h("span", { key: `k${i}` }, `child${i}`),
          );
          const leftNode = h("div", null, children1);
          const rightNode = h("div", null, children2);
          const c1 = document.createElement("div");
          const c2 = document.createElement("div");
          vdomRender(leftNode, c1, { document });
          vdomRender(rightNode, c1, { document });
          vdomRender(rightNode, c2, { document });
          return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        },
      ),
      { numRuns: 50 },
    );
  });
});
describe("property-based: random trees and mutations", () => {
  // ---------------------------------------------------------------------------
  // Arbitraries for generating VNode trees
  // ---------------------------------------------------------------------------
  const tagArb = fc.constantFrom("div", "span", "p", "section", "ul", "li", "article");
  const textArb = fc.string({ minLength: 0, maxLength: 15 });
  const keyArb = fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
    nil: undefined,
  });
  // Generate a VText node
  const vtextArb = textArb.map((text) => new VText(text));
  // Generate a VComment node
  const vcommentArb = textArb.map((text) => new VComment(text));
  // Generate a leaf VNode (no children)
  const leafVNodeArb = fc.tuple(tagArb, keyArb, textArb).map(([tag, key, text]) => {
    const props = key !== undefined ? { key } : null;
    return h(tag, props, text);
  });
  // Generate a VFragment child (flattened at construction time by h())
  const vfragmentChildArb = fc
    .array(fc.oneof(vtextArb, vcommentArb, leafVNodeArb), {
      minLength: 1,
      maxLength: 3,
    })
    .map((childs) => new VFragment(childs));
  // Recursive arbitrary for VNode trees (including VComment and VFragment children)
  // VFragment children are flattened at construction time by h(), so the resulting
  // trees are structurally flat — but this exercises the flattening code path.
  const vnodeTreeArb = fc.letrec((tie) => ({
    // Leaf nodes: VText, VComment, or leaf VNode
    leaf: fc.oneof(vtextArb, vcommentArb, leafVNodeArb),
    // Full tree node
    tree: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      leafVNodeArb,
      fc
        .tuple(
          tagArb,
          keyArb,
          fc.array(fc.oneof(tie("tree"), vtextArb, vcommentArb, vfragmentChildArb), {
            minLength: 0,
            maxLength: 4,
          }),
        )
        .map(([tag, key, children]) => {
          const props = key !== undefined ? { key } : null;
          return h(tag, props, children);
        }),
    ),
  })).tree;
  // Helper to apply mutation without requiring rng (uses Math.random for shuffle)
  function applyMutationLocal(root, mutation) {
    const rng = () => Math.random();
    return applyMutation(root, mutation, rng);
  }
  // Arbitrary for mutations given a tree
  function mutationArb(tree) {
    const paths = collectPaths(tree);
    const pathArb = fc.constantFrom(...paths);
    return fc.oneof(
      // Change text
      fc.tuple(pathArb, textArb).map(([path, newText]) => ({
        type: "changeText",
        path,
        newText,
      })),
      // Change tag
      fc.tuple(pathArb, tagArb).map(([path, newTag]) => ({
        type: "changeTag",
        path,
        newTag,
      })),
      // Add child
      fc
        .tuple(pathArb, fc.oneof(leafVNodeArb, vtextArb, vcommentArb), fc.nat({ max: 10 }))
        .map(([path, child, index]) => ({
          type: "addChild",
          path,
          child,
          index,
        })),
      // Remove child
      fc.tuple(pathArb, fc.nat({ max: 10 })).map(([path, index]) => ({
        type: "removeChild",
        path,
        index,
      })),
      // Replace child
      fc
        .tuple(pathArb, fc.nat({ max: 10 }), fc.oneof(leafVNodeArb, vtextArb, vcommentArb))
        .map(([path, index, newChild]) => ({
          type: "replaceChild",
          path,
          index,
          newChild,
        })),
      // Shuffle children
      pathArb.map((path) => ({
        type: "shuffleChildren",
        path,
      })),
      // Change attribute
      fc
        .tuple(
          pathArb,
          fc.constantFrom("className", "id", "title", "data-test"),
          fc.option(fc.string({ minLength: 1, maxLength: 10 }), {
            nil: undefined,
          }),
        )
        .map(([path, attr, value]) => ({
          type: "changeAttr",
          path,
          attr,
          value,
        })),
    );
  }
  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------
  test("render+re-render on random tree produces equivalent DOM", () => {
    fc.assert(
      fc.property(vnodeTreeArb, vnodeTreeArb, (tree1, tree2) => {
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        vdomRender(tree1, c1, { document });
        vdomRender(tree2, c1, { document });
        vdomRender(tree2, c2, { document });
        return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
      }),
      { numRuns: 100 },
    );
  });
  test("single mutation: render+re-render produces correct result", () => {
    fc.assert(
      fc.property(
        vnodeTreeArb.chain((tree) => fc.tuple(fc.constant(tree), mutationArb(tree))),
        ([originalTree, mutation]) => {
          const mutatedTree = applyMutationLocal(originalTree, mutation);
          const c1 = document.createElement("div");
          const c2 = document.createElement("div");
          vdomRender(originalTree, c1, { document });
          vdomRender(mutatedTree, c1, { document });
          vdomRender(mutatedTree, c2, { document });
          return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        },
      ),
      { numRuns: 200 },
    );
  });
  test("multiple mutations: render+re-render produces correct result", () => {
    fc.assert(
      fc.property(
        vnodeTreeArb.chain((tree) =>
          fc.tuple(fc.constant(tree), fc.array(mutationArb(tree), { minLength: 1, maxLength: 5 })),
        ),
        ([originalTree, mutations]) => {
          // Apply all mutations sequentially
          let mutatedTree = originalTree;
          for (const mutation of mutations) {
            mutatedTree = applyMutationLocal(mutatedTree, mutation);
          }
          const c1 = document.createElement("div");
          const c2 = document.createElement("div");
          vdomRender(originalTree, c1, { document });
          vdomRender(mutatedTree, c1, { document });
          vdomRender(mutatedTree, c2, { document });
          return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
        },
      ),
      { numRuns: 100 },
    );
  });
  test("incremental re-rendering: applying step by step", () => {
    fc.assert(
      fc.property(
        vnodeTreeArb.chain((tree) =>
          fc.tuple(fc.constant(tree), fc.array(mutationArb(tree), { minLength: 2, maxLength: 4 })),
        ),
        ([originalTree, mutations]) => {
          let currentTree = originalTree;
          const container = document.createElement("div");
          vdomRender(currentTree, container, { document });
          // Apply mutations one at a time
          for (const mutation of mutations) {
            const nextTree = applyMutationLocal(currentTree, mutation);
            vdomRender(nextTree, container, { document });
            const expected = document.createElement("div");
            vdomRender(nextTree, expected, { document });
            if (!assertEqualDom(container.childNodes[0], expected.childNodes[0])) {
              return false;
            }
            currentTree = nextTree;
          }
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
  test("keyed children: random insertions and deletions", () => {
    // Generate list of unique keys
    const uniqueKeysArb = fc
      .array(fc.string({ minLength: 1, maxLength: 5 }), {
        minLength: 3,
        maxLength: 10,
      })
      .map((keys) => [...new Set(keys)])
      .filter((keys) => keys.length >= 3);
    fc.assert(
      fc.property(uniqueKeysArb, fc.integer({ min: 0, max: 100 }), (keys, seed) => {
        // Create initial tree with keyed children
        const initialChildren = keys.map((k) => h("div", { key: k, id: k }, k));
        const initialTree = h("div", null, initialChildren);
        // Create mutations: shuffle, remove some, add new ones
        const rng = createRng(seed);
        const shuffled = [...keys].sort(() => rng() - 0.5);
        const kept = shuffled.slice(0, Math.max(1, Math.floor(shuffled.length * 0.7)));
        const newKeys = [`new-${seed}-1`, `new-${seed}-2`];
        const finalKeys = [...kept, ...newKeys].sort(() => rng() - 0.5);
        const finalChildren = finalKeys.map((k) => h("div", { key: k, id: k }, k));
        const finalTree = h("div", null, finalChildren);
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        vdomRender(initialTree, c1, { document });
        vdomRender(finalTree, c1, { document });
        vdomRender(finalTree, c2, { document });
        // Verify structure
        if (!assertEqualDom(c1.childNodes[0], c2.childNodes[0])) {
          return false;
        }
        // Verify key order
        const newRoot = c1.childNodes[0];
        for (let i = 0; i < finalKeys.length; i++) {
          const child = newRoot.childNodes[i];
          if (child.id !== finalKeys[i]) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
  test("VFragment root: render + re-render produces correct DOM", () => {
    fc.assert(
      fc.property(vnodeTreeArb, vnodeTreeArb, (tree1, tree2) => {
        const container1 = document.createElement("div");
        const container2 = document.createElement("div");
        // Wrap children in VFragment roots
        const frag1 = new VFragment(tree1.childs);
        const frag2 = new VFragment(tree2.childs);
        // Render then re-render
        vdomRender(frag1, container1, { document });
        vdomRender(frag2, container1, { document });
        // Fresh render for comparison
        vdomRender(frag2, container2, { document });
        return container1.innerHTML === container2.innerHTML;
      }),
      { numRuns: 100 },
    );
  });
  test("VFragment root: incremental re-renders produce correct DOM", () => {
    fc.assert(
      fc.property(
        vnodeTreeArb.chain((tree) =>
          fc.tuple(fc.constant(tree), fc.array(mutationArb(tree), { minLength: 2, maxLength: 4 })),
        ),
        ([originalTree, mutations]) => {
          const container = document.createElement("div");
          let currentTree = originalTree;
          vdomRender(new VFragment(currentTree.childs), container, { document });
          for (const mutation of mutations) {
            const nextTree = applyMutationLocal(currentTree, mutation);
            vdomRender(new VFragment(nextTree.childs), container, { document });
            const expected = document.createElement("div");
            vdomRender(new VFragment(nextTree.childs), expected, { document });
            if (container.innerHTML !== expected.innerHTML) return false;
            currentTree = nextTree;
          }
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
  test("stress test: deeply nested mutations", () => {
    // Generate deeper trees (including VComment)
    const deepTreeArb = fc.letrec((tie) => ({
      leaf: fc.oneof(vtextArb, vcommentArb, leafVNodeArb),
      tree: fc.oneof(
        { depthSize: "medium" },
        leafVNodeArb,
        fc
          .tuple(
            tagArb,
            keyArb,
            fc.array(fc.oneof(tie("tree"), vtextArb, vcommentArb), {
              minLength: 1,
              maxLength: 3,
            }),
          )
          .map(([tag, key, children]) => {
            const props = key !== undefined ? { key } : null;
            return h(tag, props, children);
          }),
      ),
    })).tree;
    fc.assert(
      fc.property(deepTreeArb, deepTreeArb, (tree1, tree2) => {
        const c1 = document.createElement("div");
        const c2 = document.createElement("div");
        vdomRender(tree1, c1, { document });
        vdomRender(tree2, c1, { document });
        vdomRender(tree2, c2, { document });
        return assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
      }),
      { numRuns: 50 },
    );
  });
});
describe("seed-based regression tests", () => {
  /**
   * Test a specific seed from the playground.
   * This reproduces the exact behavior of the playground's generate() function.
   */
  function testSeed(seed, mutationCount = 3) {
    const rng = createRng(seed);
    const originalTree = generateTree(rng);
    const mutations = [];
    for (let i = 0; i < mutationCount; i++) {
      mutations.push(generateMutation(rng, originalTree));
    }
    let mutatedTree = originalTree;
    const mutationRng = createRng(seed + 1000);
    for (const mutation of mutations) {
      mutatedTree = applyMutation(mutatedTree, mutation, mutationRng);
    }
    const c1 = document.createElement("div");
    const c2 = document.createElement("div");
    vdomRender(originalTree, c1, { document });
    vdomRender(mutatedTree, c1, { document });
    vdomRender(mutatedTree, c2, { document });
    const isMatch = assertEqualDom(c1.childNodes[0], c2.childNodes[0]);
    return { isMatch, originalTree, mutatedTree, mutations };
  }
  test("seed 1690 - duplicate keys produce correct DOM", () => {
    const result = testSeed(1690, 3);
    expect(result.isMatch).toBe(true);
  });
  test("seed 161406 - render+re-render produces correct result", () => {
    const result = testSeed(161406, 3);
    expect(result.isMatch).toBe(true);
  });
  test("seed -1033623610 - duplicate keys with removeChild mutation", () => {
    const originalTree = new VNode("DIV", {}, [
      new VNode("DIV", {}, [], "key", null),
      new VNode("DIV", {}, [new VText("")], undefined, null),
      new VNode("SECTION", {}, [new VText("")], "key", null),
    ]);
    const mutatedTree = new VNode("DIV", {}, [
      new VNode("DIV", {}, [], "key", null),
      new VNode("DIV", {}, [new VText("")], undefined, null),
      new VNode("SECTION", {}, [], "key", null),
    ]);
    const c1 = document.createElement("div");
    const c2 = document.createElement("div");
    vdomRender(originalTree, c1, { document });
    vdomRender(mutatedTree, c1, { document });
    vdomRender(mutatedTree, c2, { document });
    expect(assertEqualDom(c1.childNodes[0], c2.childNodes[0])).toBe(true);
  });
  test("mixed unique and duplicate keys", () => {
    const originalTree = new VNode("DIV", {}, [
      new VNode("DIV", {}, [], "unique", null),
      new VNode("DIV", {}, [], "dup", null),
      new VNode("SECTION", {}, [new VText("text")], "dup", null),
    ]);
    const mutatedTree = new VNode("DIV", {}, [
      new VNode("DIV", {}, [], "unique", null),
      new VNode("DIV", {}, [], "dup", null),
      new VNode("SECTION", {}, [], "dup", null),
    ]);
    const c1 = document.createElement("div");
    const c2 = document.createElement("div");
    vdomRender(originalTree, c1, { document });
    vdomRender(mutatedTree, c1, { document });
    vdomRender(mutatedTree, c2, { document });
    expect(assertEqualDom(c1.childNodes[0], c2.childNodes[0])).toBe(true);
  });
  test("duplicate keys with unique key reorder", () => {
    const originalTree = new VNode("DIV", {}, [
      new VNode("A", {}, [], "unique", null),
      new VNode("B", {}, [new VText("b1")], "dup", null),
      new VNode("C", {}, [new VText("c1")], "dup", null),
    ]);
    const mutatedTree = new VNode("DIV", {}, [
      new VNode("B", {}, [new VText("b2")], "dup", null),
      new VNode("C", {}, [new VText("c2")], "dup", null),
      new VNode("A", {}, [], "unique", null),
    ]);
    const c1 = document.createElement("div");
    const c2 = document.createElement("div");
    vdomRender(originalTree, c1, { document });
    vdomRender(mutatedTree, c1, { document });
    vdomRender(mutatedTree, c2, { document });
    expect(assertEqualDom(c1.childNodes[0], c2.childNodes[0])).toBe(true);
  });
});
