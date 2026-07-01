import { component, html, isRecord } from "tutuca";
import { ImEntry, ImInspector } from "../data/immutable-inspector.js";
import {
  compositeAlter,
  compositeFields,
  compositeMethods,
  makeCompositeView,
  makeValueInspector,
} from "../data/json.js";
import {
  ComponentInspector,
  getComponents as getComponentInspectorComponents,
  introspectComponent,
} from "./component-inspector.js";
import { getComponents as getLintComponents, LintReport } from "./lint-inspector.js";
import { getComponents as getTestComponents, TestReport } from "./test-inspector.js";

// True for a tutuca component *instance* (a Record whose Class carries the
// generated `getMetaClass` static). Mirrors the framework's own type probe
// `getTypeName = (v) => v?.constructor?.getMetaClass?.()?.name` (tutuca.js).
export const isComponentInstance = (v) =>
  isRecord(v) && typeof v?.constructor?.getMetaClass === "function";

const fieldsView = makeCompositeView({
  typeClass: "font-semibold",
  borderClass: "border-base-content/15",
});

// The field → value rows of an instance. Field names/order come from the
// descriptor (decoupled from the instance internals); values come from the
// instance. Reuses ImEntry + ImInspector so every value renders (and recurses)
// like the other data inspectors.
export const InstanceFields = component({
  name: "InstanceFields",
  fields: { ...compositeFields, typeName: "" },
  methods: {
    ...compositeMethods,
    typeText() {
      return this.typeName;
    },
    countText() {
      return `{${this.items.size}}`;
    },
  },
  alter: compositeAlter,
  statics: {
    fromData(instance, comp) {
      const d = introspectComponent(comp);
      const items = d.fields.map((f) =>
        ImEntry.make({
          key: f.name,
          child: ImInspector.Class.fromData(instance.get(f.name)),
        }),
      );
      // Start expanded — the field → value rows are the point of this view.
      return this.make({ typeName: d.name, items, isExpanded: true });
    },
  },
  view: fieldsView,
});

// Thin wrapper around the rendered value, mirroring ImInspector/JsonViewer.
// Given an instance and its descriptor it shows the field → value rows; with
// no descriptor (or a non-instance) it falls back to the plain data inspector.
export const InstanceInspector = makeValueInspector({
  name: "InstanceInspector",
  fromData(instance, comp) {
    const value =
      comp && isComponentInstance(instance)
        ? InstanceFields.Class.fromData(instance, comp)
        : ImInspector.Class.fromData(instance);
    return this.make({ value });
  },
});

// Coerce a tab input that may be raw report data OR an already-built inspector
// component instance into the right component (or null when absent).
function asTestView(tests) {
  if (tests == null) return null;
  return isComponentInstance(tests) ? tests : TestReport.Class.fromResults(tests);
}
function asLintView(lint) {
  if (lint == null) return null;
  return isComponentInstance(lint) ? lint : LintReport.Class.fromData(lint);
}

// Up to four tabs over one instance: its values (InstanceInspector), its
// definition (ComponentInspector), and — when provided — its test-run and lint
// results (TestReport / LintReport). The instance and its descriptor are passed
// in; tests/lint come via opts as raw `--json` data or prebuilt inspectors. A
// tab only appears when it has content.
export const InstanceExplorer = component({
  name: "InstanceExplorer",
  fields: {
    activeTab: "instance",
    instanceView: null,
    componentView: null,
    testView: null,
    lintView: null,
    hasComponent: false,
    hasTests: false,
    hasLint: false,
  },
  statics: {
    fromData(instance, comp, { tests = null, lint = null } = {}) {
      const testView = asTestView(tests);
      const lintView = asLintView(lint);
      return this.make({
        instanceView: InstanceInspector.Class.fromData(instance, comp),
        componentView: comp ? ComponentInspector.Class.fromData(comp) : null,
        testView,
        lintView,
        hasComponent: !!comp,
        hasTests: !!testView,
        hasLint: !!lintView,
      });
    },
  },
  view: html`<div class="font-mono text-sm leading-snug flex flex-col gap-3">
    <div role="tablist" class="tabs">
      <a
        role="tab"
        @if.class="equals? .activeTab 'instance'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveTab 'instance'"
      >
        Instance
      </a>
      <a
        role="tab"
        @show=".hasComponent"
        @if.class="equals? .activeTab 'component'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveTab 'component'"
      >
        Component
      </a>
      <a
        role="tab"
        @show=".hasTests"
        @if.class="equals? .activeTab 'tests'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveTab 'tests'"
      >
        Tests
      </a>
      <a
        role="tab"
        @show=".hasLint"
        @if.class="equals? .activeTab 'lint'"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setActiveTab 'lint'"
      >
        Lint
      </a>
    </div>
    <div @show="equals? .activeTab 'instance'">
      <x render=".instanceView"></x>
    </div>
    <div @show="equals? .activeTab 'component'">
      <div @show=".hasComponent"><x render=".componentView"></x></div>
      <div @hide=".hasComponent" class="text-base-content/50 text-xs">
        Pass the Component descriptor to inspect its definition.
      </div>
    </div>
    <div @show="equals? .activeTab 'tests'">
      <x render=".testView"></x>
    </div>
    <div @show="equals? .activeTab 'lint'">
      <x render=".lintView"></x>
    </div>
  </div>`,
});

export function getComponents() {
  // Pull in every inspector a tab might render (component / test / lint, each
  // of which already includes the Immutable+JSON leaves), deduped by name so
  // the shared sets aren't registered more than once.
  const all = [
    InstanceExplorer,
    InstanceInspector,
    InstanceFields,
    ...getComponentInspectorComponents(),
    ...getTestComponents(),
    ...getLintComponents(),
  ];
  const seen = new Set();
  return all.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}
