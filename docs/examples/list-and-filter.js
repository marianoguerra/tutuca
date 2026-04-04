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
