import { component, html } from "tutuca";
import { Entry } from "./entry.js";

export const MultipleViews = component({
  name: "MultipleViews",
  fields: { item: Entry.make() },
  view: html`<section class="flex flex-col gap-3">
    <x render=".item"></x>
    <x render=".item" as="edit"></x>
  </section>`,
});

export function getComponents() {
  return [MultipleViews, Entry];
}

export function getRoot() {
  return MultipleViews.make({});
}
