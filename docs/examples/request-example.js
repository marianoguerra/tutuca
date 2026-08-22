import { component, html } from "tutuca";
import { Entry } from "./entry.js";

export const RequestExample = component({
  name: "RequestExample",
  fields: { items: [], query: "", view: "main", isLoading: false },
  methods: {
    // Same intent, walked along the DEFAULT route (`dyn lex`): the ancestors first,
    // then the registered scopes. The answer arms below do not change with the route —
    // the route says who answers, the arms say what to do about it.
  },
  // The three outcomes of `loadData`, and DECLARING them is what makes this a request
  // rather than a notification — nobody writes that down twice. They arrive as ordinary
  // messages, so a test can drive one with `send` and this component cannot tell the
  // difference. Each has its own shape, so no arm can be handed both a result and an
  // error and read the wrong one.
  receive: {
    setQuery(draft, value) {
      draft.query = value;
    },
    resetQuery(draft) {
      draft.query = this.constructor.getMetaClass().fields.query.defaultValue;
    },
    toggleView(draft) {
      draft.view = draft.view === "main" ? "edit" : "main";
    },
    loadAnotherWay(draft, ctx) {
      ctx.intent("loadData");
      draft.isLoading = true;
    },

    init(draft, ctx) {
      ctx.intent("loadData", [], { route: ["lex"] });
      draft.isLoading = true;
    },
    loadDataOk(draft, res) {
      draft.isLoading = false;
      draft.items = res.map(({ title, description }) => Entry.make({ title, description }));
    },
    loadDataError(draft, err) {
      console.error(err);
      draft.isLoading = false;
    },
    // The route ran out with nobody claiming it — a different thing from a handler
    // refusing, and it carries the intent's own arguments rather than an error.
    loadDataUnhandled(draft) {
      console.warn("nothing on this page answers `loadData`");
      draft.isLoading = false;
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
        @on.input="setQuery e.value"
        @on.keydown+cancel="resetQuery"
        class="input"
        placeholder="Filter entries"
      />
      <button class="btn bnt-sm btn-primary btn-outline" @on.click="loadAnotherWay">
        Load Another Way
      </button>
      <button class="btn bnt-sm btn-primary" @text=".view" @on.click="toggleView"></button>
    </div>
    <div
      class="flex flex-col gap-3 max-h-[40vh] overflow-y-auto pr-3"
      @hide=".isLoading"
      @push-view=".view"
    >
      <x render-each=".items" @when="filterItem"></x>
    </div>
  </section>`,
});

export function getComponents() {
  return [RequestExample, Entry];
}

export function getRoot() {
  return RequestExample.make({});
}

export function getIntentHandlers() {
  return {
    async loadData() {
      const req = await fetch("https://marianoguerra.github.io/data.json");
      return await req.json();
    },
  };
}

export function getExamples() {
  return {
    title: "Request Example",
    description: "Triggers a request on init and renders the response",
    items: [
      {
        title: "Default (Loading)",
        description: "Initial state, waiting for response",
        value: RequestExample.make(),
      },
      {
        title: "Loaded With Items",
        description: "Pre-populated with sample entries",
        value: RequestExample.make({
          isLoading: false,
          items: [
            Entry.make({ title: "First", description: "Item one" }),
            Entry.make({ title: "Second", description: "Item two" }),
          ],
        }),
      },
      {
        title: "Edit View",
        description: "Pushed view for editing",
        value: RequestExample.make({
          isLoading: false,
          view: "edit",
          items: [Entry.make({ title: "Edit me", description: "Then save" })],
        }),
      },
      {
        title: "Mocked response",
        description: "loadData mocked to return fixtures (per-example)",
        value: RequestExample.make({ isLoading: true }),
        intentHandlers: {
          async loadData() {
            return [
              { title: "Mocked A", description: "from a per-example mock" },
              { title: "Mocked B", description: "from a per-example mock" },
            ];
          },
        },
      },
      {
        title: "Mocked error",
        description: "loadData mocked to throw (exercises the error path)",
        value: RequestExample.make({ isLoading: true }),
        intentHandlers: {
          async loadData() {
            throw new Error("mocked failure");
          },
        },
      },
    ],
  };
}
