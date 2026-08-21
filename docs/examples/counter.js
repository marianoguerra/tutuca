import { component, html } from "tutuca";
import { produce } from "tutuca/immer";

const applyRecipe = (current, recipe, ...args) =>
  produce(current, (draft) => recipe.call(current, draft, ...args));

const Counter = component({
  name: "Counter",
  fields: {
    count: 0,
  },
  receive: {
    // Event handlers name entries in `receive`; they are not component methods.
    inc(draft) {
      draft.count++;
    },

    // Every event action uses the same bare receive-name syntax.
    dec(draft) {
      draft.count = this.count - 1;
    },
  },
  view: html`<div class="join join-vertical">
    <button class="btn btn-error" @on.click="dec">-</button>
    <div class="stats">
      <div class="stat text-center">
        <div class="stat-title">Count</div>
        <div class="stat-value" @text=".count"></div>
        <div class="stat-desc">Current Count</div>
      </div>
    </div>
    <button class="btn btn-success" @on.click="inc">+</button>
  </div>`,
});

export function getComponents() {
  return [Counter];
}

export function getRoot() {
  return Counter.make({});
}

export function getExamples() {
  return {
    title: "Counter",
    description: "A counter component that can be increased and decreased",
    items: [
      {
        title: "Basic Counter",
        description: "A Basic Counter",
        value: Counter.make(),
      },
      {
        title: "Counter with negative initial value",
        description: "Let's see how it handles negative values",
        value: Counter.make({ count: -5 }),
      },
      {
        title: "Counter that decrements when first shown",
        description: "Lifecycle hook: on.init runs the `dec` input handler",
        value: Counter.make({ count: 3 }),
        on: { init: { send: [{ name: "dec", args: [] }] } },
      },
    ],
  };
}

export function getTests({ describe, test, expect, drive }) {
  describe(Counter, () => {
    describe("lifecycle via drive()", () => {
      test("on.init's `dec` input handler decrements once when shown", async () => {
        const settled = await drive(Counter.make({ count: 3 }), {
          send: [{ name: "dec", args: [] }],
        });
        expect(settled.count).toBe(2);
      });
    });

    describe("inc()", () => {
      test("returns a Counter with count + 1", () => {
        const current = Counter.make();
        const next = applyRecipe(current, Counter.receive.inc);
        expect(next).toBeInstanceOf(Counter.Class);
        expect(next.count).toBe(1);
      });
      test("works on a non-zero counter", () => {
        const current = Counter.make({ count: 4 });
        expect(applyRecipe(current, Counter.receive.inc).count).toBe(5);
      });
      test("works on a negative counter", () => {
        const current = Counter.make({ count: -3 });
        expect(applyRecipe(current, Counter.receive.inc).count).toBe(-2);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        applyRecipe(c, Counter.receive.inc);
        expect(c.count).toBe(7);
      });
    });

    describe("dec()", () => {
      test("returns a Counter with count - 1", () => {
        const current = Counter.make();
        const next = applyRecipe(current, Counter.receive.dec);
        expect(next).toBeInstanceOf(Counter.Class);
        expect(next.count).toBe(-1);
      });
      test("works on a non-zero counter", () => {
        const current = Counter.make({ count: 4 });
        expect(applyRecipe(current, Counter.receive.dec).count).toBe(3);
      });
      test("works on a negative counter", () => {
        const current = Counter.make({ count: -3 });
        expect(applyRecipe(current, Counter.receive.dec).count).toBe(-4);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        applyRecipe(c, Counter.receive.dec);
        expect(c.count).toBe(7);
      });
    });

    test("inc and dec round-trip back to the original count", () => {
      const current = Counter.make({ count: 10 });
      const incremented = applyRecipe(current, Counter.receive.inc);
      expect(applyRecipe(incremented, Counter.receive.dec).count).toBe(10);
    });
  });
}
