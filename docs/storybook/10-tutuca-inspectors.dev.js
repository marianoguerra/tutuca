// 10 — TUTUCA INSPECTORS: the tutuca-aware inspectors shipped as `tutuca/components`.
//
// Companion to 09 (data inspectors). These four components introspect tutuca itself:
//   - ComponentInspector — a component DESCRIPTOR (the object component({...}) returns)
//   - InstanceInspector / InstanceExplorer — a live component INSTANCE
//   - LintReport — `tutuca lint --json` output
//   - TestReport — a test tree (definitions) or `tutuca test --json` output
//
// Ported from the components' co-located *.dev.js files (src/components/tutuca/*),
// swapping their relative imports for the single "tutuca/components" specifier and
// renaming the few module-level fixtures that collided across the merged files
// (each source defined its own `runReport` / `lintReport`).
import { component, html, IMap, List } from "tutuca";
import {
  collectTests,
  CompName,
  ComponentInspector,
  CompSection,
  CompView,
  ImInspector,
  InstanceExplorer,
  InstanceFields,
  InstanceInspector,
  introspectComponent,
  isComponentInstance,
  JsonViewer,
  LintComponent,
  LintFinding,
  LintReport,
  lintMessage,
  TestCase,
  TestReport,
  TestSuite,
} from "tutuca/components";

export { getComponents } from "tutuca/components";

// ── ComponentInspector fixtures/helpers ─────────────────────────────────────────
// A minimal descriptor: just a name, one field, and a view.
const Minimal = component({
  name: "MinimalSample",
  fields: { x: 0 },
  view: html`<i @text=".x"></i>`,
});

// A descriptor exercising every introspected channel.
const Rich = component({
  name: "RichSample",
  fields: { title: "", count: 0, tags: [], open: false },
  methods: {
    label() {
      return this.title;
    },
    double() {
      return this.count * 2;
    },
  },
  input: {
    inc() {
      return this.setCount(this.count + 1);
    },
    reset() {
      return this.setCount(0);
    },
  },
  receive: {
    ping() {
      return this;
    },
  },
  bubble: {
    onChild() {
      return this;
    },
  },
  response: {
    onData() {
      return this;
    },
  },
  alter: {
    rows() {
      return { start: 0, end: this.count };
    },
  },
  statics: {
    blank() {
      return this.make({});
    },
    fromTitle(t) {
      return this.make({ title: t });
    },
  },
  view: html`<div @text=".title"></div>`,
  views: {
    compact: html`<span @text=".title"></span>`,
  },
});

// A descriptor whose view spans multiple indented lines — shows the raw source is
// displayed verbatim, preserving newlines and whitespace.
const Formatted = component({
  name: "FormattedSample",
  fields: { title: "", items: [] },
  view: html`<div class="card bg-base-100 shadow">
  <div class="card-body">
    <h2 class="card-title" @text=".title"></h2>
    <ul class="menu">
      <x render-each=".items"></x>
    </ul>
  </div>
</div>`,
});

const expandSections = (insp) => insp.setSections(insp.sections.map((s) => s.setIsExpanded(true)));

// Expand the Views section AND each view's source block inside it.
const expandViews = (insp) =>
  insp.setSections(
    insp.sections.map((s) =>
      s.label === "Views"
        ? s.setIsExpanded(true).setItems(s.items.map((v) => v.setIsExpanded(true)))
        : s,
    ),
  );

