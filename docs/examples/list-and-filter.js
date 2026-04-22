import { component, html } from "tutuca";
import { ITEMS } from "./shared.js";

export const ListAndFilter = component({
  name: "ListAndFilter",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item) {
      return item.toLowerCase().includes(this.query.toLowerCase());
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      :value=".query"
      @on.input=".setQuery value"
      @on.keydown+cancel=".resetQuery"
      class="input"
      placeholder="Filter entries"
    />
    <ul>
      <li @each=".items" @when="filterItem">
        <span @text="@key"></span>: <x text="@value"></x>
      </li>
    </ul>
  </section>`,
});

export function getComponents() {
  return [ListAndFilter];
}

export function getRoot() {
  return ListAndFilter.make({ items: ITEMS });
}

export function getExamples() {
  return {
    title: "List and Filter",
    description: "Render a list with a search filter",
    items: [
      {
        title: "Default",
        description: "Full list, no filter",
        value: ListAndFilter.make({ items: ITEMS }),
      },
      {
        title: "Pre-filtered",
        description: "Initial query applied",
        value: ListAndFilter.make({ items: ITEMS, query: "those" }),
      },
      {
        title: "Empty",
        description: "No items",
        value: ListAndFilter.make({ items: [] }),
      },
    ],
  };
}
