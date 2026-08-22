import { component, html } from "tutuca";
import { DataInspector, getComponents as getDataComponents } from "../data/data.js";
import {
  compositeAlter,
  compositeFields,
  compositeMethods,
  compositeReceive,
  makeCompositeView,
} from "../data/json.js";

// Inspect a Component — the class returned by `component({...})`, not a
// `.make()` instance. The shape mirrors `getComponentDoc` in tutuca's dev
// build but also covers the receive/intent/alter channels, statics, and
// view source. Pure and deterministic, so it is the unit the tests assert on.
export function introspectComponent(comp) {
  const { fields, methods } = comp;
  return {
    name: comp.name,
    id: comp.id,
    fields: Object.entries(fields).map(([name, f]) => ({
      name,
      type: f.type,
      defaultValue: f.defaultValue,
    })),
    methods: Object.keys(methods),
    receive: Object.keys(comp.receive ?? {}),
    intent: Object.keys(comp.intent ?? {}),
    alter: Object.keys(comp.alter ?? {}),
    statics: Object.keys(comp.spec?.statics ?? {}),
    views: Object.values(comp.views ?? {}).map((v) => ({
      name: v.name,
      rawView: v.rawView,
    })),
  };
}

const sectionView = makeCompositeView({
  // Neutral chrome: hierarchy via weight, colour reserved for status/severity
  // (kept consistent across the instance / component / tests / lint inspectors).
  typeClass: "font-semibold",
  borderClass: "border-base-content/15",
  // Plain click toggles this section; ctrl/cmd-click bubbles up so the
  // inspector can toggle every section at once.
  toggleHandler: "toggle e.isCtrl",
});

// A single name entry — used for methods, handlers (receive/intent/
// alter), and statics, all of which are just lists of names.
export const CompName = component({
  name: "CompName",
  fields: { name: "" },
  view: html`<span
    class="font-mono text-sm leading-tight badge badge-sm badge-ghost"
    @text=".name"
  ></span>`,
});

// A single field row: `name : type = <default value>`. The default value is
// rendered with DataInspector so native values display nicely and recurse.
export const CompField = component({
  name: "CompField",
  fields: { name: "", typeName: "", child: null },
  view: html`<div class="flex items-center gap-2 leading-tight">
    <span class="text-base-content/70 font-mono text-sm" @text=".name"></span>
    <span class="text-base-content/30">:</span>
    <span class="text-base-content/50 font-mono text-xs" @text=".typeName"></span>
    <span class="text-base-content/30">=</span>
    <x render=".child"></x>
  </div>`,
});

// A single view: its name plus the raw html template source in a code block.
// The source collapses/expands independently so long templates can be hidden.
// Plain click toggles this view; ctrl/cmd-click bubbles up to toggle them all.
export const CompView = component({
  name: "CompView",
  fields: { name: "", rawView: "", isExpanded: false },
  methods: {
    arrowText() {
      return this.isExpanded ? "▼" : "▶";
    },
  },
  receive: {
    ...compositeReceive,
    toggle(draft, isCtrl, ctx) {
      if (isCtrl) {
        ctx.intent("toggleAllViews", [!this.isExpanded], { route: ["dyn"] });
        return this;
      }
      draft.isExpanded = !draft.isExpanded;
    },
  },
  view: html`<div class="flex flex-col gap-0.5 leading-tight">
    <button
      type="button"
      class="cursor-pointer text-base-content/70 hover:text-base-content inline-flex items-center gap-1 self-start"
      @on.click="toggle e.isCtrl"
    >
      <span @text="$arrowText"></span>
      <span class="font-mono text-sm" @text=".name"></span>
    </button>
    <pre
      @show=".isExpanded"
      class="text-xs bg-base-200 rounded p-2 overflow-x-auto whitespace-pre-wrap"
    ><code @text=".rawView"></code></pre>
  </div>`,
});

// A labelled, collapsible, paginated group of entries. Reuses the same
// composite machinery the data inspectors use.
export const CompSection = component({
  name: "CompSection",
  fields: { ...compositeFields, label: "" },
  methods: {
    ...compositeMethods,
    typeText() {
      return this.label;
    },
    countText() {
      return `(${this.items.length})`;
    },
  },
  receive: {
    ...compositeReceive,
    toggle(draft, isCtrl, ctx) {
      if (isCtrl) {
        ctx.intent("toggleAllSections", [!this.isExpanded], { route: ["dyn"] });
        return this;
      }
      draft.isExpanded = !draft.isExpanded;
    },
  },
  alter: compositeAlter,
  view: sectionView,
});

// Top-level wrapper: introspect a descriptor and lay out one CompSection per
// non-empty group. Empty groups are omitted.
export const ComponentInspector = component({
  name: "ComponentInspector",
  fields: { compName: "", compId: 0, sections: [] },
  statics: {
    fromData(comp) {
      const d = introspectComponent(comp);
      const sections = [];
      const add = (label, items, isExpanded = false) => {
        if (items.length > 0) {
          sections.push(CompSection.make({ label, items, isExpanded }));
        }
      };
      const names = (list) => list.map((name) => CompName.make({ name }));

      // Fields start expanded — the most useful section when inspecting a component.
      add(
        "Fields",
        d.fields.map((f) =>
          CompField.make({
            name: f.name,
            typeName: f.type,
            child: DataInspector.fromData(f.defaultValue),
          }),
        ),
        true,
      );
      add("Methods", names(d.methods));
      add("Receive", names(d.receive));
      add("Intent", names(d.intent));
      add("Alter", names(d.alter));
      add("Statics", names(d.statics));
      add(
        "Views",
        d.views.map((v) => CompView.make({ name: v.name, rawView: v.rawView })),
      );

      return this.make({ compName: d.name, compId: d.id, sections });
    },
  },
  methods: {
    idText() {
      return `#${this.compId}`;
    },
  },
  intent: {
    toggleAllSections(draft, state) {
      for (const section of draft.sections) section.isExpanded = state;
    },
    toggleAllViews(draft, state) {
      const section = draft.sections.find((candidate) => candidate.label === "Views");
      if (section) for (const view of section.items) view.isExpanded = state;
    },
  },
  view: html`<div class="font-mono text-sm leading-tight flex flex-col gap-1">
    <div class="inline-flex items-center gap-2">
      <span class="font-semibold" @text=".compName"></span>
      <span class="text-base-content/40 text-xs" @text="$idText"></span>
    </div>
    <x render-each=".sections"></x>
  </div>`,
});

export function getComponents() {
  // The data inspector set (which itself includes the JSON leaf components)
  // is registered too so that field default values rendered via
  // `<x render=".child">` resolve to real components.
  return [ComponentInspector, CompSection, CompField, CompName, CompView, ...getDataComponents()];
}
