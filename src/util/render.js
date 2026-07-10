import { App } from "../app.js";
import { Components } from "../components.js";
import { dispatchPhase, phaseHasBubble } from "../on.js";
import { Path } from "../path.js";
import { Renderer } from "../renderer.js";
import { rootDispatcher } from "../transactor.js";

function reindexComponents(comps) {
  for (let i = 0; i < comps.length; i++) {
    comps[i].id = i;
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

// Mount `rootState` into a fresh container and return the live app. `opts` also
// takes `requestHandlers` (registered on the scope, so `request` dispatches resolve
// instead of hitting the 404 handler) and `view` (which of the root component's
// views to mount; defaults to `main`).
export function renderToHTMLNode(
  document,
  components,
  macros,
  rootState,
  ParseContext,
  opts = { noCache: true },
) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  reindexComponents(components);

  const comps = new Components();
  const renderer = new Renderer(comps);
  const app = new App(container, comps, renderer, ParseContext);
  const scope = app.registerComponents(components);
  if (macros) scope.registerMacros(macros);
  if (opts.requestHandlers) scope.registerRequestHandlers(opts.requestHandlers);
  app.rootViewName = opts.view ?? null;
  app.transactor.state.set(rootState);
  app.start(opts);

  return {
    container,
    app,
    cleanup() {
      app.stop();
      container.remove();
    },
  };
}

export function renderToHTML(document, components, macros, rootState, ParseContext) {
  const { container, cleanup } = renderToHTMLNode(
    document,
    components,
    macros,
    rootState,
    ParseContext,
  );
  const html = serializeContainer(container);
  cleanup();
  return html;
}

// Mount `rootState`, drive it through one `on`-phase config, wait for the whole
// cascade to settle, and only then serialize. This is what the storybook does on
// first display (Section init -> Example.runPhase), so it is what a headless render
// must do too: without it, an example whose interesting state only exists after
// `on.init` is serialized in its pristine, never-driven form.
//
// Mirrors `drive()` in tools/core/test.js — same dispatchPhase + settle pair, so the
// `render` gate exercises components exactly the way the `test` gate does.
export async function renderToHTMLDriven(
  document,
  components,
  macros,
  rootState,
  ParseContext,
  { phase = null, requestHandlers = null, view = null, warn = console.warn } = {},
) {
  const { container, app, cleanup } = renderToHTMLNode(
    document,
    components,
    macros,
    rootState,
    ParseContext,
    { noCache: true, requestHandlers, view },
  );
  try {
    if (phase) {
      // The example's value IS the root here, so a `bubble` travels child->parent out
      // of a component with no ancestor and reaches no author handler (and the root's
      // own bubble handler is skipped). Same no-op as drive(); warn rather than lie.
      if (phaseHasBubble(phase))
        warn(
          "render: a `bubble` action is a no-op here — the example's value is the render root, so there is no ancestor to receive it. Use send/request/input to drive a preset state.",
        );
      dispatchPhase(rootDispatcher(app.transactor), new Path([]), phase, app.state.val);
      await app.transactor.settle();
    }
    return serializeContainer(container);
  } finally {
    cleanup();
  }
}
