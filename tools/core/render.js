import { renderToHTML } from "../../src/util/render.js";
import { RenderBatch, RenderedExample } from "./results.js";

export function renderExamples(normalized, env, { name = null, title = null, view = null } = {}) {
  const { section } = normalized;
  if (!section) {
    return new RenderBatch({ section: null, items: [] });
  }

  const items = [];
  for (const { groupTitle, example } of section.flatten()) {
    const componentName = example.componentName;
    if (name !== null && componentName !== name) continue;
    if (title !== null && example.title !== title) continue;

    const viewName = view ?? example.view ?? "main";
    let html = "";
    let error = null;
    try {
      html = renderToHTML(
        env.document,
        normalized.components,
        normalized.macros,
        example.value,
        env.ParseContext,
      );
    } catch (e) {
      error = { message: e.message, stack: e.stack };
    }

    items.push(
      new RenderedExample({
        groupTitle,
        title: example.title,
        description: example.description,
        componentName,
        view: viewName,
        html,
        error,
      }),
    );
  }

  return new RenderBatch({ section, items });
}
