import { component, html, IMap, List } from "tutuca";
import { JsonViewer } from "../data/json.js";
import {
  InstanceExplorer,
  InstanceFields,
  InstanceInspector,
  isComponentInstance,
} from "./instance-inspector.js";
import { LintReport } from "./lint-inspector.js";
import { TestReport } from "./test-inspector.js";

export { getComponents } from "./instance-inspector.js";

// Sample test-run and lint reports (the `tutuca test/lint --json` shapes) for
// the extra explorer tabs.
const runReport = {
  modules: [
    {
      path: "sample.dev.js",
      counts: { pass: 2, fail: 1, skip: 0, total: 3 },
      suites: [
        {
          title: "SampleCard",
          children: [
            { title: "renders", status: "pass", durationMs: 1, error: null },
            { title: "bump increments", status: "pass", durationMs: 1, error: null },
            {
              title: "wraps at max",
              status: "fail",
              durationMs: 1,
              error: { message: "expected 0 to be 5", expected: 5, actual: 0 },
            },
          ],
        },
      ],
    },
  ],
};

const lintReport = {
  components: [
    {
      componentName: "SampleCard",
      findings: [
        {
          id: "FIELD_VAL_NOT_DEFINED",
          level: "error",
          info: { tag: "DIV", originAttr: "@text", name: "missing" },
          context: { componentName: "SampleCard", viewName: "main" },
          suggestion: null,
        },
      ],
    },
  ],
};

// A small descriptor exercising a few field types.
const Sample = component({
  name: "SampleCard",
  fields: { title: "", count: 0, tags: [], open: false },
  methods: {
    label() {
      return this.title;
    },
  },
  input: {
    bump() {
      return this.setCount(this.count + 1);
    },
  },
  view: html`<div class="card" @text=".title"></div>`,
});

// Simplest possible "resolve the descriptor from an instance" for the demo:
// a lookup over the descriptors we know about, keyed by the instance's Class.
const KNOWN = [Sample, JsonViewer];
const compFor = (inst) => KNOWN.find((c) => c.Class === inst.constructor) ?? null;

