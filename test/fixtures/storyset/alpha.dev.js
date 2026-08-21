// Fixture for `tutuca test <dir>` (walk-and-run). Named *.dev.js so the repo's own
// runner ignores it (vitest only globs test/*.test.js); `tutuca test` discovers it
// via its dirMatch.
import { component, html } from "../../../index.js";
import { produce } from "../../../src/immer.js";

const Alpha = component({
  name: "Alpha",
  fields: { n: 0 },
  receive: {
    bump(draft) {
      draft.n++;
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
      const value = Alpha.make({ n: 1 });
      expect(produce(value, (draft) => Alpha.receive.bump.call(value, draft)).n).toBe(2);
    });
  });
}
