// Browser bootstrap for the storybook: aggregate modules, mount, start.
// CSS is decoupled: mountStorybook takes a compileCss(app) callback instead of
// importing margaui or the extra tier. When omitted the storybook renders
// functional but unstyled. The inspector tab views are decoupled the same way:
// rendering comes from tutuca/components, lint/test DATA from the injected `dev`.
import { injectCss, tutuca } from "tutuca";
import { buildExampleRequestHandlers, buildStorybook } from "./build.js";
import { attachInspectorViews } from "./inspect.js";

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
