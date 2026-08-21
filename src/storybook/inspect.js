// Per-example inspector orchestration for the storybook tabs. Given the built
// root, the registered scope, the source modules, and (optionally) the `dev`
// data producers, it builds the inspector views for each example and bakes them
// onto the Example instances before the app starts.
//
// The actual view-building is the reusable buildInspectorViews (tutuca/components);
// this module just walks the storybook's Section/Example tree and bakes the
// returned views onto each Example. The lint/test DATA producers are injected via
// `dev` (from tutuca/dev) so this engine stays free of the heavy core/lint/test
// deps — mirroring how mountStorybook takes a compileCss callback for margaui.
import { ActivityLog, buildInspectorViews, isComponentInstance } from "tutuca/components";
import { produce } from "tutuca/immer";

// compName -> { getTests, components } from the modules that define tests, so
// the test tab can run just that component's suites (runTests filters by name).
function buildTestIndex(modules) {
  const index = new Map();
  for (const m of modules) {
    if (typeof m.getTests !== "function") continue;
    const components = m.getComponents?.() ?? [];
    for (const c of components) {
      if (!index.has(c.name)) index.set(c.name, { getTests: m.getTests, components });
    }
  }
  return index;
}

async function buildExampleInspectors(example, scope, testIndex, dev) {
  const value = example.value;
  // The example's component (if any) selects which module's getTests cover it.
  const comp = isComponentInstance(value) ? scope.getCompFor(value) : null;
  const entry = comp ? testIndex.get(comp.name) : null;
  const views = await buildInspectorViews(value, scope, {
    getTests: entry?.getTests ?? null,
    components: entry?.components ?? [],
    dev,
  });
  return {
    ...views,
    activityLog: ActivityLog.make({}),
  };
}

// Walk the built root's sections → items, replacing each Example with one
// carrying its inspector views. Returns a structurally shared new root.
export async function attachInspectorViews(root, scope, modules, dev = null) {
  const testIndex = buildTestIndex(modules);
  const updates = [];
  for (let si = 0; si < root.sections.length; si++) {
    for (let ii = 0; ii < root.sections[si].items.length; ii++) {
      updates.push({
        si,
        ii,
        values: await buildExampleInspectors(root.sections[si].items[ii], scope, testIndex, dev),
      });
    }
  }
  return produce(root, (draft) => {
    for (const { si, ii, values } of updates) Object.assign(draft.sections[si].items[ii], values);
  });
}
