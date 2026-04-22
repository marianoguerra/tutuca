import { component, html } from "tutuca";

export const AttributeBinding = component({
  name: "AttributeBinding",
  fields: { str: "hello", num: 42, bool: true, notSet: null },
  methods: {
    setRawNumber(v) {
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? this : this.setNum(n);
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      :value=".str"
      @on.input=".setStr value"
      :title="Content is {.str}"
      class="input"
    />
    <input
      :value=".num"
      type="number"
      @on.input=".setRawNumber value"
      class="input"
    />
    <input
      :value=".bool"
      type="checkbox"
      @on.input=".setBool value"
      class="checkbox"
    />

    <p>String: <span @text=".str"></span></p>
    <p>Number: <span @text=".num"></span></p>
    <p>Boolean: <span @text=".bool"></span></p>
  </section>`,
});

export function getComponents() {
  return [AttributeBinding];
}

export function getRoot() {
  return AttributeBinding.make({});
}

export function getExamples() {
  return {
    title: "Attribute Binding",
    description: "Two-way binding for string, number and boolean fields",
    items: [
      {
        title: "Defaults",
        description: "Initial field values",
        value: AttributeBinding.make(),
      },
      {
        title: "Custom Values",
        description: "Pre-populated with non-default state",
        value: AttributeBinding.make({ str: "world", num: 7, bool: false }),
      },
    ],
  };
}
