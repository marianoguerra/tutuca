import { component, html } from "tutuca";
import { ITEMS } from "./shared.js";

export const ListFilterEnrichWith = component({
  name: "ListFilterEnrichWith",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item, iterData) {
      return item.toLowerCase().includes(iterData.queryLower);
    },
    enrichItem(binds, _key, item, iterData) {
      binds.count = item.length;
      binds.total = iterData.totalChars;
    },
    getIterData(seq) {
      let totalChars = 0;
      for (const item of seq) {
        totalChars += item.length;
      }
      return { totalChars, queryLower: this.query.toLowerCase() };
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
        / <x text="@total"></x>)
      </li>
    </ul>
  </section>`,
});

export function getComponents() {
  return [ListFilterEnrichWith];
}

export function getRoot() {
  return ListFilterEnrichWith.make({ items: ITEMS });
}

export function getStoryBookSection() {
  return {
    title: "List Filter + Enrich With",
    description: "@loop-with provides shared iteration data",
    items: [
      {
        title: "Default",
        description: "Full list, totals computed once per loop",
        item: ListFilterEnrichWith.make({ items: ITEMS }),
      },
      {
        title: "Pre-filtered",
        description: "Initial query applied",
        item: ListFilterEnrichWith.make({ items: ITEMS, query: "those" }),
      },
    ],
  };
}
