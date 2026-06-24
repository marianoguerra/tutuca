import { component, html } from "tutuca";

const Counter = component({
  name: "Counter",
  fields: {
    count: 0,
  },
  methods: {
    // event handlers can call methods with a `$` prefix `@on.click="$inc"`
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  input: {
    // event handlers can call input handlers by name `@on.click="dec"`
    dec() {
      return this.setCount(this.count - 1);
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
    <button class="btn btn-success" @on.click="$inc">+</button>
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
        on: { init: { input: [{ name: "dec", args: [] }] } },
      },
    ],
  };
}

export function getTests({ describe, test, expect, drive }) {
  describe(Counter, () => {
    describe("lifecycle via drive()", () => {
      test("on.init's `dec` input handler decrements once when shown", async () => {
        const settled = await drive(Counter.make({ count: 3 }), {
          input: [{ name: "dec", args: [] }],
        });
        expect(settled.count).toBe(2);
      });
    });

    describe("inc()", () => {
      test("returns a Counter with count + 1", () => {
        const next = Counter.make().inc();
        expect(next).toBeInstanceOf(Counter.Class);
        expect(next.count).toBe(1);
      });
      test("works on a non-zero counter", () => {
        expect(Counter.make({ count: 4 }).inc().count).toBe(5);
      });
      test("works on a negative counter", () => {
        expect(Counter.make({ count: -3 }).inc().count).toBe(-2);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        c.inc();
        expect(c.count).toBe(7);
      });
    });

    describe("dec()", () => {
      test("returns a Counter with count - 1", () => {
        const next = Counter.input.dec.call(Counter.make());
        expect(next).toBeInstanceOf(Counter.Class);
        expect(next.count).toBe(-1);
      });
      test("works on a non-zero counter", () => {
        expect(Counter.input.dec.call(Counter.make({ count: 4 })).count).toBe(3);
      });
      test("works on a negative counter", () => {
        expect(Counter.input.dec.call(Counter.make({ count: -3 })).count).toBe(-4);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        Counter.input.dec.call(c);
        expect(c.count).toBe(7);
      });
    });

    test("inc and dec round-trip back to the original count", () => {
      expect(Counter.input.dec.call(Counter.make({ count: 10 }).inc()).count).toBe(10);
    });
  });
}
