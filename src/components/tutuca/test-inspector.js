import { component, html } from "tutuca";
import { getComponents as getImComponents, ImInspector } from "../data/immutable-inspector.js";
import {
  compositeAlter,
  compositeFields,
  compositeMethods,
  makeCompositeView,
} from "../data/json.js";

// Collect the test tree a module's `getTests` defines WITHOUT running it.
// We pass collector versions of describe/test (the framework's own collector,
// makeCollector in tutuca-cli.js, works the same way); the test bodies are
// never invoked, so `expect`/`drive` are inert. Returns plain suite nodes:
//   suite = { title, children: [node] }   test = { title }
export function collectTests(getTests) {
  const root = { children: [] };
  const stack = [root];
  const describe = (head, optsOrFn, maybeFn) => {
    const fn = typeof maybeFn === "function" ? maybeFn : optsOrFn;
    const title = typeof head === "string" ? head : (head?.name ?? String(head));
    const node = { title, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
    try {
      fn();
    } finally {
      stack.pop();
    }
  };
  const test = (title) => {
    stack[stack.length - 1].children.push({ title });
  };
  const noop = () => {};
  getTests({ describe, test, expect: noop, drive: async () => null });
  return root.children;
}

const suiteView = makeCompositeView({
  // Suite titles lean on weight, not colour, for hierarchy; colour is left to
  // the status marks (✓/✗/○) and the soft tally badges.
  typeClass: "font-semibold",
  borderClass: "border-base-content/15",
  // Plain click toggles this suite; ctrl/cmd-click bubbles up to TestReport so
  // it can expand/collapse every suite at once (like the component inspector).
  toggleHandler: "toggle isCtrl",
});

// One test: a status mark (✓/✗/○, or • when this is a definition with no run
// status), the title, run duration, and — on failure — the message plus an
// expected/actual diff rendered via ImInspector.
export const TestCase = component({
  name: "TestCase",
  fields: { title: "", status: "", durationMs: 0, message: "", detail: null },
  methods: {
    mark() {
      switch (this.status) {
        case "pass":
          return "✓";
        case "fail":
          return "✗";
        case "skip":
          return "○";
        default:
          return "•";
      }
    },
    markClass() {
      const base = "font-mono text-sm";
      switch (this.status) {
        case "pass":
          return `${base} text-success`;
        case "fail":
          return `${base} text-error`;
        default:
          return `${base} text-base-content/40`;
      }
    },
    durText() {
      return this.status && this.status !== "skip" ? `(${Math.round(this.durationMs)}ms)` : "";
    },
    hasMessage() {
      return this.message !== "";
    },
    hasDetail() {
      return this.detail != null;
    },
  },
  // Decoy so the runtime-built mark colors survive the margaui class scan.
  views: {
    _palette: html`<span class="text-success text-error text-base-content/40"></span>`,
  },
  view: html`<div class="flex flex-col gap-0.5 leading-tight">
    <div class="flex items-center gap-2">
      <span :class="$markClass" @text="$mark"></span>
      <span class="font-mono text-sm" @text=".title"></span>
      <span class="text-base-content/40 text-xs" @text="$durText"></span>
    </div>
    <div @show="$hasMessage" class="ml-5 text-error text-xs" @text=".message"></div>
    <div @show="$hasDetail" class="ml-5"><x render=".detail"></x></div>
  </div>`,
});

// A describe block: collapsible/paginated container of child suites/cases.
// For a run, `summary` carries the pass/fail/skip tally; for definitions it is
// empty and the item count is shown instead.
export const TestSuite = component({
  name: "TestSuite",
  fields: { ...compositeFields, title: "", summary: "" },
  methods: {
    ...compositeMethods,
    typeText() {
      return this.title;
    },
    countText() {
      return this.summary || `(${this.items.size})`;
    },
  },
  input: {
    toggle(isCtrl, ctx) {
      if (isCtrl) {
        ctx.bubble("toggleAll", [!this.isExpanded]);
        return this;
      }
      return this.toggleIsExpanded();
    },
  },
  alter: compositeAlter,
  view: suiteView,
});

// Recursively set isExpanded on a suite and every nested suite (TestCase leaves
// have no isExpanded and are left untouched).
function setSuiteTreeExpanded(node, state) {
  if (typeof node.setIsExpanded !== "function") return node;
  return node.setIsExpanded(state).setItems(node.items.map((c) => setSuiteTreeExpanded(c, state)));
}

function buildDefNode(node) {
  if (Array.isArray(node.children)) {
    return TestSuite.make({
      title: node.title,
      items: node.children.map(buildDefNode),
    });
  }
  return TestCase.make({ title: node.title });
}

function buildResultNode(node) {
  if (Array.isArray(node.children)) {
    const built = node.children.map(buildResultNode);
    const pass = built.reduce((n, b) => n + b.pass, 0);
    const fail = built.reduce((n, b) => n + b.fail, 0);
    const skip = built.reduce((n, b) => n + b.skip, 0);
    const summary = `✓${pass}${fail ? ` ✗${fail}` : ""}${skip ? ` ○${skip}` : ""}`;
    const comp = TestSuite.make({
      title: node.title,
      summary,
      items: built.map((b) => b.comp),
      isExpanded: fail > 0,
    });
    return { comp, pass, fail, skip };
  }
  const status = node.status ?? "";
  const err = node.error ?? null;
  const hasDiff = err != null && ("expected" in err || "actual" in err);
  const comp = TestCase.make({
    title: node.title,
    status,
    durationMs: node.durationMs ?? 0,
    message: err?.message ?? "",
    detail: hasDiff
      ? ImInspector.Class.fromData({ expected: err.expected, actual: err.actual })
      : null,
  });
  return {
    comp,
    pass: status === "pass" ? 1 : 0,
    fail: status === "fail" ? 1 : 0,
    skip: status === "skip" ? 1 : 0,
  };
}

// Top-level: a header (title + path + pass/fail/skip badges for a run) over the
// suite tree. `fromTests` renders the definitions a module declares;
// `fromResults` renders a run report (the `tutuca test --json` shape).
export const TestReport = component({
  name: "TestReport",
  fields: {
    title: "",
    path: "",
    pass: 0,
    fail: 0,
    skip: 0,
    hasCounts: false,
    suites: [],
  },
  methods: {
    passText() {
      return `✓ ${this.pass}`;
    },
    failText() {
      return `✗ ${this.fail}`;
    },
    skipText() {
      return `○ ${this.skip}`;
    },
    hasFailures() {
      return this.hasCounts && this.fail > 0;
    },
    hasSkips() {
      return this.hasCounts && this.skip > 0;
    },
    setAllSuites(state) {
      return this.setSuites(this.suites.map((s) => setSuiteTreeExpanded(s, state)));
    },
  },
  bubble: {
    // ctrl/cmd-click on any suite expands/collapses the whole tree at once.
    toggleAll(state) {
      return this.setAllSuites(state);
    },
  },
  statics: {
    fromTests(source, { title = "Tests", path = "" } = {}) {
      const suites = Array.isArray(source) ? source : (source?.suites ?? []);
      return this.make({
        title,
        path,
        hasCounts: false,
        suites: suites.map(buildDefNode),
      });
    },
    fromResults(report) {
      const mod = report?.modules ? report.modules[0] : report;
      const { path = "", suites = [], counts = {} } = mod ?? {};
      return this.make({
        title: "Test run",
        path,
        pass: counts.pass ?? 0,
        fail: counts.fail ?? 0,
        skip: counts.skip ?? 0,
        hasCounts: true,
        suites: suites.map((s) => buildResultNode(s).comp),
      });
    },
  },
  view: html`<div class="font-mono text-sm leading-tight flex flex-col gap-1">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="font-semibold" @text=".title"></span>
      <span class="text-base-content/40 text-xs" @text=".path"></span>
      <span
        @show=".hasCounts"
        class="badge badge-sm badge-soft badge-success"
        @text="$passText"
      ></span>
      <span
        @show="$hasFailures"
        class="badge badge-sm badge-soft badge-error"
        @text="$failText"
      ></span>
      <span
        @show="$hasSkips"
        class="badge badge-sm badge-soft badge-neutral"
        @text="$skipText"
      ></span>
    </div>
    <x render-each=".suites"></x>
  </div>`,
});

export function getComponents() {
  return [TestReport, TestSuite, TestCase, ...getImComponents()];
}
