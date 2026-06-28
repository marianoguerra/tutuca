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
import { buildInspectorViews, isComponentInstance } from "tutuca/components";

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
  return example
    .setInstanceView(views.instanceView)
    .setComponentView(views.componentView)
    .setLintView(views.lintView)
    .setTestView(views.testView)
    .setHasInspect(views.hasInspect)
    .setHasComponent(views.hasComponent)
    .setHasLint(views.hasLint)
    .setHasTest(views.hasTest);
}

// Walk the built root's sections → items, replacing each Example with one
// carrying its inspector views. Returns a new root (immutable updates).
export async function attachInspectorViews(root, scope, modules, dev = null) {
  const testIndex = buildTestIndex(modules);
  let sections = root.sections;
  for (let si = 0; si < sections.size; si++) {
    const section = sections.get(si);
    let items = section.items;
    for (let ii = 0; ii < items.size; ii++) {
      items = items.set(ii, await buildExampleInspectors(items.get(ii), scope, testIndex, dev));
    }
    sections = sections.set(si, section.setItems(items));
  }
  return root.setSections(sections);
}
