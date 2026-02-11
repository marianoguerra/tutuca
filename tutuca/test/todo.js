import { component, html, macro } from "../index.js";

const Item = component({
  name: "Item",
  fields: {
    completed: false,
    text: "do the thing",
  },
  view: html`<x:hbox>
    <x:checkbox :value=".completed" :handler=".setCompleted"></x:checkbox>
    <x:input
      :value=".text"
      :handler=".setText"
      :disabled=".completed"
    ></x:input>
  </x:hbox>`,
});

const Items = component({
  name: "Items",
  fields: {
    items: [],
  },
  input: {
    onAddItem(Item) {
      return this.pushInItems(Item.make({ completed: false, text: "do the thing" }));
    },
  },
  view: html`<x:vbox>
    <x:btn-action
      label="Add Task"
      :handler="onAddItem"
      :arg="Item"
    ></x:btn-action>
    <x:vbox class="w-full">
      <div @each=".items" class="flex gap-3 justify-center items-center w-full">
        <x render-it></x>
        <x:btn-rm :handler=".removeInItemsAt" :arg="@key"></x:btn-rm>
      </div>
    </x:vbox>
  </x:vbox>`,
});

const checkbox = macro(
  { value: ".value", handler: ".setValue" },
  html`<input
    type="checkbox"
    class="checkbox"
    :checked="^value"
    @on.input="^handler value"
  />`,
);

const input = macro(
  { value: ".value", handler: ".setValue", disabled: "false" },
  html`<input
    class="input"
    :value="^value"
    @on.input="^handler value"
    :disabled="^disabled"
  />`,
);

const btnRm = macro(
  { handler: "onRemove", arg: "event" },
  html`<button
    class="btn btn-ghost btn-sm btn-error btn-circle"
    @on.click="^handler ^arg"
  >
    x
  </button>`,
);

const btnAction = macro(
  { handler: "onAction", arg: "event", label: "'Action'" },
  html`<button
    class="btn btn-outline btn-success"
    @on.click="^handler ^arg"
    @text="^label"
  ></button>`,
);

const hbox = macro(
  { class: "''" },
  html`<div :class="flex gap-3 items-center {^class}">
    <x:slot></x:slot>
  </div>`,
);

const vbox = macro(
  { class: "''" },
  html`<div :class="flex flex-col gap-3 {^class}">
    <x:slot name="_"></x:slot>
  </div>`,
);

export function getMacros() {
  return {
    "btn-rm": btnRm,
    "btn-action": btnAction,
    checkbox,
    input,
    hbox,
    vbox,
  };
}

export function getExamples() {
  return [
    { title: "Empty list", value: Items.make() },
    { title: "Single default item", value: Items.make({ items: [Item.make()] }) },
    { title: "Single item with custom text", value: Items.make({ items: [Item.make({ text: "buy milk" })] }) },
    { title: "Completed item", value: Items.make({ items: [Item.make({ completed: true, text: "done task" })] }) },
    {
      title: "Multiple items",
      value: Items.make({
        items: [
          Item.make({ text: "first" }),
          Item.make({ text: "second" }),
          Item.make({ text: "third" }),
        ],
      }),
    },
    {
      title: "Mixed completed and incomplete items",
      value: Items.make({
        items: [
          Item.make({ completed: true, text: "done" }),
          Item.make({ completed: false, text: "pending" }),
        ],
      }),
    },
  ];
}

export function getComponents() {
  return [Items, Item];
}
