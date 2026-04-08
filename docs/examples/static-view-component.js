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