export function getExamples() {
  const card = Sample.make({
    title: "Hello",
    count: 3,
    tags: ["a", "b"],
    open: true,
  });
  const viewer = JsonViewer.Class.fromData({ x: 1, y: [2, 3] });
  const orphan = Sample.make({ title: "no descriptor", count: 7 });

  const inspect = (inst) => InstanceInspector.Class.fromData(inst, compFor(inst));
  const explore = (inst) => InstanceExplorer.Class.fromData(inst, compFor(inst));

  return {
    title: "InstanceInspector / InstanceExplorer",
    description:
      "InstanceInspector renders a component instance's field → value pairs (field names/types from the descriptor, values from the instance), reusing the data-inspector components. InstanceExplorer wraps an instance in up to four tabs — its values (Instance), its definition (Component), and, when provided, its test-run (Tests) and lint (Lint) results. A tab only appears when it has content. The instance and descriptor are passed in; tests/lint come as raw --json data or prebuilt inspectors.",
    items: [
      {
        title: "Instance inspector (collapsed)",
        value: inspect(card),
      },
      {
        title: "Instance inspector (expanded)",
        value: inspect(card).toggleIsExpanded(),
      },
      {
        title: "Instance inspector of a JsonViewer instance",
        value: inspect(viewer).toggleIsExpanded(),
      },
      {
        title: "Instance inspector fallback (no descriptor → plain data)",
        description:
          "When the caller can't resolve a descriptor, the value still renders via the Immutable/JSON data inspector.",
        value: InstanceInspector.Class.fromData(orphan, null).toggleIsExpanded(),
      },
      {
        title: "Explorer — Instance tab (default)",
        value: explore(card),
      },
      {
        title: "Explorer — Component tab",
        value: explore(card).setActiveTab("component"),
      },
      {
        title: "Explorer without a descriptor (Component tab shows a notice)",
        value: InstanceExplorer.Class.fromData(orphan, null).setActiveTab("component"),
      },
      {
        title: "Explorer — all four tabs (Tests tab)",
        description: "Instance + Component + Tests + Lint. Only tabs with content are shown.",
        value: InstanceExplorer.Class.fromData(card, Sample, {
          tests: runReport,
          lint: lintReport,
        }).setActiveTab("tests"),
      },
      {
        title: "Explorer — all four tabs (Lint tab)",
        value: InstanceExplorer.Class.fromData(card, Sample, {
          tests: runReport,
          lint: lintReport,
        }).setActiveTab("lint"),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  const card = Sample.make({ title: "Hi", count: 2, tags: ["x"], open: true });

  describe(InstanceInspector, () => {
    test("isComponentInstance recognizes instances, rejects other values", () => {
      expect(isComponentInstance(card)).toBe(true);
      expect(isComponentInstance({ a: 1 })).toBe(false);
      expect(isComponentInstance(42)).toBe(false);
      expect(isComponentInstance(null)).toBe(false);
      expect(isComponentInstance(IMap({ a: 1 }))).toBe(false);
      expect(isComponentInstance(List([1, 2]))).toBe(false);
    });

    test("with a descriptor, value is an InstanceFields", () => {
      const insp = InstanceInspector.Class.fromData(card, Sample);
      expect(insp.value).toBeInstanceOf(InstanceFields.Class);
    });

    test("without a descriptor, value falls back to the data inspector", () => {
      const insp = InstanceInspector.Class.fromData(card, null);
      expect(insp.value).not.toBeInstanceOf(InstanceFields.Class);
    });
  });

  describe(InstanceFields, () => {
    test("typeName is the component name and rows match the fields", () => {
      const f = InstanceFields.Class.fromData(card, Sample);
      expect(f.typeName).toBe("SampleCard");
      const keys = f.items.toArray().map((e) => e.key);
      expect(keys).toEqual(["title", "count", "tags", "open"]);
    });
  });

  describe(InstanceExplorer, () => {
    test("with a descriptor, builds both tabs", () => {
      const ex = InstanceExplorer.Class.fromData(card, Sample);
      expect(ex.activeTab).toBe("instance");
      expect(ex.hasComponent).toBe(true);
      expect(ex.instanceView).toBeInstanceOf(InstanceInspector.Class);
      // componentView is a ComponentInspector built from the descriptor
      expect(ex.componentView.compName).toBe("SampleCard");
    });

    test("without a descriptor, the component tab is empty", () => {
      const ex = InstanceExplorer.Class.fromData(card, null);
      expect(ex.hasComponent).toBe(false);
      expect(ex.componentView).toBe(null);
    });

    test("tests/lint are absent unless provided", () => {
      const ex = InstanceExplorer.Class.fromData(card, Sample);
      expect(ex.hasTests).toBe(false);
      expect(ex.hasLint).toBe(false);
      expect(ex.testView).toBe(null);
      expect(ex.lintView).toBe(null);
    });

    test("with tests and lint, builds those tabs from raw report data", () => {
      const ex = InstanceExplorer.Class.fromData(card, Sample, {
        tests: runReport,
        lint: lintReport,
      });
      expect(ex.hasTests).toBe(true);
      expect(ex.hasLint).toBe(true);
      expect(ex.testView).toBeInstanceOf(TestReport.Class);
      expect(ex.lintView).toBeInstanceOf(LintReport.Class);
    });

    test("accepts a prebuilt inspector instance for a tab", () => {
      const prebuilt = TestReport.Class.fromResults(runReport);
      const ex = InstanceExplorer.Class.fromData(card, Sample, {
        tests: prebuilt,
      });
      expect(ex.testView).toBe(prebuilt);
    });

    test("setActiveTab switches the active tab", () => {
      const ex = InstanceExplorer.Class.fromData(card, Sample);
      expect(ex.setActiveTab("lint").activeTab).toBe("lint");
    });
  });
}
