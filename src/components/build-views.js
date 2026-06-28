// Reusable per-instance inspector builder. Given a value (usually a component
// instance) and a registered tutuca scope, returns the inspector view instances
// (instance / component / lint / test) + visibility flags that the storybook
// tabs and the playground both render. Independent of any host UI (no
// Section/Example tree, no DOM).
//
// Rendering comes from the inspector components in this same library; the lint
// and test DATA producers are injected via `dev` ({ shadowCheckComponent,
// runTests, expect } from tutuca/dev) so this module stays dependency-light —
// it must NOT import tutuca/dev (heavy core/lint/test deps). Same decoupling the
// storybook engine uses.

import { ComponentInspector } from "./tutuca/component-inspector.js";
import { InstanceInspector, isComponentInstance } from "./tutuca/instance-inspector.js";
import { LintReport } from "./tutuca/lint-inspector.js";
import { TestReport } from "./tutuca/test-inspector.js";

// Build the inspector views for a single value.
//   value      — the instance/value to inspect (e.g. app.state.val or an example value)
//   scope      — a registered ComponentStack (app.registerComponents(...) result) used
//                to resolve the value's Component descriptor via scope.getCompFor(value)
//   getTests   — a module's getTests fn; when present (and dev wired) the Test view is built
//   components — components passed to runTests
//   dev        — { shadowCheckComponent, runTests, expect }; omit to skip Lint/Test
//   name       — runTests component filter; defaults to the resolved component's name
//                (pass null to run the whole module's tests, regardless of component)
// Returns { instanceView, dataView, componentView, lintView, testView,
//           hasInspect, hasComponent, hasLint, hasTest }.
export async function buildInspectorViews(
  value,
  scope,
  { getTests = null, components = [], dev = null, name } = {},
) {
  const comp = isComponentInstance(value) ? scope.getCompFor(value) : null;
  const out = {
    instanceView: InstanceInspector.Class.fromData(value, scope.getCompFor(value)),
    componentView: null,
    lintView: null,
    testView: null,
    hasInspect: true,
    hasComponent: false,
    hasLint: false,
    hasTest: false,
  };

  if (comp) {
    out.componentView = ComponentInspector.Class.fromData(comp);
    out.hasComponent = true;
    if (dev) {
      const findings = dev.shadowCheckComponent(comp);
      out.lintView = LintReport.Class.fromData({
        components: [{ componentName: comp.name, findings }],
      });
      out.hasLint = true;

      if (getTests) {
        const report = await dev.runTests({
          getTests,
          components,
          expect: dev.expect,
          name: name === undefined ? comp.name : name,
        });
        out.testView = TestReport.Class.fromResults(report);
        out.hasTest = true;
      }
    }
  }

  return out;
}
