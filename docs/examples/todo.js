import { component, html } from "tutuca";

const Item = component({
  name: "Item",
  fields: {
    completed: false,
    text: "do the thing",
  },
  view: html`<div class="flex gap-3 items-center">
    <input
      type="checkbox"
      class="checkbox"
      :checked=".completed"
      @on.input=".setCompleted value"
    />
    <input
      class="input"
      :value=".text"
      @on.input=".setText value"
      :disabled=".completed"
    />
  </div>`,
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
  view: html`<div class="flex flex-col gap-3">
    <button class="btn btn-soft btn-success" @on.click="onAddItem Item">
      Add Task
    </button>
    <div class="flex flex-col gap-3 w-full">
      <div @each=".items" class="flex gap-3 justify-center items-center w-full">
        <x render-it></x>
        <button
          class="btn btn-soft btn-sm btn-error btn-circle font-mono"
          @on.click=".removeInItemsAt @key"
        >
          x
        </button>
      </div>
    </div>
  </div>`,
});

export function getComponents() {
  return [Items, Item];
}

export function getRoot() {
  return Items.make({ items: [Item.make({})] });
}

export function getStoryBookSection() {
  return {
    title: "To Do",
    description: "...",
    items: [
      { title: "Default Item", description: "aka empty", item: Item.make() },
      { title: "Completed Item", item: Item.make({ completed: true }) },
      {
        title: "Completed No Text",
        item: Item.make({ completed: true, text: "" }),
      },
      { title: "Default Items", item: Items.make() },
      {
        title: "Some Items",
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
