import { component, html } from "tutuca";

export const EventModifiers = component({
  name: "EventModifiers",
  fields: { query: "", lastSentSearch: null },
  input: {
    onInput(value) {
      return this.setQuery(value);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      class="input"
      :value=".query"
      @on.input="onInput value"
      @on.keydown+send=".setLastSentSearch value"
      @on.keydown+cancel=".resetQuery"
      placeholder="Search Query (Enter to send, Esc to clear)"
    />
    <p @show=".isLastSentSearchSet">
      Search: "<span @text=".lastSentSearch"></span>"
    </p>
  </section>`,
});

export function getComponents() {
  return [EventModifiers];
}

export function getRoot() {
  return EventModifiers.make({});
}

export function getExamples() {
  return {
    title: "Event Modifiers",
    description: "Send/cancel keyboard modifiers on input events",
    items: [
      {
        title: "Empty",
        description: "Nothing typed yet",
        value: EventModifiers.make(),
      },
      {
        title: "With Sent Search",
        description: "Pre-populated with a previously sent query",
        value: EventModifiers.make({
          query: "tutuca",
          lastSentSearch: "tutuca",
        }),
      },
    ],
  };
}
