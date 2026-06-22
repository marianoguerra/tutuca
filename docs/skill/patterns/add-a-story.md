# Add a story for a component

**Problem:** show a component (and its states) in the storybook.

Create `foo.dev.js` next to `foo.js`:

```js
import { Foo } from "./foo.js";

export function getComponents() {
  return [Foo];
}
export function getExamples() {
  return { title: "Foo", items: [
    { title: "Empty", value: Foo.make({}) },
    { title: "Loaded", value: Foo.make({ isLoading: true }),
      requestHandlers: { async load() { return [{ id: 1 }]; } } },
  ] };
}
```

`value` must be a real `Foo.make(...)` instance, not a plain object. Add a
`requestHandlers` map to an item to mock that example's requests
(fixture / `throw` / never-resolve) — these are storybook-only. Run
`tutuca storybook` to view, or `--dry-run --json` to smoke-test. See
[storybook.md](../storybook.md).
