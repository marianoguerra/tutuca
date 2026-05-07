import { component, html } from "tutuca";
import { collectIterBindings } from "tutuca";

const Greeter = component({
  name: "Greeter",
  fields: { name: "Ada", greetings: ["hello, Ada!"], filter: "" },
  methods: {
    addGreeting() {
      return this.setGreetings(this.greetings.push(`hello, ${this.name}!`));
    },
  },
  input: {
    submitName(value) {
      return this.setName(value);
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
        @on.input="submitName value"
        placeholder="Name"
      />
      <button class="btn btn-primary join-item" @on.click=".addGreeting">
        Greet
      </button>
    </div>
    <input
      type="search"
      class="input"
      :value=".filter"
      @on.input=".setFilter value"
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
    description: "A small component with methods, input handlers, and iteration",
    items: [{ title: "Default", description: "Initial state", value: Greeter.make() }],
  };
}

export function getTests({ describe, test, expect }) {
  describe(Greeter, () => {
    describe("addGreeting() — method", () => {
      test("appends a personalized greeting", () => {
        const next = Greeter.make({ name: "Linus", greetings: [] }).addGreeting();
        expect(next.greetings.toArray()).to.deep.equal(["hello, Linus!"]);
      });
      test("does not mutate the original instance", () => {
        const g = Greeter.make({ name: "Ada", greetings: [] });
        g.addGreeting();
        expect(g.greetings.size).to.equal(0);
      });
    });

    describe("submitName() — input handler", () => {
      test("sets the name from the input value", () => {
        const next = Greeter.input.submitName.call(Greeter.make(), "Grace");
        expect(next.name).to.equal("Grace");
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
        expect(r).to.deep.equal([{ key: 0, value: "hello, Ada!", len: 11 }]);
      });

      test("empty filter keeps every item", () => {
        const g = Greeter.make({ greetings: ["a", "bb", "ccc"], filter: "" });
        const r = collectIterBindings(Greeter, g, g.greetings, {
          when: "matchesFilter",
          enrichWith: "enrichLength",
        });
        expect(r.map((b) => b.len)).to.deep.equal([1, 2, 3]);
      });
    });
  });
}
