// Post-build smoke tests. Imports every shipped build artifact, does some simple
// usage, and asserts that the build variants of each tier export exactly the same
// names — the regression guard for packaging bugs like the Bun external
// star-re-export bug that broke the .ext extra/dev bundles (immutable exports
// silently dropped / `ReferenceError: immutable is not defined` at load).
//
// The .ext bundles import `immutable`/`chai` as bare externals; `smoke-resolve.mjs`
// maps those to dist/immutable.js / dist/chai.js, mirroring the consumer import map.
//
// Run with `node scripts/smoke.js` (wired into `npm run dist-all`).

import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register("./smoke-resolve.mjs", import.meta.url);

const dist = (f) => new URL(`../dist/${f}`, import.meta.url).href;
const distPath = (f) => fileURLToPath(new URL(`../dist/${f}`, import.meta.url));

let failed = 0;
let passed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Build tiers and their three variants. Each variant of a tier must expose the
// same export surface; the bug was the `.ext` variant diverging from the rest.
const TIERS = {
  base: { regular: "tutuca.js", min: "tutuca.min.js", ext: "tutuca.ext.js" },
  extra: {
    regular: "tutuca-extra.js",
    min: "tutuca-extra.min.js",
    ext: "tutuca-extra.ext.js",
  },
  dev: {
    regular: "tutuca-dev.js",
    min: "tutuca-dev.min.js",
    ext: "tutuca-dev.ext.js",
  },
};

const loaded = {}; // tier -> variant -> module namespace
const names = {}; // tier -> variant -> sorted export-name array

console.log("smoke: loading builds…");
for (const [tier, variants] of Object.entries(TIERS)) {
  loaded[tier] = {};
  names[tier] = {};
  for (const [variant, file] of Object.entries(variants)) {
    try {
      const mod = await import(dist(file));
      loaded[tier][variant] = mod;
      names[tier][variant] = Object.keys(mod).sort();
      check(`load ${file}`, true);
    } catch (e) {
      check(`load ${file}`, false, `${e.constructor.name}: ${e.message}`);
    }
  }
}

// Simple usage against each tier's regular build (representative; immutable comes
// through tutuca's re-export, component/tutuca are the framework entry points).
console.log("smoke: simple usage…");
for (const tier of Object.keys(TIERS)) {
  const m = loaded[tier].regular;
  if (!m) continue;
  check(`${tier}: tutuca() is a function`, typeof m.tutuca === "function");
  check(`${tier}: component() is a function`, typeof m.component === "function");
  check(`${tier}: re-exports immutable Map`, typeof m.Map === "function");
  check(
    `${tier}: immutable Map is usable`,
    (() => {
      try {
        return m.Map({ a: 1 }).get("a") === 1 && m.is(1, 1) === true;
      } catch {
        return false;
      }
    })(),
  );
}

// chai standalone bundle: both jest-style and chai-BDD matchers, plus a real failure.
console.log("smoke: chai bundle…");
try {
  const chai = await import(dist("chai.js"));
  const tryExpect = (fn) => {
    try {
      fn(chai.expect);
      return true;
    } catch {
      return false;
    }
  };
  check(
    "chai: expect(1).toBe(1)",
    tryExpect((e) => e(1).toBe(1)),
  );
  check(
    "chai: expect(1).to.equal(1) (BDD still works)",
    tryExpect((e) => e(1).to.equal(1)),
  );
  check(
    "chai: expect(2).not.toBe(3)",
    tryExpect((e) => e(2).not.toBe(3)),
  );
  check("chai: a wrong assertion throws", !tryExpect((e) => e(1).toBe(2)));
} catch (e) {
  check("load chai.js", false, `${e.constructor.name}: ${e.message}`);
}

// immutable standalone bundle.
console.log("smoke: immutable bundle…");
let immutableNames = [];
try {
  const im = await import(dist("immutable.js"));
  immutableNames = Object.keys(im);
  check("immutable: Map usable", im.Map({ a: 1 }).get("a") === 1);
  check("immutable: is(1,1)", im.is(1, 1) === true);
} catch (e) {
  check("load immutable.js", false, `${e.constructor.name}: ${e.message}`);
}

// Storybook library: external `tutuca` import (resolved by smoke-resolve.mjs)
// loads, and the public surface is present.
console.log("smoke: storybook bundle…");
try {
  const sb = await import(dist("tutuca-storybook.js"));
  check("storybook: mountStorybook() is a function", typeof sb.mountStorybook === "function");
  check("storybook: buildStorybook() is a function", typeof sb.buildStorybook === "function");
  check(
    "storybook: getComponents() returns the 3 engine components",
    typeof sb.getComponents === "function" && sb.getComponents().length === 3,
  );
} catch (e) {
  check("load tutuca-storybook.js", false, `${e.constructor.name}: ${e.message}`);
}

// Export-surface parity: every variant of a tier exports the same names.
console.log("smoke: export parity across variants…");
for (const tier of Object.keys(TIERS)) {
  const ref = names[tier].regular;
  if (!ref) continue;
  for (const variant of ["min", "ext"]) {
    const got = names[tier][variant];
    if (!got) continue;
    const missing = ref.filter((n) => !got.includes(n));
    const extra = got.filter((n) => !ref.includes(n));
    check(
      `${tier}: ${variant} export surface matches regular`,
      missing.length === 0 && extra.length === 0,
      missing.length || extra.length
        ? `missing=[${missing.join(",")}] extra=[${extra.join(",")}]`
        : "",
    );
  }
}

// Tier nesting: base ⊆ extra ⊆ dev (each tier re-exports the previous one).
console.log("smoke: tier nesting…");
if (names.base.regular && names.extra.regular) {
  const missing = names.base.regular.filter((n) => !names.extra.regular.includes(n));
  check("extra ⊇ base", missing.length === 0, missing.length ? `missing=[${missing}]` : "");
}
if (names.extra.regular && names.dev.regular) {
  const missing = names.extra.regular.filter((n) => !names.dev.regular.includes(n));
  check("dev ⊇ extra", missing.length === 0, missing.length ? `missing=[${missing}]` : "");
}

// Drift guard: every export of the vendored immutable bundle must be surfaced by
// the base build. If immutable adds an export and index.js's explicit re-export
// list doesn't include it, this fails — pointing at the list to update.
console.log("smoke: immutable re-export drift guard…");
if (immutableNames.length && names.base.regular) {
  const missing = immutableNames.filter((n) => !names.base.regular.includes(n));
  check(
    "base re-exports the full immutable surface",
    missing.length === 0,
    missing.length ? `index.js is missing: [${missing.join(",")}]` : "",
  );
}

// CLI executes on import, so smoke-test it as a subprocess.
console.log("smoke: cli…");
try {
  const out = execFileSync("node", [distPath("tutuca-cli.js"), "help"], {
    encoding: "utf8",
  });
  check("cli `help` runs and prints usage", /tutuca/.test(out) && /SYNOPSIS/.test(out));
} catch (e) {
  check("cli `help` runs", false, `${e.message}`);
}

console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
