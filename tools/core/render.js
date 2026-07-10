import { renderToHTMLDriven } from "../../src/util/render.js";
import { RenderBatch, RenderedExample, RenderedSection } from "./results.js";

// `Comp.getView(name)` falls back to `main` for an unknown name, which would make a
// typo'd `view:` silently render the wrong view while the report claimed otherwise.
// Resolve it here so a bad name becomes a rendered error instead.
function checkView(value, components, viewName) {
  if (viewName === "main") return null;
  const comp = components.find((c) => value instanceof c.Class);
  if (!comp || comp.views[viewName]) return null;
  const known = Object.keys(comp.views).sort().join(", ");
  return new Error(`view "${viewName}" is not defined on ${comp.name} (has: ${known})`);
}

// An example's own mocks win over the module's real handlers, matching how the
// storybook resolves them (nearest example first — see buildExampleRequestHandlers).
function handlersFor(normalized, example) {
  const merged = { ...(normalized.requestHandlers ?? {}), ...(example.requestHandlers ?? {}) };
  return Object.keys(merged).length > 0 ? merged : null;
}

export async function renderExamples(
  normalized,
  env,
  { name = null, title = null, view = null } = {},
) {
  const sections = [];
  for (const section of normalized.sections) {
    const items = [];
    for (const example of section.items) {
      const componentName = example.componentName;
      if (name !== null && componentName !== name) continue;
      if (title !== null && example.title !== title) continue;

      const viewName = view ?? example.view ?? "main";
      let html = "";
      let error = null;
      try {
        const bad = checkView(example.value, normalized.components, viewName);
        if (bad) throw bad;
        // Drive `on.init` — the phase the storybook fires on an example's first
        // display. `resume`/`suspend` are transitions between displays and have no
        // meaning for a one-shot render, so they are not run here.
        html = await renderToHTMLDriven(
          env.document,
          normalized.components,
          normalized.macros,
          example.value,
          env.ParseContext,
          {
            phase: example.on?.init ?? null,
            requestHandlers: handlersFor(normalized, example),
            view: viewName,
          },
        );
      } catch (e) {
        error = { message: e.message, stack: e.stack };
      }

      items.push(
        new RenderedExample({
          title: example.title,
          description: example.description,
          componentName,
          view: viewName,
          html,
          error,
        }),
      );
    }
    if (items.length === 0) continue;
    sections.push(
      new RenderedSection({
        title: section.title,
        description: section.description,
        items,
      }),
    );
  }

  return new RenderBatch({ sections });
}
