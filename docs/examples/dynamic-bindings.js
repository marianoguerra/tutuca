import { component, html } from "tutuca";

const SelectorEntry = component({
  name: "SelectorEntry",
  fields: { value: "entry-value", label: "Entry Label" },
  view: html`<div class="flex gap-3">
        <input class="input" :value=".value" @on.input=".setValue value" />
        <input class="input" :value=".label" @on.input=".setLabel value" />
    </div>`,
});

const Selector = component({
  name: "Selector",
  fields: { items: [], selectedValue: null },
  dynamic: {
    entries: { for: "EntryEditorAndSelector.entries", default: ".items" },
  },
  alter: {
    enrichOption(binds, _key, item) {
      binds.value = item.value;
      binds.label = item.label;
    },
  },
  view: html`<select class="select" :value=".selectedValue" @on.input=".setSelectedValue value">
    <option
      @each="*entries"
      @enrich-with="enrichOption"
      :value="@value"
      @text="@label"
    ></option>
  </select>`,
});

const EntryEditorAndSelector = component({
  name: "EntryEditorAndSelector",
  fields: {
    items: [],
    selector: null,
  },
  dynamic: { entries: ".items" },
  on: {
    stackEnter() {
      return ["entries"];
    },
  },
  input: {
    onAddItem(SelectorEntry) {
      const num = this.items.size + 1;
      return this.pushInItems(
        SelectorEntry.make({ value: `entry-${num}`, label: `Entry #${num}` }),
      );
    },
  },
  view: html`<div class="flex flex-col gap-3">
    <div class="flex gap-3 justify-center">
      <x render=".selector"></x>
    </div>
    <button class="btn btn-soft btn-success" @on.click="onAddItem SelectorEntry">
      Add Entry
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
  return [EntryEditorAndSelector, Selector, SelectorEntry];
}

export function getRoot() {
  return EntryEditorAndSelector.make({
    selector: Selector.make(),
    items: [SelectorEntry.make({ value: "entry-1", label: "Entry #1" })],
  });
}

export function getExamples() {
  return {
    title: "Dynamic Bindings",
    description: "...",
    items: [
      {
        title: "Default",
        description: "Empty editor with selector",
        value: EntryEditorAndSelector.make({ selector: Selector.make() }),
      },
      {
        title: "Some Entries",
        value: EntryEditorAndSelector.make({
          selector: Selector.make(),
          items: [
            SelectorEntry.make(),
            SelectorEntry.make({ value: "hello", label: "Hello World" }),
          ],
        }),
      },
    ],
  };
}
