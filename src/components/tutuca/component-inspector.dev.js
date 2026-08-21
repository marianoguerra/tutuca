import { component, html } from "tutuca";
import { produce } from "tutuca/immer";
import { JsonViewer } from "../data/json.js";
import {
  CompName,
  ComponentInspector,
  CompSection,
  CompView,
  introspectComponent,
} from "./component-inspector.js";

export { getComponents } from "./component-inspector.js";

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
  statics: {
    blank() {
      return this.make({});
    },
    fromTitle(t) {
      return this.make({ title: t });
    },
  },
  methods: {
    label() {
      return this.title;
    },
    double() {
      return this.count * 2;
    },
  },
  receive: {
    inc(draft) {
      draft.count = this.count + 1;
    },
    reset(draft) {
      draft.count = 0;
    },
    ping(draft) {
      return this;
    },
    onDataOk(draft) {
      return this;
    },
  },
  intent: {
    onChild(draft) {
      return this;
    },
  },
  alter: {
    rows() {
      return { start: 0, end: this.count };
    },
  },
  views: {
    compact: html`<span @text=".title"></span>`,
  },
  view: html`<div @text=".title"></div>`,
});

// A descriptor whose view template spans multiple indented lines — used to
// show that the raw source is displayed verbatim, preserving newlines and
// whitespace.
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

const update = (value, recipe, ...args) =>
  produce(value, (draft) => recipe.call(value, draft, ...args));
const expandSections = (insp) =>
  produce(insp, (draft) => {
    for (const section of draft.sections) section.isExpanded = true;
  });

// Expand the Views section AND each view's source block inside it.
const expandViews = (insp) =>
  produce(insp, (draft) => {
    const section = draft.sections.find((candidate) => candidate.label === "Views");
    if (!section) return;
    section.isExpanded = true;
    for (const view of section.items) view.isExpanded = true;
  });

