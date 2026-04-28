import { component, html } from "tutuca";
import { Entry } from "./entry.js";
import { ITEMS } from "./_shared-data.js";

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
  </section>`,
});

export function getComponents() {
  return [PushView, Entry];
}

export function getRoot() {
  const ENTRIES = ITEMS.map((v) => Entry.make({ title: v, description: `Length: ${v.length}` }));
  return PushView.make({ items: ENTRIES });
}

export function getExamples() {
  const ENTRIES = ITEMS.map((v) => Entry.make({ title: v, description: `Length: ${v.length}` }));
  return {
    title: "Push View",
    description: "@push-view forces children to render under a different view",
    items: [
      {
        title: "Default (Read Only)",
        description: "Default 'main' view",
        value: PushView.make({ items: ENTRIES }),
      },
      {
        title: "Edit View",
        description: "Pushed 'edit' view",
        value: PushView.make({ items: ENTRIES, view: "edit" }),
      },
    ],
  };
}
