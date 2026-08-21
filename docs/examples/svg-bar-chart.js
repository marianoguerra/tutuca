import { component, html } from "tutuca";
import { produce } from "tutuca/immer";

const applyRecipe = (current, recipe, ...args) =>
  produce(current, (draft) => recipe.call(current, draft, ...args));

// SVG renders straight from a tutuca template: the `<svg>` subtree keeps its
// namespace, so `<rect>` / `<line>` / `<text>` become real SVG elements.
// `@each` iterates the data, `@loop-with` computes shared layout once, and
// `@enrich-with` derives each bar's geometry as `@`-prefixed bindings.
const BarChart = component({
  name: "BarChart",
  fields: {
    // each value is a bar height in the 0..100 range
    values: [40, 72, 28, 90, 55, 63],
  },
  alter: {
    // runs once per render, before the loop: divide the 300-wide viewBox
    // among however many bars there currently are
    layout(seq) {
      const step = 300 / seq.length;
      return { iterData: { step, barW: step * 0.62 } };
    },
    // runs per bar: turn an index + value into pixel geometry
    bar(binds, key, value, { step, barW }) {
      binds.x = key * step + (step - barW) / 2;
      binds.w = barW;
      binds.h = value;
      binds.y = 110 - value;
      binds.cx = key * step + step / 2;
      binds.labelY = 110 - value - 5;
    },
  },
  receive: {
    randomize(draft) {
      const next = this.values.map(() => Math.round(Math.random() * 90 + 10));
      draft.values = next;
    },
    addBar(draft) {
      if (draft.values.length < 9) draft.values.push(Math.round(Math.random() * 90 + 10));
    },
    removeBar(draft) {
      if (draft.values.length > 1) draft.values.pop();
    },
  },
  view: html`<div class="flex flex-col gap-3">
    <svg viewBox="0 0 300 120" style="width:100%;height:180px" role="img">
      <line x1="0" y1="110" x2="300" y2="110" stroke="#cbd5e1" stroke-width="1"></line>
      <rect
        @each=".values"
        @loop-with="layout"
        @enrich-with="bar"
        :x="@x"
        :y="@y"
        :width="@w"
        :height="@h"
        rx="3"
        fill="#6366f1"
      ></rect>
      <text
        @each=".values"
        @loop-with="layout"
        @enrich-with="bar"
        :x="@cx"
        :y="@labelY"
        @text="@value"
        text-anchor="middle"
        font-size="10"
        fill="#475569"
      ></text>
    </svg>
    <div class="join">
      <button class="btn btn-primary join-item" @on.click="randomize">Randomize</button>
      <button class="btn join-item" @on.click="addBar">Add bar</button>
      <button class="btn join-item" @on.click="removeBar">Remove bar</button>
    </div>
  </div>`,
});

export function getComponents() {
  return [BarChart];
}

export function getRoot() {
  return BarChart.make({});
}

export function getExamples() {
  return {
    title: "SVG Bar Chart",
    description: "A reactive SVG bar chart driven by a list field",
    items: [
      { title: "Default", description: "Six bars", value: BarChart.make() },
      {
        title: "Single bar",
        description: "Layout adapts to the bar count",
        value: BarChart.make({ values: [70] }),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(BarChart, () => {
    test("randomize keeps the bar count", () => {
      const current = BarChart.make();
      const next = applyRecipe(current, BarChart.receive.randomize);
      expect(next.values.length).toBe(6);
    });
    test("addBar appends one bar", () => {
      const current = BarChart.make({ values: [10] });
      expect(applyRecipe(current, BarChart.receive.addBar).values.length).toBe(2);
    });
    test("addBar is capped at 9 bars", () => {
      const full = BarChart.make({ values: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
      expect(applyRecipe(full, BarChart.receive.addBar)).toBe(full);
    });
    test("removeBar drops the last bar", () => {
      const current = BarChart.make({ values: [10, 20] });
      expect(applyRecipe(current, BarChart.receive.removeBar).values.length).toBe(1);
    });
    test("removeBar keeps at least one bar", () => {
      const one = BarChart.make({ values: [10] });
      expect(applyRecipe(one, BarChart.receive.removeBar)).toBe(one);
    });
    test("layout splits the width evenly", () => {
      expect(
        BarChart.alter.layout(BarChart.make({ values: [1, 2, 3, 4] }).values).iterData.step,
      ).toBe(75);
    });
  });
}
