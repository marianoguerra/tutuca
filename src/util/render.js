import { App } from "../app.js";
import { Components } from "../components.js";
import { Renderer } from "../renderer.js";
import { render } from "../vdom.js";

function reindexComponents(comps) {
  for (let i = 0; i < comps.length; i++) {
    comps[i].id = i;
  }
}

export function renderToHTMLNode(document, components, macros, rootState, ParseContext) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  reindexComponents(components);

  const comps = new Components();
  const ropts = { document };
  const render1 = (vnode, cont) => render(vnode, cont, ropts);
  const renderer = new Renderer(comps);
  const app = new App(container, render1, comps, renderer, ParseContext);
  const scope = app.registerComponents(components);
  if (macros) scope.registerMacros(macros);
  app.transactor.state.set(rootState);
  app.start({ noCache: true });

  for (const input of container.querySelectorAll("input")) {
    if (input.value) input.setAttribute("value", input.value);
    if (input.checked) input.setAttribute("checked", "");
  }

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
  const html = container.innerHTML;
  cleanup();
  return html;
}
