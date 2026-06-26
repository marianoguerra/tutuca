// Nested fixture — proves `tutuca test <dir>` walks subdirectories.
import { component, html } from "../../../../index.js";

const Beta = component({
  name: "Beta",
  fields: { label: "?" },
  view: html`<span @text=".label"></span>`,
});

export function getComponents() {
  return [Beta];
}

export function getTests({ describe, test, expect }) {
  describe(Beta, () => {
    test("label default", () => {
      expect(Beta.make().label).toBe("?");
    });
  });
}
