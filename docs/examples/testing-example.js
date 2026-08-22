import { collectIterBindings, component, html } from "tutuca";
import { produce } from "tutuca/immer";

const Greeter = component({
  name: "Greeter",
  fields: { name: "Ada", greetings: ["hello, Ada!"], filter: "" },
  receive: {
    setFilter(draft, value) {
      draft.filter = value;
    },
    addGreeting(draft) {
      draft.greetings.push(`hello, ${draft.name}!`);
    },

    submitName(draft, value) {
      draft.name = value;
    },
  },
  alter: {
    matchesFilter(_k, item) {
      return this.filter === "" || item.toLowerCase().includes(this.filter.toLowerCase());
    },
    enrichLength(binds, _k, item) {
      binds.len = item.length;
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div class="join">
      <input
        type="text"
        class="input join-item"
        :value=".name"
        @on.input="submitName e.value"
        placeholder="Name"
      />
      <button class="btn btn-primary join-item" @on.click="addGreeting">Greet</button>
    </div>
    <input
      type="search"
      class="input"
      :value=".filter"
      @on.input="setFilter e.value"
      placeholder="Filter greetings"
    />
    <ul>
      <li @each=".greetings" @when="matchesFilter" @enrich-with="enrichLength">
        <x text="@value"></x> &mdash; <x text="@len"></x> chars
      </li>
    </ul>
  </section>`,
});

export function getComponents() {
  return [Greeter];
}

export function getRoot() {
  return Greeter.make({});
}

export function getExamples() {
  return {
    title: "Testing Example",
    description: "A small component with receive handlers, computed methods, and iteration",
    items: [{ title: "Default", description: "Initial state", value: Greeter.make() }],
  };
}

export function getTests({ describe, test, expect }) {
  describe(Greeter, () => {
    describe("addGreeting — receive handler", () => {
      test("appends a personalized greeting", () => {
        const current = Greeter.make({ name: "Linus", greetings: [] });
        const next = produce(current, (draft) => {
          Greeter.receive.addGreeting.call(current, draft);
        });
        expect(next.greetings).toEqual(["hello, Linus!"]);
      });
      test("does not mutate the original instance", () => {
        const g = Greeter.make({ name: "Ada", greetings: [] });
        produce(g, (draft) => {
          Greeter.receive.addGreeting.call(g, draft);
        });
        expect(g.greetings.length).toBe(0);
      });
    });

    describe("submitName() — input handler", () => {
      test("sets the name from the input value", () => {
        const current = Greeter.make();
        const next = produce(current, (draft) => {
          Greeter.receive.submitName.call(current, draft, "Grace");
        });
        expect(next.name).toBe("Grace");
      });
    });

    describe("iteration: @when + @enrich-with", () => {
      test("filters by substring and enriches with length", () => {
        const g = Greeter.make({
          greetings: ["hello, Ada!", "hi", "hello, Linus!"],
          filter: "ada",
        });
        const r = collectIterBindings(Greeter, g, g.greetings, {
          when: "matchesFilter",
          enrichWith: "enrichLength",
        });
        expect(r).toEqual([{ key: 0, value: "hello, Ada!", len: 11 }]);
      });

      test("empty filter keeps every item", () => {
        const g = Greeter.make({ greetings: ["a", "bb", "ccc"], filter: "" });
        const r = collectIterBindings(Greeter, g, g.greetings, {
          when: "matchesFilter",
          enrichWith: "enrichLength",
        });
        expect(r.map((b) => b.len)).toEqual([1, 2, 3]);
      });
    });
  });
}
