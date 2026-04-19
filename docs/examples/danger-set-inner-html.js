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

export function getStoryBookSection() {
  return {
    title: "Dangerously Set Inner HTML",
    description: "Renders raw HTML content into the DOM",
    items: [
      {
        title: "Default",
        description: "Bold and italic markup",
        item: DangerSetInnerHtml.make(),
      },
      {
        title: "Custom Markup",
        description: "Headings and lists",
        item: DangerSetInnerHtml.make({
          content: "<h3>Title</h3><ul><li>One</li><li>Two</li></ul>",
        }),
      },
    ],
  };
}
