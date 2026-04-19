import { component, html } from "tutuca";

const StaticViewComponent = component({
  view: html`<p>Hello, world!</p>`,
});

export function getComponents() {
  return [StaticViewComponent];
}

export function getRoot() {
  return StaticViewComponent.make({});
}

export function getStoryBookSection() {
  return {
    title: "Static View Component",
    description: "Component with only a static view",
    items: [
      {
        title: "Default",
        description: "Renders a simple greeting",
        item: StaticViewComponent.make(),
      },
    ],
  };
}
