import { compile } from "margaui";
import { compileClassesToStyleText, component, html, tutuca } from "tutuca";
import { produce } from "tutuca/immer";

const APP_ROOT = "#app";

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function detectTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  setTheme(mq.matches ? "dark" : "light");
  mq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
}

async function main() {
  detectTheme();

  const app = tutuca(APP_ROOT);
  const components = getComponents();
  const scope = app.registerComponents(components);
  const examples = [];
  scope.registerIntentHandlers({
    async registerModuleFromCode(codes) {
      const results = await registerModuleFromCode(codes, scope, app.ParseContext);
      const eventNames = new Set();
      const curEventNames = app._eventNames;
      for (const res of results) {
        if (res?.examples?.items) {
          for (const v of res.examples.items) {
            examples.push(Example.Class.fromData(v));
          }
        }
        const components = res?.components;
        if (components) {
          for (const Comp of components) {
            Comp.compile(app.ParseContext);
            for (const key in Comp.views) {
              for (const name of Comp.views[key].ctx.genEventNames()) {
                console.log(name);
                if (!curEventNames.has(name)) {
                  eventNames.add(name);
                }
              }
            }
          }
        }
      }
      app.subscribeToEvents(eventNames);
      for (const name of eventNames) {
        curEventNames.add(name);
      }
      compileStyle();
      app.recompileStyles();
      app.state.update((current) =>
        produce(current, (draft) => {
          draft.components = examples;
        }),
      );
      return results;
    },
  });
  let style = null;
  async function compileStyle() {
    const styleText = await compileClassesToStyleText(app, compile);
    if (style === null) {
      style = document.createElement("style");
      document.head.appendChild(style);
    }
    style.textContent = styleText;
  }
  compileStyle();
  app.state.set(getRoot());
  app.start();
}

function getComponents() {
  return [Universal, ComponentSelector, Example];
}

function getRoot() {
  return Universal.make();
}

const ComponentSelector = component({
  receive: {
    setFilterText(draft, value) {
      draft.filterText = value;
    },
  },
  name: "ComponentSelector",
  fields: { filterText: "" },
  lookup: {
    components: { for: "Universal.components", default: ".items" },
  },
  intent: {
    listItemSelected(draft, entry, ctx) {
      ctx.stop();
      return entry.value;
    },
  },
  alter: {
    matchesFilter(_key, item) {
      const q = this.filterText.toLowerCase().trim();
      if (q === "") return true;
      return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div class="flex gap-3 justify-between" @hide="empty? *components">
      <input
        class="input input-m"
        placeholder="Filter entries"
        :value=".filterText"
        @on.input="setFilterText value"
      />
    </div>
    <div class="list" @hide="empty? *components">
      <x render-each="*components" as="listItem" @when="matchesFilter"></x>
    </div>
  </section>`,
});

const Universal = component({
  name: "Universal",
  fields: { value: ComponentSelector.make(), components: [] },
  provide: { components: ".components" },
  receive: {
    registerModuleFromCodeOk(draft, res) {
      console.log("registerModuleFromCode ok", res);
      return this;
    },
    registerModuleFromCodeError(draft, err) {
      console.error("registerModuleFromCode failed", err);
      return this;
    },
    onDrop(draft, e, ctx) {
      const files = e.dataTransfer?.files;
      if (files?.length) {
        Promise.all(Array.from(files, (file) => file.text())).then((codes) =>
          ctx.intent("registerModuleFromCode", [codes], { route: ["lex"] }),
        );
      }
      return this;
    },
  },
  view: html`<section class="m-3" @on.drop="onDrop event" data-droptarget="universal-components">
    <x render=".value"></x>
  </section>`,
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
  receive: {
    onLogSelected(draft) {
      console.log(this.value);
      return this;
    },
    onFocusSelected(draft, ctx) {
      ctx.intent("exampleFocusRequested", [this], { route: ["dyn"] });
      return this;
    },
    onListItemSelected(draft, ctx) {
      ctx.intent("listItemSelected", [this], { route: ["dyn"] });
      return this;
    },
  },
  view: html`<div class="card card-border bg-base-100 shadow-md">
    <div class="card-body">
      <h2 class="card-title flex justify-between">
        <a :href="$'#example-{.id}'" :id="$'example-{.id}'" @text=".title"></a>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" @on.click="onFocusSelected ctx">focus</button>
          <button class="btn btn-ghost btn-sm" @on.click="onLogSelected">log</button>
        </div>
      </h2>
      <p class="text-md italic opacity-60" @text=".description"></p>
      <div class="bg-base-100 p-3" @push-view=".view">
        <x render=".value"></x>
      </div>
    </div>
  </div>`,
  views: {
    listItem: html`<div
      class="list-row cursor-pointer hover:bg-base-200"
      @on.click="onListItemSelected"
    >
      <div @text=".title" class="list-col-grow"></div>
      <p class="text-xs opacity-60 list-col-wrap truncate" @text=".description"></p>
    </div>`,
  },
});

async function registerModuleFromCode(codes, rootScope) {
  const results = [];
  for (const code of codes) {
    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(url);
      const components = mod.getComponents();
      const examples = mod?.getExamples() ?? [];
      const scope = rootScope.enter();
      scope.registerComponents(components);
      if (mod.getMacros) {
        scope.registerMacros(mod.getMacros());
      }
      if (mod.getIntentHandlers) {
        scope.registerIntentHandlers(mod.getIntentHandlers());
      }
      results.push({ mod, components, examples, scope });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return results;
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

main();
