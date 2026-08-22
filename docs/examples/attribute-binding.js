import { component, html } from "tutuca";

export const AttributeBinding = component({
  name: "AttributeBinding",
  fields: { str: "hello", num: 42, bool: true, notSet: null },
  receive: {
    setStr(draft, value) {
      draft.str = value;
    },
    setBool(draft, value) {
      draft.bool = value;
    },
    setRawNumber(draft, v) {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) draft.num = n;
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input :value=".str" @on.input="setStr e.value" :title="$'Content is {.str}'" class="input" />
    <input :value=".num" type="number" @on.input="setRawNumber e.value" class="input" />
    <input :checked=".bool" type="checkbox" @on.input="setBool e.value" class="checkbox" />

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
