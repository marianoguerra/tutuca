import { renderToHTML } from "../../src/util/render.js";
import { RenderBatch, RenderedExample, RenderedSection } from "./results.js";

export function renderExamples(normalized, env, { name = null, title = null, view = null } = {}) {
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
          title: example.title,
          description: example.description,
          componentName,
          view: viewName,
          html,
          error,
        }),
      );
    }
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