// ── InstanceInspector / InstanceExplorer fixtures/helpers ───────────────────────
// Sample test-run and lint reports (the `tutuca test/lint --json` shapes) for the
// extra explorer tabs.
const explorerRunReport = {
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

const explorerLintReport = {
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

// Simplest possible "resolve the descriptor from an instance" for the demo: a lookup
// over the descriptors we know about, keyed by the instance's Class.
const KNOWN = [Sample, JsonViewer];
const compFor = (inst) => KNOWN.find((c) => c.Class === inst.constructor) ?? null;

// ── LintReport fixtures ─────────────────────────────────────────────────────────
// Real findings copied verbatim from `tutuca lint --json` on a module with a handful
// of deliberate mistakes (one error/warn/hint of each common kind).
const brokenLintReport = {
  components: [
    { componentName: "Good", findings: [] },
    {
      componentName: "Broken",
      findings: [
        {
          id: "INPUT_HANDLER_METHOD_NOT_IMPLEMENTED",
          level: "error",
          info: { name: "missingMethod", eventName: "click", originAttr: "@on.click" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: null,
        },
        {
          id: "FIELD_VAL_NOT_DEFINED",
          level: "error",
          info: { tag: "SPAN", originAttr: "@text", val: { name: "nope" }, name: "nope" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: null,
        },
        {
          id: "REDUNDANT_TEMPLATE_STRING",
          level: "warn",
          info: { tag: "I", originAttr: ":class", simpler: ".title" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: { kind: "rewrite", from: "$'{.title}'", to: ".title" },
        },
        {
          id: "PLACEHOLDERLESS_TEMPLATE_STRING",
          level: "hint",
          info: { tag: "B", originAttr: ":class", literal: "'btn'" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: { kind: "rewrite", from: "$'btn'", to: "'btn'" },
        },
        {
          id: "FIELD_VAL_IS_METHOD",
          level: "error",
          info: { tag: "EM", originAttr: "@text", val: { name: "label" }, name: "label" },
          context: { componentName: "Broken", viewName: "main" },
          suggestion: { kind: "rewrite", from: ".label", to: "$label" },
        },
      ],
    },
  ],
};

const cleanLintReport = {
  components: [
    { componentName: "Good", findings: [] },
    { componentName: "AlsoGood", findings: [] },
  ],
};

// ── TestReport fixtures ─────────────────────────────────────────────────────────
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
const testRunReport = {
  modules: [
    {
      path: "src/widgets/counter.dev.js",
      counts: { pass: 3, fail: 1, skip: 1, total: 5 },
      suites: [
        {
          title: "Counter",
          componentName: "Counter",
          children: [
            { title: "starts at zero", status: "pass", durationMs: 1.2, error: null },
            { title: "inc adds one", status: "pass", durationMs: 0.8, error: null },
            {
              title: "edge cases",
              children: [
                {
                  title: "wraps at max",
                  status: "fail",
                  durationMs: 2.1,
                  error: { message: "expected 0 to be 10", expected: 10, actual: 0 },
                },
                { title: "decrements", status: "pass", durationMs: 0.5, error: null },
                { title: "async path", status: "skip", durationMs: 0, error: null },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ── sections ────────────────────────────────────────────────────────────────────
function componentSection() {
  const CI = ComponentInspector.Class;
  return {
    title: "10 · ComponentInspector",
    description:
      "Inspects a tutuca Component descriptor — the object returned by `component({...})`. Lays out the component's name, fields (with default values rendered via ImInspector), methods, the input/receive/bubble/response/alter handler channels, statics, and view source. Each section collapses/expands and paginates (10 items per page). Ctrl/Cmd-click a section header to expand or collapse every section at once; ctrl/cmd-click a view's arrow to do the same for all view sources.",
    items: [
      {
        title: "Minimal component",
        description: "Only a name, one field, and a view — Fields + Views only.",
        value: CI.fromData(Minimal),
      },
      {
        title: "Rich component (collapsed)",
        description:
          "Exercises every channel: fields, methods, input, receive, bubble, response, alter, statics, and two views.",
        value: CI.fromData(Rich),
      },
      { title: "Rich component (expanded)", value: expandSections(CI.fromData(Rich)) },
      {
        title: "Real component: JsonViewer (collapsed)",
        description: "Inspecting an actual in-repo component descriptor.",
        value: CI.fromData(JsonViewer),
      },
      { title: "Real component: JsonViewer (expanded)", value: expandSections(CI.fromData(JsonViewer)) },
      {
        title: "View HTML formatting (whitespace preserved)",
        description:
          "Each view's source collapses independently. Here the Views section and its view source are expanded, showing the multi-line template rendered verbatim — newlines and indentation preserved.",
        value: expandViews(CI.fromData(Formatted)),
      },
    ],
  };
}

function instanceSection() {
  const card = Sample.make({ title: "Hello", count: 3, tags: ["a", "b"], open: true });
  const viewer = JsonViewer.Class.fromData({ x: 1, y: [2, 3] });
  const orphan = Sample.make({ title: "no descriptor", count: 7 });

  const inspect = (inst) => InstanceInspector.Class.fromData(inst, compFor(inst));
  const explore = (inst) => InstanceExplorer.Class.fromData(inst, compFor(inst));

  return {
    title: "10 · InstanceInspector / InstanceExplorer",
    description:
      "InstanceInspector renders a component instance's field → value pairs (field names/types from the descriptor, values from the instance), reusing the data-inspector components. InstanceExplorer wraps an instance in up to four tabs — its values (Instance), its definition (Component), and, when provided, its test-run (Tests) and lint (Lint) results. A tab only appears when it has content. The instance and descriptor are passed in; tests/lint come as raw --json data or prebuilt inspectors.",
    items: [
      { title: "Instance inspector (collapsed)", value: inspect(card) },
      { title: "Instance inspector (expanded)", value: inspect(card).toggleIsExpanded() },
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
      { title: "Explorer — Instance tab (default)", value: explore(card) },
      { title: "Explorer — Component tab", value: explore(card).setActiveTab("component") },
      {
        title: "Explorer without a descriptor (Component tab shows a notice)",
        value: InstanceExplorer.Class.fromData(orphan, null).setActiveTab("component"),
      },
      {
        title: "Explorer — all four tabs (Tests tab)",
        description: "Instance + Component + Tests + Lint. Only tabs with content are shown.",
        value: InstanceExplorer.Class.fromData(card, Sample, {
          tests: explorerRunReport,
          lint: explorerLintReport,
        }).setActiveTab("tests"),
      },
      {
        title: "Explorer — all four tabs (Lint tab)",
        value: InstanceExplorer.Class.fromData(card, Sample, {
          tests: explorerRunReport,
          lint: explorerLintReport,
        }).setActiveTab("lint"),
      },
    ],
  };
}

function lintSection() {
  return {
    title: "10 · LintReport",
    description:
      "LintReport renders `tutuca lint --json`: a neutral title with soft severity tallies over per-component groups. Each finding shows a soft level badge, a human-readable message (mirroring the CLI's own wording), an optional fix suggestion, and the full id/info/context via ImInspector. Colour is reserved for severity; structure stays neutral. Clean components are omitted; a fully clean run shows a soft 'clean' badge.",
    items: [
      {
        title: "Module with findings (error component auto-expanded)",
        value: LintReport.Class.fromData(brokenLintReport, { title: "broken.js" }),
      },
      { title: "Clean module", value: LintReport.Class.fromData(cleanLintReport, { title: "good.js" }) },
    ],
  };
}

function testSection() {
  return {
    title: "10 · TestReport (definitions + run)",
    description:
      "TestReport renders either the test tree a module declares (TestReport.fromTests + collectTests, which walks getTests without running it) or a run report (TestReport.fromResults, the `tutuca test --json` shape). Suites collapse/paginate; failing suites auto-expand and show the message plus an expected/actual diff.",
    items: [
      {
        title: "Definitions — sample module",
        value: TestReport.Class.fromTests(collectTests(sampleTests), { title: "widget.dev.js" }),
      },
      {
        title: "Definitions — this file's ComponentInspector tests",
        description: "Collected live from a real module's getTests (without running it).",
        value: TestReport.Class.fromTests(collectTests(componentInspectorTests), {
          title: "component-inspector tests",
        }),
      },
      {
        title: "Run — mixed pass/fail/skip (failing suite auto-expanded)",
        value: TestReport.Class.fromResults(testRunReport),
      },
    ],
  };
}

export function getExamples() {
  return [componentSection(), instanceSection(), lintSection(), testSection()];
}

// ── tests (one function per component, composed into a single getTests) ─────────
// Ported verbatim from src/components/tutuca/*.dev.js.
function componentInspectorTests({ describe, test, expect }) {
  describe(ComponentInspector, () => {
    test("introspectComponent reads the descriptor name and id", () => {
      const d = introspectComponent(Rich);
      expect(d.name).toBe("RichSample");
      expect(typeof d.id).toBe("number");
    });

    test("introspectComponent reads fields with type and default", () => {
      const d = introspectComponent(Rich);
      const byName = Object.fromEntries(d.fields.map((f) => [f.name, f]));
      expect(d.fields.length).toBe(4);
      expect(byName.title.type).toBe("text");
      expect(byName.title.defaultValue).toBe("");
      expect(byName.count.type).toBe("float");
      expect(byName.count.defaultValue).toBe(0);
      expect(byName.tags.type).toBe("list");
      expect(byName.open.type).toBe("bool");
    });

    test("introspectComponent reads methods, channels, and statics", () => {
      const d = introspectComponent(Rich);
      expect(d.methods).toContain("label");
      expect(d.methods).toContain("double");
      expect(d.input).toEqual(["inc", "reset"]);
      expect(d.receive).toEqual(["ping"]);
      expect(d.bubble).toEqual(["onChild"]);
      expect(d.response).toEqual(["onData"]);
      expect(d.alter).toEqual(["rows"]);
      expect(d.statics).toEqual(["blank", "fromTitle"]);
    });

    test("introspectComponent reads view names and source", () => {
      const d = introspectComponent(Rich);
      const names = d.views.map((v) => v.name);
      expect(names).toContain("main");
      expect(names).toContain("compact");
      const main = d.views.find((v) => v.name === "main");
      expect(main.rawView).toContain(".title");
    });

    test("fromData builds one section per non-empty group", () => {
      const insp = ComponentInspector.Class.fromData(Rich);
      expect(insp.compName).toBe("RichSample");
      const labels = insp.sections.toArray().map((s) => s.label);
      expect(labels).toEqual([
        "Fields",
        "Methods",
        "Input",
        "Receive",
        "Bubble",
        "Response",
        "Alter",
        "Statics",
        "Views",
      ]);
    });

    test("fromData omits empty groups", () => {
      const insp = ComponentInspector.Class.fromData(Minimal);
      const labels = insp.sections.toArray().map((s) => s.label);
      expect(labels).toEqual(["Fields", "Views"]);
    });

    test("idText formats the descriptor id", () => {
      const insp = ComponentInspector.Class.fromData(Minimal);
      expect(insp.idText()).toBe(`#${insp.compId}`);
    });

    test("expandAll / collapseAll toggle every section", () => {
      const insp = ComponentInspector.Class.fromData(Rich);
      const allOpen = insp.expandAll().sections.toArray();
      expect(allOpen.every((s) => s.isExpanded)).toBe(true);
      const allClosed = insp.collapseAll().sections.toArray();
      expect(allClosed.some((s) => s.isExpanded)).toBe(false);
    });

    test("expandAllViews / collapseAllViews toggle only the view sources", () => {
      const insp = ComponentInspector.Class.fromData(Rich);
      const views = (i) =>
        i.sections
          .toArray()
          .find((s) => s.label === "Views")
          .items.toArray();
      expect(views(insp.expandAllViews()).every((v) => v.isExpanded)).toBe(true);
      expect(views(insp.collapseAllViews()).some((v) => v.isExpanded)).toBe(false);
      // a section that starts collapsed is left untouched by the views-only toggle
      // (Fields starts expanded via fromData, so check Methods instead)
      const methods = insp
        .expandAllViews()
        .sections.toArray()
        .find((s) => s.label === "Methods");
      expect(methods.isExpanded).toBe(false);
    });

    test("toggleAllSections bubble expands every section", () => {
      const insp = ComponentInspector.Class.fromData(Rich);
      const r = ComponentInspector.bubble.toggleAllSections.call(insp, true);
      expect(r.sections.toArray().every((s) => s.isExpanded)).toBe(true);
    });

    test("toggleAllViews bubble expands every view source", () => {
      const insp = ComponentInspector.Class.fromData(Rich);
      const r = ComponentInspector.bubble.toggleAllViews.call(insp, true);
      const views = r.sections
        .toArray()
        .find((s) => s.label === "Views")
        .items.toArray();
      expect(views.every((v) => v.isExpanded)).toBe(true);
    });
  });

  describe(CompSection, () => {
    const items = (n) => Array.from({ length: n }, (_, i) => CompName.make({ name: `n${i}` }));

    test("typeText is the label and countText is the size", () => {
      const s = CompSection.make({ label: "Fields", items: items(2) });
      expect(s.typeText()).toBe("Fields");
      expect(s.countText()).toBe("(2)");
    });

    test("small sections need no pagination", () => {
      const s = CompSection.make({ label: "Methods", items: items(3) });
      expect(s.pageCount()).toBe(1);
      expect(s.hasPagination()).toBe(false);
    });

    test("large sections paginate at 10 per page", () => {
      const s = CompSection.make({ label: "Fields", items: items(25) });
      expect(s.pageCount()).toBe(3);
      expect(s.hasPagination()).toBe(true);
    });

    test("plain toggle flips only this section", () => {
      const s = CompSection.make({ label: "Fields", items: items(1) });
      const r = CompSection.input.toggle.call(s, false, {});
      expect(r.isExpanded).toBe(true);
    });

    test("ctrl-toggle bubbles toggleAllSections with the target state", () => {
      const s = CompSection.make({ label: "Fields", items: items(1) });
      const calls = [];
      const ctx = { bubble: (name, args) => calls.push([name, args]) };
      const r = CompSection.input.toggle.call(s, true, ctx);
      expect(r).toBe(s);
      expect(calls).toEqual([["toggleAllSections", [true]]]);
    });
  });

  describe(CompView, () => {
    test("collapses and expands independently", () => {
      const v = CompView.make({ name: "main", rawView: "<i></i>" });
      expect(v.isExpanded).toBe(false);
      expect(v.arrowText()).toBe("▶");
      const open = v.toggleIsExpanded();
      expect(open.isExpanded).toBe(true);
      expect(open.arrowText()).toBe("▼");
    });

    test("preserves the raw view source verbatim", () => {
      const src = "<div>\n  <span></span>\n</div>";
      expect(CompView.make({ rawView: src }).rawView).toBe(src);
    });

    test("plain toggle flips only this view", () => {
      const v = CompView.make({ name: "main", rawView: "<i></i>" });
      const r = CompView.input.toggle.call(v, false, {});
      expect(r.isExpanded).toBe(true);
    });

    test("ctrl-toggle bubbles toggleAllViews with the target state", () => {
      const v = CompView.make({ name: "main", rawView: "<i></i>" });
      const calls = [];
      const ctx = { bubble: (name, args) => calls.push([name, args]) };
      const r = CompView.input.toggle.call(v, true, ctx);
      expect(r).toBe(v);
      expect(calls).toEqual([["toggleAllViews", [true]]]);
    });
  });
}

function instanceInspectorTests({ describe, test, expect }) {
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
        tests: explorerRunReport,
        lint: explorerLintReport,
      });
      expect(ex.hasTests).toBe(true);
      expect(ex.hasLint).toBe(true);
      expect(ex.testView).toBeInstanceOf(TestReport.Class);
      expect(ex.lintView).toBeInstanceOf(LintReport.Class);
    });

    test("accepts a prebuilt inspector instance for a tab", () => {
      const prebuilt = TestReport.Class.fromResults(explorerRunReport);
      const ex = InstanceExplorer.Class.fromData(card, Sample, { tests: prebuilt });
      expect(ex.testView).toBe(prebuilt);
    });

    test("setActiveTab switches the active tab", () => {
      const ex = InstanceExplorer.Class.fromData(card, Sample);
      expect(ex.setActiveTab("lint").activeTab).toBe("lint");
    });
  });
}

function lintTests({ describe, test, expect }) {
  describe(LintReport, () => {
    test("lintMessage renders prose with an origin suffix", () => {
      expect(
        lintMessage("FIELD_VAL_NOT_DEFINED", { name: "nope", originAttr: "@text", tag: "SPAN" }),
      ).toBe("Field '.nope' is not defined (in @text, on <span>)");
    });

    test("lintMessage humanizes unknown rule ids as a fallback", () => {
      expect(lintMessage("SOME_NEW_RULE", {})).toBe("Some new rule");
    });

    test("aggregates totals and omits clean components", () => {
      const r = LintReport.Class.fromData(brokenLintReport);
      expect(r.errors).toBe(3);
      expect(r.warnings).toBe(1);
      expect(r.hints).toBe(1);
      expect(r.clean).toBe(false);
      expect(r.components.size).toBe(1); // Good (no findings) omitted
    });

    test("clean report flags clean and has no component groups", () => {
      const r = LintReport.Class.fromData(cleanLintReport);
      expect(r.clean).toBe(true);
      expect(r.components.size).toBe(0);
    });
  });

  describe(LintComponent, () => {
    test("counts findings by level and expands on error", () => {
      const broken = LintReport.Class.fromData(brokenLintReport).components.first();
      expect(broken).toBeInstanceOf(LintComponent.Class);
      expect(broken.componentName).toBe("Broken");
      expect(broken.countText()).toBe("3 errors, 1 warning, 1 hint");
      expect(broken.isExpanded).toBe(true);
      expect(broken.items.size).toBe(5);
    });
  });

  describe(LintFinding, () => {
    test("error finding: level, human message, soft badge class", () => {
      const f = LintReport.Class.fromData(brokenLintReport).components.first().items.first();
      expect(f).toBeInstanceOf(LintFinding.Class);
      expect(f.level).toBe("error");
      expect(f.message).toBe("Method '$missingMethod' is not implemented in @on.click");
      expect(f.levelBadgeClass()).toContain("badge-soft");
      expect(f.levelBadgeClass()).toContain("badge-error");
    });

    test("warn finding surfaces the fix suggestion", () => {
      const items = LintReport.Class.fromData(brokenLintReport).components.first().items;
      const warn = items.get(2);
      expect(warn.level).toBe("warn");
      expect(warn.message).toContain("Redundant template string");
      expect(warn.suggestion).toBe("$'{.title}' → .title");
      expect(warn.levelBadgeClass()).toContain("badge-warning");
    });
  });
}

function testReportTests({ describe, test, expect }) {
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
      expect(widget.items.first().mark()).toBe("•");
    });

    test("fromResults carries totals and builds the suite tree", () => {
      const r = TestReport.Class.fromResults(testRunReport);
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
      const r = TestReport.Class.fromResults(testRunReport);
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
      const r = TestReport.Class.fromResults(testRunReport);
      const items = r.suites.first().items;
      expect(items.first().durText()).toBe("(1ms)");
      const edge = items.get(2);
      expect(edge.items.get(2).durText()).toBe("");
    });
  });
}

export function getTests(ctx) {
  componentInspectorTests(ctx);
  instanceInspectorTests(ctx);
  lintTests(ctx);
  testReportTests(ctx);
}
