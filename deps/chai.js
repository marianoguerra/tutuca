// Entry for the `tutuca/chai` browser/ext bundle (dist/chai.js): re-exports
// chai with tutuca's jest-style matchers applied, so client-side test authors
// get `expect(x).toBe(1)` parity with the `tutuca test` CLI runner.
import * as chai from "chai";
import { jestMatchers } from "../src/chai-jest.js";

chai.use(jestMatchers);

// Re-export chai's public surface. Enumerated explicitly on purpose — do NOT
// switch to `export * from "chai"`. When this module is bundled as an *inner*
// module (the .ext dev build pulls it in via dev.js's `import { expect }`) with
// `chai` kept external, Bun lowers a star re-export of the external to a broken
// `__reExport(ns, chai2)` call whose `chai2` namespace is never bound — the .ext
// bundle then throws `ReferenceError: chai2 is not defined` at load. Explicit
// named re-exports bundle correctly in every build. Same Bun bug index.js
// guards against for immutable; `scripts/smoke.js` guards this list for drift.
export {
  Assertion,
  AssertionError,
  Should,
  assert,
  config,
  expect,
  should,
  use,
  util,
} from "chai";