export function getExamples() {
  const CI = ComponentInspector;

  return {
    title: "ComponentInspector",
    description:
      "Inspects a tutuca Component descriptor — the object returned by `component({...})`. Lays out the component's name, fields (with default values rendered via DataInspector), methods, the receive/intent handler buckets, statics, and view source. Each section collapses/expands and paginates (10 items per page). Ctrl/Cmd-click a section header to expand or collapse every section at once; ctrl/cmd-click a view's arrow to do the same for all view sources.",
    items: [
      {
        title: "Minimal component",
        description: "Only a name, one field, and a view — Fields + Views only.",
        value: CI.fromData(Minimal),
      },
      {
        title: "Rich component (collapsed)",
        description:
          "Exercises every bucket: fields, methods, receive, intent, alter, statics, and two views.",
        value: CI.fromData(Rich),
      },
      {
        title: "Rich component (expanded)",
        value: expandSections(CI.fromData(Rich)),
      },
      {
        title: "Real component: JsonViewer (collapsed)",
        description: "Inspecting an actual in-repo component descriptor.",
        value: CI.fromData(JsonViewer),
      },
      {
        title: "Real component: JsonViewer (expanded)",
        value: expandSections(CI.fromData(JsonViewer)),
      },
      {
        title: "View HTML formatting (whitespace preserved)",
        description:
          "Each view's source collapses independently. Here the Views section and its view source are expanded, showing the multi-line template rendered verbatim — newlines and indentation preserved.",
        value: expandViews(CI.fromData(Formatted)),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
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
      expect(byName.count.type).toBe("int");
      expect(byName.count.defaultValue).toBe(0);
      expect(byName.tags.type).toBe("list");
      expect(byName.open.type).toBe("bool");
    });

    test("introspectComponent reads methods, channels, and statics", () => {
      const d = introspectComponent(Rich);
      expect(d.methods).toContain("label");
      expect(d.methods).toContain("double");
      expect(d.receive).toEqual(["inc", "reset", "ping", "onDataOk"]);
      expect(d.intent).toEqual(["onChild"]);
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
      const insp = ComponentInspector.fromData(Rich);
      expect(insp.compName).toBe("RichSample");
      const labels = insp.sections.map((s) => s.label);
      expect(labels).toEqual([
        "Fields",
        "Methods",
        "Receive",
        "Intent",
        "Alter",
        "Statics",
        "Views",
      ]);
    });

    test("fromData omits empty groups", () => {
      const insp = ComponentInspector.fromData(Minimal);
      const labels = insp.sections.map((s) => s.label);
      expect(labels).toEqual(["Fields", "Views"]);
    });

    test("idText formats the descriptor id", () => {
      const insp = ComponentInspector.fromData(Minimal);
      expect(insp.idText()).toBe(`#${insp.compId}`);
    });

    test("expandAll / collapseAll toggle every section", () => {
      const insp = ComponentInspector.fromData(Rich);
      const allOpen = update(insp, ComponentInspector.intent.toggleAllSections, true).sections;
      expect(allOpen.every((s) => s.isExpanded)).toBe(true);
      const allClosed = update(insp, ComponentInspector.intent.toggleAllSections, false).sections;
      expect(allClosed.some((s) => s.isExpanded)).toBe(false);
    });

    test("expandAllViews / collapseAllViews toggle only the view sources", () => {
      const insp = ComponentInspector.fromData(Rich);
      const views = (i) => i.sections.find((s) => s.label === "Views").items;
      const expanded = update(insp, ComponentInspector.intent.toggleAllViews, true);
      const collapsed = update(insp, ComponentInspector.intent.toggleAllViews, false);
      expect(views(expanded).every((v) => v.isExpanded)).toBe(true);
      expect(views(collapsed).some((v) => v.isExpanded)).toBe(false);
      // a section that starts collapsed is left untouched by the views-only toggle
      // (Fields starts expanded via fromData, so check Methods instead)
      const methods = expanded.sections.find((s) => s.label === "Methods");
      expect(methods.isExpanded).toBe(false);
    });

    test("the toggleAllSections intent expands every section", () => {
      const insp = ComponentInspector.fromData(Rich);
      const r = update(insp, ComponentInspector.intent.toggleAllSections, true);
      expect(r.sections.every((s) => s.isExpanded)).toBe(true);
    });

    test("the toggleAllViews intent expands every view source", () => {
      const insp = ComponentInspector.fromData(Rich);
      const r = update(insp, ComponentInspector.intent.toggleAllViews, true);
      const views = r.sections.find((s) => s.label === "Views").items;
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
      const r = update(s, CompSection.receive.toggle, false, {});
      expect(r.isExpanded).toBe(true);
    });

    test("ctrl-toggle raises toggleAllSections with the target state", () => {
      const s = CompSection.make({ label: "Fields", items: items(1) });
      const calls = [];
      const ctx = { intent: (name, args) => calls.push([name, args]) };
      const r = update(s, CompSection.receive.toggle, true, ctx);
      expect(r).toBe(s);
      expect(calls).toEqual([["toggleAllSections", [true]]]);
    });
  });

  describe(CompView, () => {
    test("collapses and expands independently", () => {
      const v = CompView.make({ name: "main", rawView: "<i></i>" });
      expect(v.isExpanded).toBe(false);
      expect(v.arrowText()).toBe("▶");
      const open = produce(v, (draft) => {
        draft.isExpanded = true;
      });
      expect(open.isExpanded).toBe(true);
      expect(open.arrowText()).toBe("▼");
    });

    test("preserves the raw view source verbatim", () => {
      const src = "<div>\n  <span></span>\n</div>";
      expect(CompView.make({ rawView: src }).rawView).toBe(src);
    });

    test("plain toggle flips only this view", () => {
      const v = CompView.make({ name: "main", rawView: "<i></i>" });
      const r = update(v, CompView.receive.toggle, false, {});
      expect(r.isExpanded).toBe(true);
    });

    test("ctrl-toggle raises toggleAllViews with the target state", () => {
      const v = CompView.make({ name: "main", rawView: "<i></i>" });
      const calls = [];
      const ctx = { intent: (name, args) => calls.push([name, args]) };
      const r = update(v, CompView.receive.toggle, true, ctx);
      expect(r).toBe(v);
      expect(calls).toEqual([["toggleAllViews", [true]]]);
    });
  });
}
