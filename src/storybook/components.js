// The storybook UI components (Storybook/Section/SidebarEntry/SidebarGroup/
// Example) plus the pure helpers they render with. Imports ONLY from the bare
// "tutuca" specifier so the shipped dist/tutuca-storybook.js stays a single
// external import — consumers wire an import map pointing "tutuca" at the same
// runtime their story modules use, guaranteeing one tutuca instance.
import { component, dispatchPhase, html, phaseHasBubble } from "tutuca";

export const Storybook = component({
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
          <x render-each=".sidebar" @when="groupVisible"></x>
        </div>
      </div>
      <div class="w-full h-full overflow-y-auto">
        <x render=".sections[.selectedSectionIndex]"></x>
      </div>
    </div>
  </div>`,
});

export const Section = component({
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
      <x render-each=".items" @when="filterItem"></x>
    </div>
  </section>`,
});

// The retained sidebar tree. A SidebarEntry is one clickable section row carrying its
// own UI state — `selected` (highlight) and `visible` (filter result) — plus the id it
// selects. It is built once and only its fields are flipped; it never re-derives from
// the content `sections`.
export const SidebarEntry = component({
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
export const SidebarGroup = component({
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
      <x render-each=".rows" @when="rowVisible"></x>
    </div>
  </div>`,
});

export const Example = component({
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
    // Live dispatch activity for this example's component (`.value`): an ActivityLog
    // (baked empty by src/storybook/inspect.js) the core observer appends to via
    // logActivity. `hasActivity` gates the Activity tab so it only appears once
    // something has actually happened.
    activityLog: null,
    hasActivity: false,
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
    // Append one activity row to the example's ActivityLog. Dispatched by the storybook
    // observer at this example's node — a path OUTSIDE `.value`, so the observer's own
    // filter ignores it and this append is never itself logged (no loop).
    logActivity(entry) {
      return this.setActivityLog(this.activityLog.appendEntry(entry)).setHasActivity(true);
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
        <a
          role="tab"
          @show=".hasActivity"
          @if.class="equals? .activeTab 'activity'"
          @then="'tab tab-active'"
          @else="'tab'"
          @on.click="$setActiveTab 'activity'"
        >
          Activity
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
      <div class="p-3" @show="equals? .activeTab 'activity'">
        <x render=".activityLog"></x>
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
export function fuzzyMatch(query, target) {
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

export function slugify(str) {
  return String(str)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  for (const [name, secs] of groups)
    buckets.push({ key: name.toLowerCase(), name, sections: secs });
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
