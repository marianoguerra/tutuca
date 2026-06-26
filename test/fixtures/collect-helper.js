// Fixture for the CLI dev-build resolve hook: its getTests uses the dev-only
// `collectIterBindings`. Under `tutuca test` the hook must redirect the bare
// "tutuca" import to the dev build, or this helper is a no-op (returns []) and
// the test fails.
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
