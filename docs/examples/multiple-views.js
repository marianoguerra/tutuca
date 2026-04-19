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

export function getStoryBookSection() {
  return {
    title: "Multiple Views",
    description: "Render the same component twice using different views",
    items: [
      {
        title: "Default",
        description: "Default Entry rendered as main and edit",
        item: MultipleViews.make(),
      },
      {
        title: "Custom Entry",
        description: "Custom title and description",
        item: MultipleViews.make({
          item: Entry.make({ title: "Hello", description: "world" }),
        }),
      },
    ],
  };
}
