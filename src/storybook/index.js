// Storybook engine: the Storybook/Section/Example components plus the pure
// aggregation (buildStorybook) and bootstrap (mountStorybook) helpers. It imports
// ONLY from the bare "tutuca" specifier so the shipped dist/tutuca-storybook.js
// stays a single external import — consumers wire an import map pointing "tutuca"
// at the same runtime their story modules use, guaranteeing one tutuca instance.
//
// CSS is decoupled: mountStorybook takes a compileCss(app) callback instead of
// importing margaui or the extra tier. When omitted the storybook renders
// functional but unstyled. The inspector tab views are decoupled the same way:
// rendering comes from tutuca/components, lint/test DATA from the injected `dev`.
import { component, dispatchPhase, html, injectCss, phaseHasBubble, tutuca } from "tutuca";
import { getComponents as getInspectorComponents } from "tutuca/components";
import { attachInspectorViews } from "./inspect.js";

const Storybook = component({
  name: "Storybook",
  fields: {
    selectedSectionIndex: 0,
    sections: [],
    // Retained navigation tree (SidebarGroup → SidebarEntry), built once from
    // `sections` and then mutated in place: selection flips entry `selected`, the
    // filter walk sets entry/group `visible`, a header click flips group `collapsed`.
    // It owns its own UI state — never rebuilt or projected from `sections`.
    sidebar: [],
    filter: "",
    sectionId: null,
    exampleId: null,
    focusExample: null,
    sidebarCollapsed: false,
  },
  statics: {
    // Build a storybook whose sidebar tree is derived from `sections` once. Use this
    // instead of a bare `make` anywhere a Storybook is constructed by hand (the
    // engine itself, the getRoot/Inception demo) so the sidebar is never empty.
    withSections(sections) {
      return this.make({ sections, sidebar: buildSidebar(sections) });
    },
  },
  methods: {
    selectSectionAtIndex(index) {
      if (this.sections.size === 0) return this;
      const safeIndex = index >= 0 && index < this.sections.size ? index : 0;
      // Selection only moves the content index and flips the sidebar highlight — the
      // `sections` list is left untouched (no per-selection instance churn).
      return this.setSelectedSectionIndex(safeIndex).markSidebarSelected(
        this.sections.get(safeIndex)?.id,
      );
    },
    // Flip the `selected` highlight to the entry for `id`, clearing the rest.
    markSidebarSelected(id) {
      return this.setSidebar(
        this.sidebar.map((g) => g.setRows(g.rows.map((e) => e.setSelected(e.sectionId === id)))),
      );
    },
    // Walk the tree setting each row's `visible` from the filter AND the group's
    // collapse: a row is visible iff it passes the filter (every row passes when the
    // filter is empty) AND its group is open — collapse always wins, so a collapsed
    // group shows no rows even while filtering. The group's own `visible` is set from
    // whether any row MATCHES (ignoring collapse), so a collapsed group that still
    // contains matches keeps its header and stays expandable; with no filter every
    // group shows.
    applyFilterToSidebar(filter) {
      const active = (filter ?? "") !== "";
      return this.setSidebar(
        this.sidebar.map((g) => {
          let anyMatch = false;
          const rows = g.rows.map((e) => {
            const match = !active || fuzzyMatch(filter, `${e.title} ${e.description}`);
            if (match) anyMatch = true;
            return e.setVisible(match && !g.collapsed);
          });
          return g.setRows(rows).setVisible(active ? anyMatch : true);
        }),
      );
    },
    // Flip a named group's `collapsed`, recomputing its rows' visibility for the new
    // state against the current filter. Collapsing always hides the rows (even while a
    // filter is active — the reported chevron-flips-but-content-stays case); expanding
    // re-reveals the rows that pass the filter. The group header's own `visible` is left
    // as-is, so a collapsed group that matched the filter stays visible to be reopened.
    toggleSidebarGroup(name) {
      const filter = this.filter;
      const active = filter !== "";
      return this.setSidebar(
        this.sidebar.map((g) => {
          if (g.name !== name) return g;
          const collapsed = !g.collapsed;
          const rows = g.rows.map((e) => {
            const match = !active || fuzzyMatch(filter, `${e.title} ${e.description}`);
            return e.setVisible(match && !collapsed);
          });
          return g.setCollapsed(collapsed).setRows(rows);
        }),
      );
    },
    selectSectionWithId(id) {
      if (!id) return this.selectSectionAtIndex(this.selectedSectionIndex);
      const index = this.sections.findIndex((s) => s.id === id);
      return this.selectSectionAtIndex(index);
    },
    focusExampleByIds(sectionId, exampleId) {
      if (!sectionId || !exampleId) {
        return this;
      }
      const section = this.sections.find((s) => s.id === sectionId);
      const example = section?.items.find((e) => e.id === exampleId);
      if (!example) {
        return this;
      }
      return this.setSectionId(sectionId).setExampleId(exampleId).setFocusExample(example.value);
    },
    setSelectedSectionFilter(value) {
      if (this.sections.size === 0) return this;
      const i = this.selectedSectionIndex;
      const sections = this.sections.map((s, idx) => (idx === i ? s.setFilter(value ?? "") : s));
      return this.setSections(sections);
    },
    // Assemble the full URL snapshot from current state. `overrides` carries the
    // change the calling handler is about to make, since `this` is still the
    // pre-change state when the persistState request is issued.
    toUrlState(overrides = {}) {
      const section = this.sections.get(this.selectedSectionIndex);
      return {
        section: section?.id ?? "",
        example: this.exampleId ?? "",
        sectionFilter: this.filter ?? "",
        exampleFilter: section?.filter ?? "",
        ...overrides,
      };
    },
  },
  alter: {
    // The sidebar render-each shows only visible groups (kept positional via `when`
    // so a click resolves to the right group — see SidebarGroup.rowVisible).
    groupVisible(_key, group) {
      return group.visible;
    },
  },
  input: {
    onApplyFilter(value, ctx) {
      ctx.request("persistState", [this.toUrlState({ sectionFilter: value }), this, false]);
      return this.setFilter(value).applyFilterToSidebar(value);
    },
    onClearFilter(ctx) {
      ctx.request("persistState", [this.toUrlState({ sectionFilter: "" }), this, false]);
      return this.resetFilter().applyFilterToSidebar("");
    },
    onFocusClose(ctx) {
      ctx.request("persistState", [this.toUrlState({ example: "" }), this, true]);
      return this.setSectionId(null).setExampleId(null).setFocusExample(null);
    },
  },
  bubble: {
    // A sidebar entry was clicked; it bubbles its section id. Resolve to the content
    // index and select. Sidebar highlight is updated by selectSectionAtIndex.
    sectionSelected(sectionId, ctx) {
      ctx.stopPropagation();
      const section = this.sections.find((s) => s.id === sectionId);
      ctx.request("persistState", [
        this.toUrlState({ section: sectionId, exampleFilter: section?.filter ?? "" }),
        this,
        true,
      ]);
      const oldIndex = this.selectedSectionIndex;
      const next = this.selectSectionAtIndex(this.sections.findIndex((s) => s.id === sectionId));
      transitionSections(ctx, next, oldIndex, next.selectedSectionIndex);
      return next;
    },
    // Toggle a group open/closed in place — the collapse lives on the SidebarGroup.
    groupToggled(name, ctx) {
      ctx.stopPropagation();
      return this.toggleSidebarGroup(name);
    },
    exampleFocusRequested(example, ctx) {
      ctx.stopPropagation();
      const section = this.sections.get(this.selectedSectionIndex);
      const sectionId = section?.id ?? null;
      ctx.request("persistState", [this.toUrlState({ example: example.id }), this, true]);
      return this.setSectionId(sectionId).setExampleId(example.id).setFocusExample(example.value);
    },
    exampleFilterChanged(value, ctx) {
      ctx.stopPropagation();
      ctx.request("persistState", [this.toUrlState({ exampleFilter: value }), this, false]);
      return this;
    },
  },
  receive: {
    init(ctx) {
      ctx.request("loadState", []);
      return this;
    },
  },
  response: {
    loadState(state, err, ctx) {
      if (err || !state) return this;
      // selectSectionWithId marks the sidebar highlight; applyFilterToSidebar then
      // applies the restored section filter to the tree's visibility.
      const selected = this.selectSectionWithId(state.section)
        .setFilter(state.sectionFilter ?? "")
        .applyFilterToSidebar(state.sectionFilter ?? "")
        .setSelectedSectionFilter(state.exampleFilter ?? "");
      const next = state.example
        ? selected.focusExampleByIds(state.section, state.example)
        : selected.setSectionId(null).setExampleId(null).setFocusExample(null);
      transitionSections(ctx, next, this.selectedSectionIndex, next.selectedSectionIndex);
      return next;
    },
  },
  view: html`<div>
    <div class="flex flex-col gap-3 p-3 h-screen" @show="truthy? .focusExample">
      <div class="flex justify-end">
        <button class="btn btn-ghost btn-sm" @on.click="onFocusClose">
          close
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <x render=".focusExample"></x>
      </div>
    </div>
    <div class="flex gap-3 p-3 h-screen" @hide="truthy? .focusExample">
      <button
        class="btn btn-ghost btn-sm self-start"
        title="Show sections"
        @show=".sidebarCollapsed"
        @on.click="$toggleSidebarCollapsed"
      >
        »
      </button>
      <div
        class="w-1/4 flex flex-col gap-3 bg-base-100 shadow-md h-full overflow-hidden"
        @hide=".sidebarCollapsed"
      >
        <div class="flex gap-2 items-center">
          <button
            class="btn btn-ghost btn-sm"
            title="Hide sections"
            @on.click="$toggleSidebarCollapsed"
          >
            «
          </button>
          <input
            class="input flex-1 focus:outline-none focus-within:outline-none focus:bg-base-200"
            type="search"
            placeholder="Filter sections"
            :value=".filter"
            @on.input="onApplyFilter value"
            @on.keydown.cancel="onClearFilter"
          />
        </div>
        <div class="list h-full flex-1 overflow-y-auto">
          <x render-each=".sidebar" when="groupVisible"></x>
        </div>
      </div>
      <div class="w-full h-full overflow-y-auto">
        <x render=".sections[.selectedSectionIndex]"></x>
      </div>
    </div>
  </div>`,
});

