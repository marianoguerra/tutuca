import { component, macro, html } from "tutuca";

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
      return this.pushInItems(
        Item.make({ completed: false, text: "do the thing" }),
      );
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
    class="btn btn-soft btn-sm btn-error btn-circle"
    @on.click="^handler ^arg"
  >
    x
  </button>`,
);

const btnAction = macro(
  { handler: "onAction", arg: "event", label: "'Action'" },
  html`<button
    class="btn btn-soft btn-success"
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

export function getComponents() {
  return [Items, Item];
}

export function getRoot() {
  return Items.make({ items: [Item.make({ text: "add another one" })] });
}

export function getStoryBookSection() {
  return {
    title: "To Do (Macros)",
    description: "To-Do list built using reusable layout/control macros",
    items: [
      {
        title: "Default Item",
        description: "Single empty item",
        item: Item.make(),
      },
      {
        title: "Completed Item",
        description: "Item flagged completed",
        item: Item.make({ completed: true }),
      },
      {
        title: "Empty List",
        description: "List with no items",
        item: Items.make(),
      },
      {
        title: "Some Items",
        description: "Mixed completion states",
        item: Items.make({
          items: [
            Item.make(),
            Item.make({ completed: true }),
            Item.make({ completed: true, text: "" }),
          ],
        }),
      },
    ],
  };
}
