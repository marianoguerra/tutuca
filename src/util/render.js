import { App } from "../app.js";
import { COMPONENT, Components } from "../components.js";
import { dispatchPhase } from "../on.js";
import { DispatchPath } from "../path.js";
import { Renderer } from "../renderer.js";
import { rootDispatcher } from "../transactor.js";

function reindexComponents(comps) {
  for (let i = 0; i < comps.length; i++) {
    comps[i][COMPONENT].id = i;
  }
}

// An input's current value/checked live on the DOM *property*, not the attribute,
// so `innerHTML` alone would serialize them away. Reflect them onto attributes
// right before serializing — never at mount, since a driven phase can still change
// them (see renderToHTMLDriven).
function serializeContainer(container) {
  for (const input of container.querySelectorAll("input")) {
    if (input.value) input.setAttribute("value", input.value);
    if (input.checked) input.setAttribute("checked", "");
  }
  return container.innerHTML;
}

// Mount `rootState` into a fresh container and return the live app. Options:
// `noCache` (default on: a headless render has no second frame to reuse),
// `intentHandlers` (registered on the scope, so intent dispatches resolve instead
// of hitting the 404 handler), `paths` (names registered as absolute app paths, so
// a lookup resolves on the `lex` leg with no component publishing it) and `view`
// (which of the root component's views to mount; defaults to `main`).
export function renderToHTMLNode(
  document,
  components,
  macros,
  rootState,
  ParseContext,
  { noCache = true, paths = null, intentHandlers = null, view = null } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  reindexComponents(components);

  const comps = new Components();
  const renderer = new Renderer(comps);
  const app = new App(container, comps, renderer, ParseContext);
  const scope = app.registerComponents(components, { paths });
  if (macros) scope.registerMacros(macros);
  if (intentHandlers) scope.registerIntentHandlers(intentHandlers);
  app.rootViewName = view;
  app.transactor.state.set(rootState);
  app.start({ noCache });

  return {
    container,
    app,
    cleanup() {
      app.stop();
      container.remove();
    },
  };
}

// Mount `rootState`, drive it through one `on`-phase config (when given), wait for
// the whole cascade to settle, and only then serialize. This is what the storybook
// does on first display (Section init -> Example.runPhase), so it is what a headless
// render must do too: without it, an example whose interesting state only exists
// after `on.init` is serialized in its pristine, never-driven form.
//
// Mirrors `drive()` in tools/core/test.js — same dispatchPhase + settle pair, so the
// `render` gate exercises components exactly the way the `test` gate does.
export async function renderToHTMLDriven(
  document,
  components,
  macros,
  rootState,
  ParseContext,
  { phase = null, ...opts } = {},
) {
  const { container, app, cleanup } = renderToHTMLNode(
    document,
    components,
    macros,
    rootState,
    ParseContext,
    opts,
  );
  try {
    if (phase) {
      // An `intent` raised here has no ancestor to walk to: the example's value IS the
      // render root. It needs no warning any more — the walk runs out and the sender
      // hears `<name>Unhandled`, which says so at the place that asked.
      dispatchPhase(rootDispatcher(app.transactor), new DispatchPath(), phase, app.state.val);
      await app.transactor.settle();
    }
    return serializeContainer(container);
  } finally {
    cleanup();
  }
}

// The undriven form: mount, serialize, unmount. Synchronous, for the tests that
// only look at a first render.
export function renderToHTML(document, components, macros, rootState, ParseContext) {
  const { container, cleanup } = renderToHTMLNode(
    document,
    components,
    macros,
    rootState,
    ParseContext,
  );
  try {
    return serializeContainer(container);
  } finally {
    cleanup();
  }
}