const Section = component({
  name: "Section",
  fields: {
    id: "?",
    title: "No Title Section",
    description: "",
    // Optional 2-level grouping: sections sharing a `group` name cluster under one
    // collapsible sidebar header. Empty string = ungrouped (top-level, flat — the
    // default and the backward-compatible behavior).
    group: "",
    items: [],
    filter: "",
    initialized: false,
  },
  statics: {
    fromData(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.title == null) {
        throw new Error(
          `Section.fromData: expected a section object { title, items }, got ${JSON.stringify(raw)}. ` +
            `getExamples() must return a section object or an array of section objects.`,
        );
      }
      const { id, title, description = "", group, items = [] } = raw;
      return this.make({
        id: id ?? slugify(title),
        title,
        description,
        // `group` is an optional string (single 2-level grouping). A non-string is
        // ignored here (rendered ungrouped) rather than coerced; the normalize layer
        // (tools/core/module.js) reports it as a shape error.
        group: typeof group === "string" ? group : "",
        items: items.map((v) => Example.Class.fromData(v)),
      });
    },
  },
  alter: {
    filterItem(_key, item) {
      return this.filter === "" || fuzzyMatch(this.filter, `${item.title} ${item.description}`);
    },
  },
  input: {
    onApplyFilter(value, ctx) {
      ctx.bubble("exampleFilterChanged", [value]);
      return this.setFilter(value);
    },
    onClearFilter(ctx) {
      ctx.bubble("exampleFilterChanged", [""]);
      return this.resetFilter();
    },
  },
  receive: {
    // First display of this section: run each example's `on.init`, mark shown.
    init(ctx) {
      fanoutLifecycle(ctx, this.items, "init");
      return this.setInitialized(true);
    },
    resume(ctx) {
      fanoutLifecycle(ctx, this.items, "resume");
      return this;
    },
    suspend(ctx) {
      fanoutLifecycle(ctx, this.items, "suspend");
      return this;
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div class="sticky top-0 z-10 bg-base-100 pt-1 pb-2 shadow-sm">
      <h2 class="text-lg font-bold" @text=".title"></h2>
      <p class="text-md italic opacity-60" @text=".description"></p>
    </div>
    <input
      class="input w-full outline-0 focus:bg-base-200"
      type="search"
      placeholder="Filter examples"
      :value=".filter"
      @on.input="onApplyFilter value"
      @on.keydown.cancel="onClearFilter"
    />
    <div class="flex flex-col gap-3">
      <x render-each=".items" when="filterItem"></x>
    </div>
  </section>`,
});

// The retained sidebar tree. A SidebarEntry is one clickable section row carrying its
// own UI state — `selected` (highlight) and `visible` (filter result) — plus the id it
// selects. It is built once and only its fields are flipped; it never re-derives from
// the content `sections`.
const SidebarEntry = component({
  name: "SidebarEntry",
  fields: { sectionId: "?", title: "", description: "", selected: false, visible: true },
  input: {
    onClick(ctx) {
      ctx.bubble("sectionSelected", [this.sectionId]);
      return this;
    },
  },
  view: html`<div
    @if.class=".selected"
    @then="'list-row cursor-pointer text-blue-400 hover:text-blue-500 font-semibold'"
    @else="'list-row cursor-pointer hover:bg-base-200'"
    :title=".description"
    @on.click="onClick"
  >
    <div @text=".title" class="list-col-grow"></div>
    <p class="text-xs opacity-60 list-col-wrap truncate" @text=".description"></p>
  </div>`,
});

// A SidebarGroup is a (possibly unnamed) bucket of rows with its own `collapsed`
// state. `visible` hides the whole group when filtering leaves it empty. An unnamed
// group (`name === ""`) is a single ungrouped section rendered headerless. Collapse is
// expressed through each row's `visible` (set by the engine's walks), so the render
// just shows what is visible — no collapse logic in the template. (`rows`, not
// `entries`: `entries` collides with Immutable's built-in `.entries()` accessor.)
const SidebarGroup = component({
  name: "SidebarGroup",
  fields: { name: "", collapsed: false, visible: true, rows: [] },
  // Visibility drives the render-each `when` predicates (not `@show` on the items):
  // a `when` filter renders only visible rows while keeping each row's positional key,
  // so an event's path resolves to the right row. `@show` on a render-each item would
  // shift the rendered set and mis-map the click.
  alter: {
    rowVisible(_key, row) {
      return row.visible;
    },
  },
  input: {
    onToggle(ctx) {
      ctx.bubble("groupToggled", [this.name]);
      return this;
    },
  },
  view: html`<div class="flex flex-col">
    <div
      class="list-row cursor-pointer hover:bg-base-200 font-semibold flex items-center gap-1"
      @show="truthy? .name"
      @on.click="onToggle"
    >
      <span @show=".collapsed">▸</span>
      <span @hide=".collapsed">▾</span>
      <span @text=".name" class="list-col-grow"></span>
    </div>
    <div
      @if.class="truthy? .name"
      @then="'flex flex-col pl-3'"
      @else="'flex flex-col'"
    >
      <x render-each=".rows" when="rowVisible"></x>
    </div>
  </div>`,
});

const Example = component({
  name: "Example",
  fields: {
    id: "?",
    title: "?",
    description: "",
    value: null,
    view: "main",
    requestHandlers: null,
    on: null,
    // Inspector tabs. activeTab selects which body renders; the *View fields hold
    // prebuilt inspector instances (attached by mountStorybook before start, via
    // src/storybook/inspect.js); the has* flags gate which tabs appear.
    activeTab: "preview",
    hasInspect: false,
    hasComponent: false,
    hasLint: false,
    hasTest: false,
    componentView: null,
    instanceView: null,
    lintView: null,
    testView: null,
  },
  // Storybook-only convention (read in mountStorybook, never by core): names the
  // field on an example instance that holds its per-example request-handler mocks.
  requestOverridesField: "requestHandlers",
  statics: {
    fromData({
      id,
      title = "No Title Example",
      description = "",
      value = null,
      view = "main",
      requestHandlers = null,
      on = null,
    }) {
      id ??= slugify(title);
      return this.make({
        id,
        title,
        description,
        value,
        view,
        requestHandlers,
        on,
      });
    },
  },
  // Lifecycle hooks: the section forwards init/resume/suspend here; each runs the
  // matching `on` phase's actions against this example's component (`.value`).
  receive: {
    init(ctx) {
      this.runPhase(ctx, "init", this.on?.init);
      return this;
    },
    resume(ctx) {
      this.runPhase(ctx, "resume", this.on?.resume);
      return this;
    },
    suspend(ctx) {
      this.runPhase(ctx, "suspend", this.on?.suspend);
      return this;
    },
  },
  methods: {
    runPhase(ctx, name, phase) {
      // A lifecycle `bubble` leaves the example's value and travels up into the
      // storybook engine's own components, so no author bubble handler runs.
      // Warn rather than silently no-op (dev-only surface).
      if (phaseHasBubble(phase))
        console.warn(
          `storybook on.${name}: a \`bubble\` action leaves this example and is received by the storybook engine, so your component's bubble handler won't run. Use send/request/input to drive a preset state.`,
        );
      dispatchPhase(ctx, ctx.at.field("value").buildPath(), phase, this.value);
    },
  },
  input: {
    onLogSelected() {
      console.log(this.value);
      return this;
    },
    onFocusSelected(ctx) {
      ctx.bubble("exampleFocusRequested", [this]);
      return this;
    },
  },
  view: html`<div class="card card-border bg-base-100 shadow-md">
    <div class="card-body">
      <h2 class="card-title flex justify-between">
        <a :href="$'#example-{.id}'" :id="$'example-{.id}'" @text=".title"></a>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" @on.click="onFocusSelected">
            focus
          </button>
          <button class="btn btn-ghost btn-sm" @on.click="onLogSelected">
            log
          </button>
        </div>
      </h2>
      <p class="text-md italic opacity-60" @text=".description"></p>
      <div role="tablist" class="tabs tabs-border" @show=".hasInspect">
        <a
          role="tab"
          @if.class="equals? .activeTab 'preview'"
          @then="'tab tab-active'"
          @else="'tab'"
          @on.click="$setActiveTab 'preview'"
        >
          Preview
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
          @if.class="equals? .activeTab 'instance'"
          @then="'tab tab-active'"
          @else="'tab'"
          @on.click="$setActiveTab 'instance'"
        >
          Instance
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
        <a
          role="tab"
          @show=".hasTest"
          @if.class="equals? .activeTab 'test'"
          @then="'tab tab-active'"
          @else="'tab'"
          @on.click="$setActiveTab 'test'"
        >
          Test
        </a>
      </div>
      <div @show="equals? .activeTab 'preview'">
        <div class="bg-base-100 p-3" @push-view=".view">
          <x render=".value"></x>
        </div>
      </div>
      <div class="p-3" @show="equals? .activeTab 'component'">
        <x render=".componentView"></x>
      </div>
      <div class="p-3" @show="equals? .activeTab 'instance'">
        <x render=".instanceView"></x>
      </div>
      <div class="p-3" @show="equals? .activeTab 'lint'">
        <x render=".lintView"></x>
      </div>
      <div class="p-3" @show="equals? .activeTab 'test'">
        <x render=".testView"></x>
      </div>
    </div>
  </div>`,
});

