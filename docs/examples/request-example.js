import { component, html } from "tutuca";
import { Entry } from "./entry.js";

export const RequestExample = component({
  name: "RequestExample",
  fields: { items: [], query: "", view: "main", isLoading: false },
  methods: {
    toggleView() {
      return this.setView(this.view === "main" ? "edit" : "main");
    },
    loadAnotherWay(ctx) {
      ctx.request("loadData", [], {
        onOkName: "loadDataOk",
        onErrorName: "loadDataError",
      });
      return this.setIsLoading(true);
    },
    updateFromResponse(res) {
      const items = res.map(({ title, description }) => Entry.make({ title, description }));
      return this.setIsLoading(false).setItems(items);
    },
  },
  logic: {
    init(ctx) {
      ctx.request("loadData", []);
      return this.setIsLoading(true);
    },
  },
  response: {
    loadData(res, err) {
      console.log({ res, err });
      return this.updateFromResponse(res);
    },
    loadDataOk(res) {
      return this.updateFromResponse(res);
    },
    loadDataErr(err) {
      console.error(err);
      return this.setIsLoading(false);
    },
  },
  alter: {
    filterItem(_key, item) {
      return item.containsText(this.query);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div @show=".isLoading" class="alert alert-info alert-outline">Loading</div>
    <div class="flex justify-between" @hide=".isLoading">
      <input
        type="search"
        :value=".query"
        @on.input=".setQuery value"
        @on.keydown+cancel=".resetQuery"
        class="input"
        placeholder="Filter entries"
      />
      <button
        class="btn bnt-sm btn-primary btn-outline"
        @on.click=".loadAnotherWay ctx"
      >
        Load Another Way
      </button>
      <button
        class="btn bnt-sm btn-primary"
        @text=".view"
        @on.click=".toggleView"
      ></button>
    </div>
    <div
      class="flex flex-col gap-3 max-h-[40vh] overflow-y-auto pr-3"
      @hide=".isLoading"
      @push-view=".view"
    >
      <x render-each=".items" when="filterItem"></x>
    </div>
  </section>`,
});

export function getComponents() {
  return [RequestExample, Entry];
}

export function getRoot() {
  return RequestExample.make({});
}

export function getRequestHandlers() {
  return {
    async loadData() {
      const req = await fetch("https://marianoguerra.github.io/data.json");
      return await req.json();
    },
  };
}
