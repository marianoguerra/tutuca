import { component, html } from "tutuca";
import { ITEMS } from "./shared.js";

export const ListIteration = component({
  name: "ListIteration",
  fields: { items: [] },
  view: html`<section>
    <ul>
      <li @each=".items"><span @text="@key"></span>: <x text="@value"></x></li>
    </ul>
  </section>`,
});

export function getComponents() {
  return [ListIteration];
}

export function getRoot() {
  return ListIteration.make({ items: ITEMS });
}

export function getExamples() {
  return {
    title: "List Iteration",
    description: "@each renders one element per item",
    items: [
      {
        title: "Default",
        description: "Iterating over the shared sample list",
        value: ListIteration.make({ items: ITEMS }),
      },
      {
        title: "Empty",
        description: "No items",
        value: ListIteration.make({ items: [] }),
      },
      {
        title: "Custom Items",
        description: "Custom small list",
        value: ListIteration.make({ items: ["one", "two", "three"] }),
      },
    ],
  };
}
