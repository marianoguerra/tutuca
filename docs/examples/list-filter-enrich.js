import { component, html } from "tutuca";
import { ITEMS } from "./shared.js";

export const ListFilterEnrich = component({
  name: "ListFilterEnrich",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item) {
      return item.toLowerCase().includes(this.query.toLowerCase());
    },
    enrichItem(binds, _key, item) {
      binds.count = item.length;
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
      <li @each=".items" @when="filterItem" @enrich-with="enrichItem">
        <span @text="@key"></span>: <x text="@value"></x> (<x text="@count"></x>
        characters)
      </li>
    </ul>
  </section>`,
});

export function getComponents() {
  return [ListFilterEnrich];
}

export function getRoot() {
  return ListFilterEnrich.make({ items: ITEMS });
}

export function getStoryBookSection() {
  return {
    title: "List Filter + Enrich",
    description: "@when filter combined with @enrich-with bindings",
    items: [
      {
        title: "Default",
        description: "Full list, no filter",
        item: ListFilterEnrich.make({ items: ITEMS }),
      },
      {
        title: "Pre-filtered",
        description: "Initial query applied",
        item: ListFilterEnrich.make({ items: ITEMS, query: "ones" }),
      },
    ],
  };
}
