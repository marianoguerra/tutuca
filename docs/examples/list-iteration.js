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
