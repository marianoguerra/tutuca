// Entry for the `tutuca/chai` browser/ext bundle (dist/chai.js): re-exports
// chai with tutuca's jest-style matchers applied, so client-side test authors
// get `expect(x).toBe(1)` parity with the `tutuca test` CLI runner.
import * as chai from "chai";
import { jestMatchers } from "../src/chai-jest.js";

chai.use(jestMatchers);

// Re-export chai's public surface. In the .ext dev build this is an *inner* module
// (dev.js pulls it in via `import { expect }`) with `chai` kept external, so the star
// has to survive being lowered through the bundler; `scripts/smoke.js` loads the
// bundle and checks `expect` is actually bound.
export * from "chai";