// Drive section lifecycle on a selection change. ctx.path is the root Storybook
// for both call sites (response.loadState + bubble.sectionSelected), so
// ctx.at.index("sections", i) addresses a section. Exactly one of init/resume
// fires for the new section; suspend fires for the old one if it was shown.
function transitionSections(ctx, sb, oldIndex, newIndex) {
  const changed = oldIndex !== newIndex;
  if (changed && sb.sections.get(oldIndex)?.initialized)
    ctx.at.index("sections", oldIndex).send("suspend", []);
  const target = sb.sections.get(newIndex);
  if (!target) return;
  if (!target.initialized) ctx.at.index("sections", newIndex).send("init", []);
  else if (changed) ctx.at.index("sections", newIndex).send("resume", []);
}

// Forward a lifecycle name to every example in a section. Each item's Example
// receive handler interprets its own `on` config (src/on.js).
function fanoutLifecycle(ctx, items, name) {
  items.forEach((_item, j) => {
    ctx.at.index("items", j).send(name, []);
  });
}

// Subsequence match, but bounded so a long query can't match by scattering its
// characters across an unrelated (often long) string — the old behavior, where any
// query whose letters merely appeared in order would match, made long queries match
// far too much (titles + descriptions are long). A direct substring always matches;
// otherwise we find the SHORTEST window of the target that contains the query as a
// subsequence and require it to fit a small, query-scaled gap budget. Short queries
// stay forgiving; long ones must be near-contiguous.
function fuzzyMatch(query, target) {
  const q = query.toLowerCase().trim();
  if (q === "") return true;
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  // Allowed total gap grows slowly with length: len 3 -> +1, len 6 -> +3, len 10 -> +5.
  const budget = q.length + Math.max(1, Math.floor(q.length / 2));
  // Try each occurrence of the first char as a window start; keep the tightest span.
  for (let start = 0; start < t.length; start++) {
    if (t[start] !== q[0]) continue;
    let qi = 1;
    let ti = start + 1;
    for (; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) qi++;
    }
    if (qi === q.length && ti - start <= budget) return true;
  }
  return false;
}

