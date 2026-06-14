// Storybook engine: the Storybook/Section/Example components plus the pure
// aggregation (buildStorybook) and bootstrap (mountStorybook) helpers. It imports
// ONLY from the bare "tutuca" specifier so the shipped dist/tutuca-storybook.js
// stays a single external import — consumers wire an import map pointing "tutuca"
// at the same runtime their story modules use, guaranteeing one tutuca instance.
//
// CSS is decoupled: mountStorybook takes a compileCss(app) callback instead of
// importing margaui or the extra tier. When omitted the storybook renders
// functional but unstyled.
import { component, html, injectCss, tutuca } from "tutuca";

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
  },
  input: {
    onApplyFilter(value, ctx) {
      ctx.request("persistState", [{ key: "sectionFilter", value }]);
      return this.setFilter(value);
    },
    onClearFilter(ctx) {
      ctx.request("persistState", [{ key: "sectionFilter", value: "" }]);
      return this.resetFilter();
    },
    onFocusClose(ctx) {
      ctx.request("persistState", [{ key: "sectionId", value: "" }]);
      ctx.request("persistState", [{ key: "exampleId", value: "" }]);
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
      ctx.request("persistState", [{ key: "section", value: section.id }]);
      return this.selectSectionAtIndex(this.sections.indexOf(section));
    },
    exampleFocusRequested(example, ctx) {
      ctx.stopPropagation();
      const section = this.sections.get(this.selectedSectionIndex);
      const sectionId = section?.id ?? null;
      ctx.request("persistState", [{ key: "sectionId", value: sectionId }]);
      ctx.request("persistState", [{ key: "exampleId", value: example.id }]);
      return this.setSectionId(sectionId).setExampleId(example.id).setFocusExample(example.value);
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
      ctx.request("persistState", [{ key: "exampleFilter", value }]);
      return this.setFilter(value);
    },
    onClearFilter(ctx) {
      ctx.request("persistState", [{ key: "exampleFilter", value: "" }]);
      return this.resetFilter();
    },
    onListItemClick(ctx) {
      ctx.bubble("sectionSelected", [this]);
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
  fields: { id: "?", title: "?", description: "", value: null, view: "main" },
  statics: {
    fromData({ id, title = "No Title Example", description = "", value = null, view = "main" }) {
      id ??= slugify(title);
      return this.make({
        id,
        title,
        description,
        value,
        view,
      });
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
  const sections = modules
    .flatMap((m) => {
      const raw = m.getExamples?.();
      if (raw == null) return [];
      return Array.isArray(raw) ? raw : [raw];
    })
    .map((s) => Section.Class.fromData(s))
    .sort((a, b) => a.title.localeCompare(b.title));
  const components = new Set([Storybook, Section, Example]);
  const macros = {};
  const requestHandlers = {};
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
  };
}

// High-level bootstrap: aggregate modules, mount the storybook at selector,
// optionally compile CSS via the provided callback, and start the app.
//   compileCss: (app) => Promise<string>  // e.g. compileClassesToStyleText(app, compile)
//   root:       override the aggregated root (escape hatch for custom roots)
export async function mountStorybook(selector, modules, { compileCss, root } = {}) {
  const app = tutuca(selector);
  const built = buildStorybook(modules);
  app.state.set(root ?? built.root);
  const scope = app.registerComponents(built.components);
  scope.registerMacros(built.macros);
  scope.registerRequestHandlers(built.requestHandlers);
  if (compileCss) {
    injectCss("tutuca-storybook", await compileCss(app));
  }
  app.start();
  return app;
}

// Follow the module convention so the storybook engine can be inspected by the
// CLI like any other module.
export function getComponents() {
  return [Storybook, Section, Example];
}

export { Example, fuzzyMatch, Section, Storybook, slugify };
