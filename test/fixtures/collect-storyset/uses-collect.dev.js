// Fixture for the dev-build resolve hook under `tutuca storybook`. Its getTests
// uses the dev-only `collectIterBindings`, so the storybook command (which runs
// getTests in the terminal, including under --dry-run) must redirect the bare
// "tutuca" import to the dev build. Without the redirect the helper is a no-op
// that returns [] and the test fails.
//
// In its own directory so the storybook glob picks up this module alone.
import { collectIterBindings, component, html } from "tutuca";

const Items = component({
  name: "Items",
  fields: { items: [] },
  alter: {
    pick() {
      return { keys: [2, 0] };
    },
  },
  view: html`<ul>
    <li @each=".items" @loop-with="pick"><x text="@value"></x></li>
  </ul>`,
});

export function getComponents() {
  return [Items];
}

export function getRoot() {
  return Items.make({ items: ["a", "b", "c", "d"] });
}

export function getTests({ describe, test, expect }) {
  describe(Items, () => {
    test("collectIterBindings returns the picked keys (needs the real dev impl)", () => {
      const c = Items.make({ items: ["a", "b", "c", "d"] });
      const keys = collectIterBindings(Items, c, c.items, { loopWith: "pick" }).map((b) => b.key);
      expect(keys).toEqual([2, 0]);
    });
  });
}
