import { component, html } from "tutuca";

export const DangerSetInnerHtml = component({
  name: "DangerSetInnerHtml",
  fields: { content: "<strong><em>Raw HTML!</em></strong>" },
  view: html`<section>
    <div @dangerouslysetinnerhtml=".content"></div>
  </section>`,
});

export function getComponents() {
  return [DangerSetInnerHtml];
}

export function getRoot() {
  return DangerSetInnerHtml.make({});
}
