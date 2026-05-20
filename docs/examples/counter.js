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
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(Counter, () => {
    describe("inc()", () => {
      test("returns a Counter with count + 1", () => {
        const next = Counter.make().inc();
        expect(next).to.be.instanceOf(Counter.Class);
        expect(next.count).to.equal(1);
      });
      test("works on a non-zero counter", () => {
        expect(Counter.make({ count: 4 }).inc().count).to.equal(5);
      });
      test("works on a negative counter", () => {
        expect(Counter.make({ count: -3 }).inc().count).to.equal(-2);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        c.inc();
        expect(c.count).to.equal(7);
      });
    });

    describe("dec()", () => {
      test("returns a Counter with count - 1", () => {
        const next = Counter.input.dec.call(Counter.make());
        expect(next).to.be.instanceOf(Counter.Class);
        expect(next.count).to.equal(-1);
      });
      test("works on a non-zero counter", () => {
        expect(Counter.input.dec.call(Counter.make({ count: 4 })).count).to.equal(3);
      });
      test("works on a negative counter", () => {
        expect(Counter.input.dec.call(Counter.make({ count: -3 })).count).to.equal(-4);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        Counter.input.dec.call(c);
        expect(c.count).to.equal(7);
      });
    });

    test("inc and dec round-trip back to the original count", () => {
      expect(Counter.input.dec.call(Counter.make({ count: 10 }).inc()).count).to.equal(10);
    });
  });
}