function slugify(str) {
  return String(str)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Aggregate an array of dev/story modules into the data a storybook needs.
// Each module follows the convention: getComponents() (required) and
// getExamples() -> a section object { title, description?, items: [...] } OR an
// array of such section objects (a module contributing several sidebar sections).
// Both forms are consumed by Section.fromData. Plus optional
// getMacros()/getRequestHandlers().
export function buildStorybook(modules) {
  const rawSections = modules.flatMap((m) => {
    const raw = m.getExamples?.();
    if (raw == null) return [];
    return Array.isArray(raw) ? raw : [raw];
  });
  const sections = rawSections
    .map((s) => Section.Class.fromData(s))
    .sort((a, b) => a.title.localeCompare(b.title));
  // The engine + inspector components own the shared root scope (mountStorybook
  // registers them there). Module components are grouped per module instead (below)
  // so two modules can define *different* components that happen to share a `name`
  // without colliding — each name lands in its own module scope's table.
  const engineComponents = [
    Storybook,
    Section,
    Example,
    SidebarGroup,
    SidebarEntry,
    ...getInspectorComponents(),
  ];
  const engineSet = new Set(engineComponents);
  // One component list per module (positional with `modules`), de-duped within the
  // module by identity. Engine/inspector components are dropped — a module that
  // re-lists them (e.g. `export { getComponents } from "tutuca/components"`) keeps
  // them owned by the root scope and still sees them via parent chaining, rather
  // than re-registering (and rebinding their `.scope`) into the module scope.
  const moduleComponents = modules.map((m) => {
    const seen = new Set();
    const out = [];
    for (const c of m.getComponents?.() ?? []) {
      if (!c || engineSet.has(c) || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  });
  const macros = {};
  const requestHandlers = {};
  // Request names any example overrides via its `requestHandlers` map (read from the
  // raw section data — the Example component's requestOverridesField convention).
  const overrideNames = new Set();
  for (const s of rawSections) {
    for (const it of s?.items ?? []) {
      for (const name in it?.requestHandlers ?? {}) overrideNames.add(name);
    }
  }
  for (const m of modules) {
    if (m.getMacros) Object.assign(macros, m.getMacros());
    if (m.getRequestHandlers) Object.assign(requestHandlers, m.getRequestHandlers());
  }
  // Flat union (engine ∪ every module's components), kept for consumers that embed a
  // whole storybook as a single value and so must register everything in one scope
  // — e.g. the Inception demo's getComponents() (docs/examples/storybook.js).
  const components = [...new Set([...engineComponents, ...moduleComponents.flat()])];
  return {
    root: Storybook.Class.withSections(sections),
    components,
    engineComponents,
    moduleComponents,
    macros,
    requestHandlers,
    overrideNames,
  };
}

// Build the retained sidebar tree from the flat section list — once. Sections sharing a
// non-empty `group` cluster under one named SidebarGroup; ungrouped sections become
// their own headerless single-entry group. Buckets interleave alphabetically by display
// key (group name, or the lone section's title) so that with nothing grouped the tree
// reproduces the flat alphabetical order. The tree starts fully visible and unselected;
// the engine's walks (markSidebarSelected / applyFilterToSidebar / toggleSidebarGroup)
// own all later mutation — this never runs again.
function buildSidebar(sections) {
  const groups = new Map(); // name -> [Section]
  const singles = []; // ungrouped sections, one entry each
  sections.forEach((s) => {
    const name = s.group ?? "";
    if (name === "") singles.push(s);
    else {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(s);
    }
  });
  const buckets = [];
  for (const [name, secs] of groups) buckets.push({ key: name.toLowerCase(), name, sections: secs });
  for (const s of singles) buckets.push({ key: s.title.toLowerCase(), name: "", sections: [s] });
  buckets.sort((a, b) => a.key.localeCompare(b.key));
  return buckets.map((b) =>
    SidebarGroup.make({
      name: b.name,
      collapsed: false,
      visible: true,
      rows: b.sections.map((s) =>
        SidebarEntry.make({
          sectionId: s.id,
          title: s.title,
          description: s.description,
          selected: false,
          visible: true,
        }),
      ),
    }),
  );
}

// Storybook request mocking. One meta handler per request name (module handlers ∪
// per-example overrides). Each walks the request ctx's component path to the nearest
// example (a component declaring `requestOverridesField` in its `extra`) and uses
// that example's mock for the name when present, else the module's real handler. The
// handler signature matches the framework's — the RequestContext is the final arg.
export function buildExampleRequestHandlers({ requestHandlers: reals, overrideNames }) {
  const names = new Set([...Object.keys(reals), ...overrideNames]);
  const makeMeta =
    (name) =>
    async (...rest) => {
      const ctx = rest.at(-1);
      const args = rest.slice(0, -1);
      let override = null;
      ctx.walkPath((Comp, inst) => {
        const field = Comp.extra?.requestOverridesField;
        if (!field) return;
        const map = inst.get(field, null);
        if (map && name in map) {
          override = map[name];
          return false; // nearest example wins
        }
      });
      const fn = override ?? reals[name];
      if (!fn) throw new Error(`Request not found: ${name}`);
      return await fn(...args, ctx);
    };
  const handlers = {};
  for (const name of names) handlers[name] = makeMeta(name);
  return handlers;
}

// High-level bootstrap: aggregate modules, mount the storybook at selector,
// optionally compile CSS via the provided callback, and start the app.
//   compileCss: (app) => Promise<string>  // e.g. compileClassesToStyleText(app, compile)
//   root:       override the aggregated root (escape hatch for custom roots)
//   dev:        { shadowCheckComponent, runTests, expect } from tutuca/dev — when
//               provided, each example gets Component/Instance/Data/Lint/Test
//               inspector tabs. Omit (e.g. --no-inspect) for preview-only.
//   noCache:    start the app with the render cache disabled (NullDomCache) so
//               every example re-renders fresh — useful while developing.
// Returns the started `app`, with the registered scopes attached as
// `app.scopes = { root, modules }`: `root` owns the engine/inspector components +
// macros + request handlers; `modules` is one isolated child scope per input module
// (positional), so same-named components in different modules don't collide.
export async function mountStorybook(
  selector,
  modules,
  { compileCss, root, persistUrl = true, dev = null, noCache = false } = {},
) {
  const app = tutuca(selector);
  const built = buildStorybook(modules);
  app.state.set(root ?? built.root);
  // The root scope owns the engine + inspector components, the shared macros, and
  // all request handlers. Each module then gets its OWN child scope (below): module
  // components resolve their own names locally and inherit everything here via parent
  // chaining (lookupComponent/lookupMacro/lookupRequest all walk to the parent), so
  // two modules can define different components with the same name without colliding.
  const rootScope = app.registerComponents(built.engineComponents);
  rootScope.registerMacros(built.macros);
  // Register one meta handler per request name (module handlers ∪ per-example
  // overrides). Each resolves the issuing example via the request ctx's walkPath and
  // uses that example's mock when present, else the module's real handler.
  rootScope.registerRequestHandlers(buildExampleRequestHandlers(built));
  // The storybook owns these request names; register last so they win over any
  // module-provided handler of the same name. `loadState` is registered even when
  // not persisting (returning a blank state) so `response.loadState` still selects
  // and inits the default section — it just never touches the URL. `persistState`
  // (the writer) stays gated; unregistered, its requests no-op via the 404 path.
  rootScope.registerRequestHandlers({ loadState: persistUrl ? loadState : loadStateBlank });
  if (persistUrl) {
    rootScope.registerRequestHandlers({ persistState });
  }
  // One isolated scope per module, as a child of rootScope. `registerComponents`
  // writes each component's name into the scope it is called on, so a fresh child
  // per module keeps the modules' name tables disjoint while still inheriting the
  // engine components, macros, and request handlers above. Positional with `modules`.
  const moduleScopes = built.moduleComponents.map((comps) => {
    const scope = rootScope.enter();
    scope.registerComponents(comps);
    return scope;
  });
  // Build the per-example inspector views (Component/Instance/Data, plus Lint/Test
  // from the injected dev producers) and bake them onto the examples before the
  // first render. Only when `dev` is wired and the root is the standard storybook.
  // attachInspectorViews resolves each value's component by identity (scope.getCompFor
  // delegates to the shared registry), so the root scope works for every module.
  if (dev && app.state.val?.sections) {
    app.state.set(await attachInspectorViews(app.state.val, rootScope, modules, dev));
  }
  if (compileCss) {
    injectCss("tutuca-storybook", await compileCss(app));
  }
  app.start({ noCache });
  // Drive the section lifecycle (and, when persisting, restore section/example
  // from the URL). Re-restore on Back/Forward only when persisting. Programmatic
  // push/replaceState don't fire popstate, so this only runs on real navigation.
  app.sendAtRoot("init", []);
  if (persistUrl) {
    window.addEventListener("popstate", () => app.sendAtRoot("init", []));
  }
  // Expose the registered scopes for callers that want to introspect or register
  // more against them. `app` stays the return value so `const app = await
  // mountStorybook(...)` and `check(app)` keep working; the scopes ride along on it.
  // `moduleScopes` is positional with the `modules` argument.
  app.scopes = { root: rootScope, modules: moduleScopes };
  return app;

  // The root storybook is the only instance whose `this` is identical to
  // app.state.val while a handler runs (state commits only after the handler
  // returns). The check must happen before any await; the body is synchronous.
  function persistState(state, instance, push) {
    if (instance !== app.state.val) return; // ignore nested (Inception) storybooks
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(state)) {
      if (v === "" || v == null) url.searchParams.delete(k);
      else url.searchParams.set(k, String(v));
    }
    window.history[push ? "pushState" : "replaceState"](null, "", url);
  }
  function loadState() {
    const p = new URLSearchParams(window.location.search);
    return {
      section: p.get("section"),
      example: p.get("example"),
      sectionFilter: p.get("sectionFilter") ?? "",
      exampleFilter: p.get("exampleFilter") ?? "",
    };
  }
  // Non-persisting variant: ignore the URL, just select+init the default section.
  function loadStateBlank() {
    return { section: null, example: null, sectionFilter: "", exampleFilter: "" };
  }
}

// Follow the module convention so the storybook engine can be inspected by the
// CLI like any other module.
export function getComponents() {
  return [Storybook, Section, Example, SidebarGroup, SidebarEntry];
}

export { Example, fuzzyMatch, Section, Storybook, slugify };
