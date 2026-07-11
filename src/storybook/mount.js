// Browser bootstrap for the storybook: aggregate modules, mount, start.
// CSS is decoupled: mountStorybook takes a compileCss(app) callback instead of
// importing margaui or the extra tier. When omitted the storybook renders
// functional but unstyled. The inspector tab views are decoupled the same way:
// rendering comes from tutuca/components, lint/test DATA from the injected `dev`.
import { injectCss, tutuca } from "tutuca";
import { subscribeExampleActivity } from "./activity.js";
import { buildExampleRequestHandlers, buildStorybook } from "./build.js";
import { attachInspectorViews } from "./inspect.js";
import { BUNDLED_THEMES, MARGAUI_THEMES } from "./themes.js";

// High-level bootstrap: aggregate modules, mount the storybook at selector,
// optionally compile CSS via the provided callback, and start the app.
//   compileCss: (app) => Promise<string>  // e.g. compileClassesToStyleText(app, compile)
//   root:       override the aggregated root (escape hatch for custom roots)
//   dev:        { shadowCheckComponent, runTests, expect } from tutuca/dev — when
//               provided, each example gets Component/Instance/Data/Lint/Test
//               inspector tabs. Omit (e.g. --no-inspect) for preview-only.
//   noCache:    start the app with the render cache disabled (NullDomCache) so
//               every example re-renders fresh — useful while developing.
//   themes:     { baseUrl } — the directory holding margaui's palette stylesheets,
//               e.g. "https://…/margaui/themes/". Enables the theme switcher. Like
//               compileCss this is INJECTED, so the storybook still never imports
//               margaui. Omit it (no margaui CSS on the page) and no switcher shows.
// Returns the started `app`, with the registered scopes attached as
// `app.scopes = { root, modules }`: `root` owns the engine/inspector components +
// macros + request handlers; `modules` is one isolated child scope per input module
// (positional), so same-named components in different modules don't collide.
export async function mountStorybook(
  selector,
  modules,
  { compileCss, root, persistUrl = true, dev = null, noCache = false, themes = null } = {},
) {
  const app = tutuca(selector);
  const built = buildStorybook(modules);
  const themeBaseUrl = themes?.baseUrl ?? null;
  const base = root ?? built.root;
  // The switcher's option list. Left empty (the field default) without a `themes`
  // option, which is what hides the switcher — see Storybook.themes.
  app.state.set(themeBaseUrl && base.setThemes ? base.setThemes(MARGAUI_THEMES) : base);
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
  // Gated on the `themes` option for the same reason as `persistState`: with no theme
  // CSS on the page there is nothing to switch, so the request stays unregistered and
  // no-ops via the 404 path (the switcher isn't rendered either).
  if (themeBaseUrl) {
    rootScope.registerRequestHandlers({ applyTheme });
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
  // Trace per-example dispatch activity into each example's Activity tab. Gated on
  // `dev` (same as the inspector tabs): the Activity tab lives in the inspector tab
  // bar, so it is only reachable when dev is wired.
  if (dev) subscribeExampleActivity(app);
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
  // Switching the palette is a document effect, so it lives here rather than in the
  // (pure) component: set the attribute every margaui theme is keyed on, loading that
  // theme's stylesheet first if it isn't on the page yet.
  function applyTheme(name, instance) {
    if (instance !== app.state.val) return; // ignore nested (Inception) storybooks
    ensureThemeLink(name);
    document.documentElement.dataset.theme = name;
  }
  function loadState() {
    const p = new URLSearchParams(window.location.search);
    return {
      section: p.get("section"),
      example: p.get("example"),
      sectionFilter: p.get("sectionFilter") ?? "",
      exampleFilter: p.get("exampleFilter") ?? "",
      theme: resolveTheme(p.get("theme")),
    };
  }
  // Non-persisting variant: ignore the URL, just select+init the default section. The
  // theme still resolves — it just comes from the OS preference alone, never the URL.
  function loadStateBlank() {
    return {
      section: null,
      example: null,
      sectionFilter: "",
      exampleFilter: "",
      theme: resolveTheme(null),
    };
  }
  // Pick the theme to start in — an explicit choice in the URL, else the OS preference
  // — and put it on the document. The OS step is on us: margaui's dark.css is keyed on
  // [data-theme="dark"] alone, with no prefers-color-scheme fallback, so loading its
  // theme.css without setting the attribute always renders light. Returns the resolved
  // name so the switcher shows it; "" when theming is off, leaving the document alone.
  function resolveTheme(fromUrl) {
    if (!themeBaseUrl) return "";
    const name = MARGAUI_THEMES.includes(fromUrl) ? fromUrl : osTheme();
    ensureThemeLink(name);
    document.documentElement.dataset.theme = name;
    return name;
  }
  function osTheme() {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  // Load a palette's stylesheet, once. light and dark are already there (they are what
  // margaui's theme.css bundles), so only the other 33 cost a request, and only when
  // actually selected.
  //
  // Appending is what makes this correct, not just cheap: light.css claims plain `:root`
  // alongside [data-theme=light], which ties on specificity with [data-theme=<name>], so
  // a palette only wins by coming LATER in the cascade. (margaui's own dark.css beats
  // light.css by exactly this.)
  function ensureThemeLink(name) {
    if (BUNDLED_THEMES.has(name) || document.getElementById(themeLinkId(name))) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.id = themeLinkId(name);
    link.href = `${themeBaseUrl}${name}.css`;
    document.head.append(link);
  }
  function themeLinkId(name) {
    return `tutuca-theme-${name}`;
  }
}
