import { component, html } from "tutuca";

export const Entry = component({
  name: "Entry",
  fields: { title: "Entry Title", description: "Entry Description" },
  methods: {
    containsText(s) {
      return this.title.includes(s) || this.description.includes(s);
    },
  },
  view: html`<div class="card bg-base-100 shadow-sm">
    <div class="card-body">
      <h2 class="card-title" @text=".title"></h2>
      <p @text=".description"></p>
    </div>
  </div>`,
  views: {
    edit: html`<div class="card bg-base-100 shadow-sm gap-3">
      <div class="card-body">
        <input class="input" :value=".title" @on.input=".setTitle value" />
        <input
          class="input"
          :value=".description"
          @on.input=".setDescription value"
        />
      </div>
    </div> `,
  },
});

export function getComponents() {
  return [Entry];
}

export function getRoot() {
  return Entry.make({});
}
