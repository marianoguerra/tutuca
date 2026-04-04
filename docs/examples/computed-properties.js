import { component, html } from "tutuca";
import { ITEMS } from "./shared.js";

export const ComputedProperties = component({
  name: "ComputedProperties",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item, iterData) {
      return item.toLowerCase().includes(iterData.queryLower);
    },
    enrichItem(binds, _key, item, iterData) {
      binds.count = item.length;
      binds.total = iterData.totalChars;
    },
    getIterData(_seq) {
      return { queryLower: this.query.toLowerCase() };
    },
  },
  computed: {
    totalItemsChars() {
      console.log("computing totalItemsChars");
      let totalChars = 0;
      for (const item of this.items) {
        totalChars += item.length;
      }
      return totalChars;
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
      <li
        @each=".items"
        @when="filterItem"
        @enrich-with="enrichItem"
        @loop-with="getIterData"
      >
        <span @text="@key"></span>: <x text="@value"></x> (<x text="@count"></x>
        / <x text="$totalItemsChars"></x>)
      </li>
    </ul>
  </section>`,
});

export function getComponents() {
  return [ComputedProperties];
}

export function getRoot() {
  return ComputedProperties.make({ items: ITEMS });
}
