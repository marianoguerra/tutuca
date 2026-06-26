// Storybook engine: the Storybook/Section/Example components plus the pure
// aggregation (buildStorybook) and bootstrap (mountStorybook) helpers. It imports
// ONLY from the bare "tutuca" specifier so the shipped dist/tutuca-storybook.js
// stays a single external import — consumers wire an import map pointing "tutuca"
// at the same runtime their story modules use, guaranteeing one tutuca instance.
//
// CSS is decoupled: mountStorybook takes a compileCss(app) callback instead of
// importing margaui or the extra tier. When omitted the storybook renders
// functional but unstyled.
import { component, dispatchPhase, html, injectCss, phaseHasBubble, tutuca } from "tutuca";

const Storybook = component({
  name: "Storybook",
  fields: {
    selectedSectionIndex: 0,
    sections: [],
    filter: "",
    sectionId: null,
    exampleId: null,
    focusExample: null,
  },
  methods: {
    selectSectionAtIndex(index) {
      if (this.sections.size === 0) return this;
      const safeIndex = index >= 0 && index < this.sections.size ? index : 0;
      const sections = this.sections.map((s, i) => s.setSelected(i === safeIndex));
      return this.setSelectedSectionIndex(safeIndex).setSections(sections);
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
  input: {
    onApplyFilter(value, ctx) {
      ctx.request("persistState", [this.toUrlState({ sectionFilter: value }), this, false]);
      return this.setFilter(value);
    },
    onClearFilter(ctx) {
      ctx.request("persistState", [this.toUrlState({ sectionFilter: "" }), this, false]);
      return this.resetFilter();
    },
    onFocusClose(ctx) {
      ctx.request("persistState", [this.toUrlState({ example: "" }), this, true]);
      return this.setSectionId(null).setExampleId(null).setFocusExample(null);
    },
  },
  alter: {
    filterSection(_key, section) {
      return (
        this.filter === "" || fuzzyMatch(this.filter, `${section.title} ${section.description}`)
      );
    },
  },
  bubble: {
    sectionSelected(section, ctx) {
      ctx.stopPropagation();
      ctx.request("persistState", [
        this.toUrlState({ section: section.id, exampleFilter: section.filter }),
        this,
        true,
      ]);
      const oldIndex = this.selectedSectionIndex;
      const next = this.selectSectionAtIndex(this.sections.indexOf(section));
      transitionSections(ctx, next, oldIndex, next.selectedSectionIndex);
      return next;
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
      const selected = this.selectSectionWithId(state.section)
        .setFilter(state.sectionFilter ?? "")
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
      <div
        class="w-1/4 flex flex-col gap-3 bg-base-100 shadow-md h-full overflow-hidden"
      >
        <input
          class="input w-full outline-0 focus:bg-base-200"
          type="search"
          placeholder="Filter sections"
          :value=".filter"
          @on.input="onApplyFilter value"
          @on.keydown.cancel="onClearFilter"
        />
        <div class="list h-full flex-1 overflow-y-auto">
          <x render-each=".sections" as="listEntry" when="filterSection"></x>
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
    items: [],
    filter: "",
    selected: false,
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
      const { id, title, description = "", items = [] } = raw;
      return this.make({
        id: id ?? slugify(title),
        title,
        description,
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
    onListItemClick(ctx) {
      ctx.bubble("sectionSelected", [this]);
      return this;
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
  views: {
    listEntry: html`<div
      @if.class=".selected"
      @then="'list-row cursor-pointer text-blue-400 hover:text-blue-500 font-semibold'"
      @else="'list-row cursor-pointer hover:bg-base-200'"
      :title=".description"
      @on.click="onListItemClick"
    >
      <div @text=".title" class="list-col-grow"></div>
      <p
        class="text-xs opacity-60 list-col-wrap truncate"
        @text=".description"
      ></p>
    </div> `,
  },
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
      <div class="bg-base-100 p-3" @push-view=".view">
        <x render=".value"></x>
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

function fuzzyMatch(query, target) {
  const q = query.toLowerCase(),
    t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
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
  // Components dedup by identity (object reference): a leaf listed in several
  // modules' getComponents() is added once. This is the contract that lets a
  // composition module re-list every leaf it uses without conflict.
  const components = new Set([Storybook, Section, Example]);
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
    for (const c of m.getComponents?.() ?? []) {
      components.add(c);
    }
    if (m.getMacros) Object.assign(macros, m.getMacros());
    if (m.getRequestHandlers) Object.assign(requestHandlers, m.getRequestHandlers());
  }
  return {
    root: Storybook.make({ sections }),
    components: [...components],
    macros,
    requestHandlers,
    overrideNames,
  };
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
export async function mountStorybook(
  selector,
  modules,
  { compileCss, root, persistUrl = true } = {},
) {
  const app = tutuca(selector);
  const built = buildStorybook(modules);
  app.state.set(root ?? built.root);
  const scope = app.registerComponents(built.components);
  scope.registerMacros(built.macros);
  // Register one meta handler per request name (module handlers ∪ per-example
  // overrides). Each resolves the issuing example via the request ctx's walkPath and
  // uses that example's mock when present, else the module's real handler.
  scope.registerRequestHandlers(buildExampleRequestHandlers(built));
  // The storybook owns these request names; register last so they win over any
  // module-provided handler of the same name. `loadState` is registered even when
  // not persisting (returning a blank state) so `response.loadState` still selects
  // and inits the default section — it just never touches the URL. `persistState`
  // (the writer) stays gated; unregistered, its requests no-op via the 404 path.
  scope.registerRequestHandlers({ loadState: persistUrl ? loadState : loadStateBlank });
  if (persistUrl) {
    scope.registerRequestHandlers({ persistState });
  }
  if (compileCss) {
    injectCss("tutuca-storybook", await compileCss(app));
  }
  app.start();
  // Drive the section lifecycle (and, when persisting, restore section/example
  // from the URL). Re-restore on Back/Forward only when persisting. Programmatic
  // push/replaceState don't fire popstate, so this only runs on real navigation.
  app.sendAtRoot("init", []);
  if (persistUrl) {
    window.addEventListener("popstate", () => app.sendAtRoot("init", []));
  }
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
  return [Storybook, Section, Example];
}

export { Example, fuzzyMatch, Section, Storybook, slugify };
