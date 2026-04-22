import { component, html } from "tutuca";

export const RenderWithScope = component({
  name: "RenderWithScope",
  fields: { text: "Hello" },
  alter: {
    enrichScope() {
      return { len: this.text.length, upper: this.text.toUpperCase() };
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input :value=".text" @on.input=".setText value" class="input" />
    <div @enrich-with="enrichScope">
      <p>Text: <span @text=".text"></span></p>
      <p>Len: <span @text="@len"></span></p>
      <p>Upper: <span @text="@upper"></span></p>
    </div>
  </section>`,
});

export function getComponents() {
  return [RenderWithScope];
}

export function getRoot() {
  return RenderWithScope.make({});
}

export function getExamples() {
  return {
    title: "Render With Scope",
    description: "@enrich-with adds derived bindings to a sub-tree",
    items: [
      {
        title: "Default",
        description: "Default text",
        value: RenderWithScope.make(),
      },
      {
        title: "Custom Text",
        description: "Pre-populated with longer text",
        value: RenderWithScope.make({ text: "Tutuca" }),
      },
    ],
  };
}
