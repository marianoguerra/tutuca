// Jest-style matchers as a chai plugin. Registers flat matcher names
// (`toBe`, `toEqual`, …) onto chai's own assertion engine so test authors can
// write `expect(x).toBe(1)` instead of `expect(x).to.equal(1)`. Both styles
// coexist; chai's `.not` getter flips the negate flag that `this.assert`
// already honors, so `expect(x).not.toBe(y)` works with no extra code.
//
// Imports nothing: it receives `chai` and `utils` per the chai plugin
// contract, so the same module is reused by the CLI runner and the browser
// `tutuca/chai` bundle.
//
// Out of scope (no mocking layer / not deep-equal-by-structure-only): asymmetric
// matchers (`expect.objectContaining`, `expect.any`), `toMatchSnapshot`,
// `toMatchObject`, and mock matchers (`toHaveBeenCalled…`).

// Supported matcher names, surfaced for docs/tooling (docs-single-source).
export const JEST_MATCHERS = [
  "toBe",
  "toEqual",
  "toBeTruthy",
  "toBeFalsy",
  "toBeNull",
  "toBeUndefined",
  "toBeDefined",
  "toBeNaN",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toBeCloseTo",
  "toContain",
  "toHaveLength",
  "toMatch",
  "toHaveProperty",
  "toBeInstanceOf",
  "toThrow",
];

export function jestMatchers(chai, utils) {
  const A = chai.Assertion;
  const m = (name, fn) => A.addMethod(name, fn);

  m("toBe", function (expected) {
    this.assert(
      Object.is(this._obj, expected),
      "expected #{this} to be #{exp}",
      "expected #{this} not to be #{exp}",
      expected,
      this._obj,
    );
  });

  m("toEqual", function (expected) {
    this.assert(
      utils.eql(this._obj, expected),
      "expected #{this} to deeply equal #{exp}",
      "expected #{this} not to deeply equal #{exp}",
      expected,
      this._obj,
      true,
    );
  });

  m("toBeTruthy", function () {
    this.assert(
      Boolean(this._obj),
      "expected #{this} to be truthy",
      "expected #{this} not to be truthy",
    );
  });

  m("toBeFalsy", function () {
    this.assert(
      !this._obj,
      "expected #{this} to be falsy",
      "expected #{this} not to be falsy",
    );
  });

  m("toBeNull", function () {
    this.assert(
      this._obj === null,
      "expected #{this} to be null",
      "expected #{this} not to be null",
    );
  });

  m("toBeUndefined", function () {
    this.assert(
      this._obj === undefined,
      "expected #{this} to be undefined",
      "expected #{this} not to be undefined",
    );
  });

  m("toBeDefined", function () {
    this.assert(
      this._obj !== undefined,
      "expected #{this} to be defined",
      "expected #{this} to be undefined",
    );
  });

  m("toBeNaN", function () {
    this.assert(
      Number.isNaN(this._obj),
      "expected #{this} to be NaN",
      "expected #{this} not to be NaN",
    );
  });

  const compare = (name, op, word) =>
    m(name, function (expected) {
      this.assert(
        op(this._obj, expected),
        `expected #{this} to be ${word} #{exp}`,
        `expected #{this} not to be ${word} #{exp}`,
        expected,
      );
    });
  compare("toBeGreaterThan", (a, b) => a > b, "greater than");
  compare("toBeGreaterThanOrEqual", (a, b) => a >= b, "greater than or equal to");
  compare("toBeLessThan", (a, b) => a < b, "less than");
  compare("toBeLessThanOrEqual", (a, b) => a <= b, "less than or equal to");

  m("toBeCloseTo", function (expected, numDigits = 2) {
    const pass = Math.abs(expected - this._obj) < 10 ** -numDigits / 2;
    this.assert(
      pass,
      `expected #{this} to be close to #{exp} (${numDigits} digits)`,
      `expected #{this} not to be close to #{exp} (${numDigits} digits)`,
      expected,
    );
  });

  m("toContain", function (item) {
    const obj = this._obj;
    const ok =
      typeof obj === "string" ? obj.includes(item) : Array.from(obj).includes(item);
    this.assert(
      ok,
      "expected #{this} to contain #{exp}",
      "expected #{this} not to contain #{exp}",
      item,
    );
  });

  m("toHaveLength", function (length) {
    const actual = this._obj == null ? undefined : this._obj.length;
    this.assert(
      actual === length,
      "expected #{this} to have length #{exp}",
      "expected #{this} not to have length #{exp}",
      length,
      actual,
    );
  });

  m("toMatch", function (expected) {
    const obj = this._obj;
    const ok =
      expected instanceof RegExp ? expected.test(obj) : String(obj).includes(expected);
    this.assert(
      ok,
      "expected #{this} to match #{exp}",
      "expected #{this} not to match #{exp}",
      expected,
    );
  });

  m("toHaveProperty", function (path, ...rest) {
    const keys = Array.isArray(path) ? path : String(path).split(".");
    let cur = this._obj;
    let found = true;
    for (const k of keys) {
      if (cur != null && k in Object(cur)) cur = cur[k];
      else {
        found = false;
        break;
      }
    }
    const pass = found && (rest.length === 0 || utils.eql(cur, rest[0]));
    this.assert(
      pass,
      "expected #{this} to have property #{exp}",
      "expected #{this} not to have property #{exp}",
      path,
    );
  });

  m("toBeInstanceOf", function (ctor) {
    this.assert(
      this._obj instanceof ctor,
      "expected #{this} to be an instance of #{exp}",
      "expected #{this} not to be an instance of #{exp}",
      ctor.name ?? ctor,
    );
  });

  // Delegates to chai's `throw`, which needs the function called by chai
  // itself; branch on the negate flag so `not.toThrow()` works.
  m("toThrow", function (expected) {
    const a = new chai.Assertion(this._obj);
    if (utils.flag(this, "negate")) {
      expected === undefined ? a.to.not.throw() : a.to.not.throw(expected);
    } else {
      expected === undefined ? a.to.throw() : a.to.throw(expected);
    }
  });
}
