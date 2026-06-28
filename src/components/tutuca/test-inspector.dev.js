import { ImInspector } from "../data/immutable-inspector.js";
import { getTests as componentInspectorTests } from "./component-inspector.dev.js";
import { collectTests, TestCase, TestReport, TestSuite } from "./test-inspector.js";

export { getComponents } from "./test-inspector.js";

// A small `getTests`-shaped function used by examples and tests.
const sampleTests = ({ describe, test }) => {
  describe("Widget", () => {
    test("renders", () => {});
    describe("interaction", () => {
      test("click increments", () => {});
      test("disabled blocks click", () => {});
    });
  });
};

// A realistic run report — the exact shape of `tutuca test --json`.
const runReport = {
  modules: [
    {
      path: "src/widgets/counter.dev.js",
      counts: { pass: 3, fail: 1, skip: 1, total: 5 },
      suites: [
        {
          title: "Counter",
          componentName: "Counter",
          children: [
            {
              title: "starts at zero",
              status: "pass",
              durationMs: 1.2,
              error: null,
            },
            {
              title: "inc adds one",
              status: "pass",
              durationMs: 0.8,
              error: null,
            },
            {
              title: "edge cases",
              children: [
                {
                  title: "wraps at max",
                  status: "fail",
                  durationMs: 2.1,
                  error: {
                    message: "expected 0 to be 10",
                    expected: 10,
                    actual: 0,
                  },
                },
                {
                  title: "decrements",
                  status: "pass",
                  durationMs: 0.5,
                  error: null,
                },
                {
                  title: "async path",
                  status: "skip",
                  durationMs: 0,
                  error: null,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export function getExamples() {
  return {
    title: "TestReport (definitions + run)",
    description:
      "TestReport renders either the test tree a module declares (TestReport.fromTests + collectTests, which walks getTests without running it) or a run report (TestReport.fromResults, the `tutuca test --json` shape). Suites collapse/paginate; failing suites auto-expand and show the message plus an expected/actual diff.",
    items: [
      {
        title: "Definitions — sample module",
        value: TestReport.Class.fromTests(collectTests(sampleTests), {
          title: "widget.dev.js",
        }),
      },
      {
        title: "Definitions — this repo's component-inspector.dev.js",
        description: "Collected live from a real module's getTests.",
        value: TestReport.Class.fromTests(collectTests(componentInspectorTests), {
          title: "component-inspector.dev.js",
        }),
      },
      {
        title: "Run — mixed pass/fail/skip (failing suite auto-expanded)",
        value: TestReport.Class.fromResults(runReport),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(TestReport, () => {
    test("collectTests walks getTests into a plain tree", () => {
      const tree = collectTests(sampleTests);
      expect(tree.length).toBe(1);
      expect(tree[0].title).toBe("Widget");
      expect(tree[0].children.length).toBe(2);
      expect(tree[0].children[1].title).toBe("interaction");
      expect(tree[0].children[1].children.length).toBe(2);
    });

    test("fromTests builds a suite tree with no run counts", () => {
      const r = TestReport.Class.fromTests(collectTests(sampleTests));
      expect(r.hasCounts).toBe(false);
      const widget = r.suites.first();
      expect(widget).toBeInstanceOf(TestSuite.Class);
      expect(widget.items.size).toBe(2);
      // a definition leaf renders the neutral "•" mark
      expect(widget.items.first().mark()).toBe("•");
    });

    test("fromResults carries totals and builds the suite tree", () => {
      const r = TestReport.Class.fromResults(runReport);
      expect(r.hasCounts).toBe(true);
      expect(r.pass).toBe(3);
      expect(r.fail).toBe(1);
      expect(r.skip).toBe(1);
      const counter = r.suites.first();
      expect(counter).toBeInstanceOf(TestSuite.Class);
      expect(counter.summary).toBe("✓3 ✗1 ○1");
      expect(counter.isExpanded).toBe(true);
    });

    test("a failing test shows the mark, message, and diff", () => {
      const r = TestReport.Class.fromResults(runReport);
      const edge = r.suites.first().items.get(2);
      expect(edge).toBeInstanceOf(TestSuite.Class);
      const failCase = edge.items.first();
      expect(failCase).toBeInstanceOf(TestCase.Class);
      expect(failCase.status).toBe("fail");
      expect(failCase.mark()).toBe("✗");
      expect(failCase.markClass()).toContain("text-error");
      expect(failCase.message).toBe("expected 0 to be 10");
      expect(failCase.detail).toBeInstanceOf(ImInspector.Class);
    });

    test("a passing test reports its duration; a skip does not", () => {
      const r = TestReport.Class.fromResults(runReport);
      const items = r.suites.first().items;
      expect(items.first().durText()).toBe("(1ms)");
      const edge = items.get(2);
      expect(edge.items.get(2).durText()).toBe("");
    });
  });
}
