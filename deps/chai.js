// Entry for the `tutuca/chai` browser/ext bundle (dist/chai.js): re-exports
// chai with tutuca's jest-style matchers applied, so client-side test authors
// get `expect(x).toBe(1)` parity with the `tutuca test` CLI runner.
import * as chai from "chai";
import { jestMatchers } from "../src/chai-jest.js";

chai.use(jestMatchers);

export * from "chai";
