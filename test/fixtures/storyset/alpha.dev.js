// Fixture for `tutuca test <dir>` (walk-and-run). Named *.dev.js so the repo's own
// runner ignores it (vitest only globs test/*.test.js); `tutuca test` discovers it
// via its dirMatch.
import { component, html } from "../../../index.js";

const Alpha = component({
  name: "Alpha",
  fields: { n: 0 },
  methods: {
    bump() {
      return this.setN(this.n + 1);
    },
  },
  view: html`<div @text=".n"></div>`,
});

export function getComponents() {
  return [Alpha];
}

export function getTests({ describe, test, expect }) {
  describe(Alpha, () => {
    test("bump increments n", () => {
      expect(Alpha.make({ n: 1 }).bump().n).toBe(2);
    });
  });
}
