import { component, html, IMap } from "tutuca";

// Dynamic variables used as render targets — a single item and a whole sequence.
//
// `Root` owns a keyed list of entries and a `selectedKey`. It *produces* two
// dynamics:
//   - `items`    = `.items`               — the whole sequence
//   - `selected` = `.items[.selectedKey]` — a seq-access to the selected entry
//
// The child `Editor` *consumes* both: it renders the `*items` sequence (showing
// a dynamic-var sequence can be iterated by a consumer) and renders the
// `*selected` entry in its edit view. The edited entry physically lives in
// `Root.items`, so editing it in the child teleports the mutation back to the
// owner — both lists update in lock-step. Click "select" on a row, then edit.

const Entry = component({
  name: "Entry",
  fields: { name: "" },
  // main view: read-only display, used inside the lists.
  view: html`<span class="font-mono" @text=".name"></span>`,
  views: {
    // edit view: rendered by the child Editor via `<x render="*selected" as="edit">`.
    edit: html`<input
      class="input input-bordered w-full"
      :value=".name"
      @on.input="$setName value"
      placeholder="Entry name"
    />`,
  },
});

const Editor = component({
  name: "Editor",
  fields: {},
  // Consumer: forwards to Root's provides — a sequence and a single item.
  lookup: {
    items: { for: "Root.items", default: ".missing" },
    selected: { for: "Root.selected", default: ".missing" },
  },
  view: html`<div class="card bg-base-200 p-3 gap-3">
    <span class="text-xs opacity-60">Editor (child component)</span>
    <div class="flex flex-col gap-1">
      <span class="text-xs opacity-60">All entries — rendered from the *items lookup:</span>
      <div @each="*items" class="flex gap-3 flex-wrap"><x render-it></x></div>
    </div>
    <div class="flex flex-col gap-1">
      <span class="text-xs opacity-60">Editing the *selected entry:</span>
      <x render="*selected" as="edit"></x>
    </div>
  </div>`,
});

const Root = component({
  name: "Root",
  fields: { items: IMap(), selectedKey: "", editor: null },
  // Producer: the whole sequence, plus a seq-access to the selected entry.
  provide: {
    items: ".items",
    selected: ".items[.selectedKey]",
  },
  input: {
    selectItem(key) {
      return this.setSelectedKey(key);
    },
  },
  view: html`<div class="flex flex-col gap-3 p-3">
    <div class="alert">
      <span>Selected key = <b @text=".selectedKey"></b></span>
    </div>
    <div class="flex flex-col gap-2">
      <span class="text-xs opacity-60">Entries — rendered from the *items dynamic (owner):</span>
      <div @each="*items" class="flex gap-3 items-center">
        <x render-it></x>
        <button class="btn btn-xs btn-soft" @on.click="selectItem @key">select</button>
      </div>
    </div>
    <x render=".editor"></x>
  </div>`,
});

function makeRoot(selectedKey = "a") {
  return Root.make({
    items: IMap({
      a: Entry.make({ name: "alpha" }),
      b: Entry.make({ name: "beta" }),
      c: Entry.make({ name: "gamma" }),
    }),
    selectedKey,
    editor: Editor.make(),
  });
}

export function getComponents() {
  return [Root, Editor, Entry];
}

export function getRoot() {
  return makeRoot();
}

export function getExamples() {
  return {
    title: "Dynamic Selected Entry — Edit in a Child",
    description:
      "The root owns a keyed list and a selected key, exposed as two dynamics: the " +
      "whole sequence `.items` and a seq-access `.items[.selectedKey]`. A child Editor " +
      "renders the *items sequence and edits the *selected entry; edits teleport back " +
      "to the owner's list.",
    items: [
      { title: "First selected", description: "Editing 'alpha'", value: makeRoot("a") },
      { title: "Second selected", description: "Editing 'beta'", value: makeRoot("b") },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(Root, () => {
    test("selectItem changes the selected key", () => {
      const next = Root.input.selectItem.call(makeRoot("a"), "c");
      expect(next.selectedKey).toBe("c");
    });
  });
  describe(Entry, () => {
    test("$setName updates the entry name", () => {
      expect(Entry.make({ name: "x" }).setName("y").name).toBe("y");
    });
  });
}
