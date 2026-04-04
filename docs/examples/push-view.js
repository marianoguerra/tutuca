import { component, html } from "tutuca";
import { Entry } from "./entry.js";
import { ITEMS } from "./shared.js";

export const PushView = component({
  name: "PushView",
  fields: { items: [], query: "", view: "main" },
  methods: {
    toggleView() {
      return this.setView(this.view === "main" ? "edit" : "main");
    },
    getToggleLabel() {
      return this.view === "main" ? "Set Edit Mode" : "Set Read Only";
    },
  },
  alter: {
    filterItem(_key, item) {
      return item.containsText(this.query);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div class="flex justify-between">
      <input
        type="search"
        :value=".query"
        @on.input=".setQuery value"
        @on.keydown+cancel=".resetQuery"
        class="input"
        placeholder="Filter entries"
      />
      <button
        class="btn bnt-sm btn-primary"
        @text=".getToggleLabel"
        @on.click=".toggleView"
      ></button>
    </div>
    <div
      class="flex flex-col gap-3 max-h-[40vh] overflow-y-auto pr-3"
      @push-view=".view"
    >
      <x render-each=".items" when="filterItem"></x>
    </div>
    <div class="alert alert-info justify-center">
      Search to filter, toggle edit mode, edit content, filter some more, edit
      again, toggle read only mode, filter some more.
    </div>
  </section>`,
});

export function getComponents() {
  return [PushView, Entry];
}

export function getRoot() {
  const ENTRIES = ITEMS.map((v) => Entry.make({ title: v, description: `Length: ${v.length}` }));
  return PushView.make({ items: ENTRIES });
}
