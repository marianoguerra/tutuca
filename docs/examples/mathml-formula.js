import { component, html } from "tutuca";

// MathML renders from a template just like SVG: the `<math>` subtree keeps
// its namespace, so `<msup>`, `<mfrac>`, `<mn>` … become real MathML
// elements. `@text` on an `<mn>` makes the displayed number reactive.
const Quadratic = component({
  name: "Quadratic",
  fields: { a: 1, b: -3, c: 2 },
  methods: {
    // discriminant b² − 4ac decides how many real roots the equation has
    discriminant() {
      return this.b * this.b - 4 * this.a * this.c;
    },
    classify() {
      const d = this.discriminant();
      if (d > 0) return "two distinct real roots";
      if (d === 0) return "one repeated real root";
      return "no real roots";
    },
  },
  view: html`<div class="flex flex-col gap-3">
    <div class="flex gap-3 text-sm">
      <label class="flex items-center gap-1">
        a <input type="number" class="input input-sm w-16" :value=".a" @on.input="$setA valueAsInt" />
      </label>
      <label class="flex items-center gap-1">
        b <input type="number" class="input input-sm w-16" :value=".b" @on.input="$setB valueAsInt" />
      </label>
      <label class="flex items-center gap-1">
        c <input type="number" class="input input-sm w-16" :value=".c" @on.input="$setC valueAsInt" />
      </label>
    </div>

    <math display="block" style="font-size:1.4rem">
      <mn @text=".a"></mn>
      <mo>&#x2062;</mo>
      <msup><mi>x</mi><mn>2</mn></msup>
      <mo>+</mo>
      <mn @text=".b"></mn>
      <mo>&#x2062;</mo>
      <mi>x</mi>
      <mo>+</mo>
      <mn @text=".c"></mn>
      <mo>=</mo>
      <mn>0</mn>
    </math>

    <math display="block">
      <mi>&#x0394;</mi>
      <mo>=</mo>
      <msup><mi>b</mi><mn>2</mn></msup>
      <mo>&#x2212;</mo>
      <mn>4</mn><mo>&#x2062;</mo><mi>a</mi><mo>&#x2062;</mo><mi>c</mi>
      <mo>=</mo>
      <mn @text="$discriminant"></mn>
    </math>

    <p class="text-sm" @text="$classify"></p>
  </div>`,
});

export function getComponents() {
  return [Quadratic];
}

export function getRoot() {
  return Quadratic.make({});
}

export function getExamples() {
  return {
    title: "MathML Formula",
    description: "A quadratic equation rendered with reactive MathML",
    items: [
      { title: "Two roots", description: "x² − 3x + 2", value: Quadratic.make() },
      {
        title: "No real roots",
        description: "x² + x + 1",
        value: Quadratic.make({ a: 1, b: 1, c: 1 }),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(Quadratic, () => {
    test("discriminant of x² − 3x + 2 is positive", () => {
      expect(Quadratic.make().discriminant()).toBe(1);
    });
    test("discriminant of x² + x + 1 is negative", () => {
      expect(Quadratic.make({ a: 1, b: 1, c: 1 }).discriminant()).toBe(-3);
    });
    test("classify reports a repeated root for x² − 2x + 1", () => {
      expect(Quadratic.make({ a: 1, b: -2, c: 1 }).classify()).toBe("one repeated real root");
    });
    test("classify reports two roots for the default equation", () => {
      expect(Quadratic.make().classify()).toBe("two distinct real roots");
    });
  });
}
