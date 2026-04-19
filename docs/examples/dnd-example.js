import { component, css, html } from "tutuca";
import { ITEMS } from "./shared.js";

function moveKeyIndexToIndex(list, source, target, offset = 0) {
  if (source === -1 || target === -1 || source === target) {
    return list;
  }
  const newPos = target + offset;
  const oldPos = newPos < source ? source + 1 : source;
  return list.insert(newPos, list.get(source)).delete(oldPos);
}

function dropWasAbove(e) {
  const rect = e.target.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  return e.clientY < midY;
}

export const DnDExample = component({
  name: "DnDExample",
  fields: { items: [], query: "" },
  alter: {
    filterItem(_key, item) {
      return item.includes(this.query);
    },
  },
  input: {
    onDropOnItem(targetIndex, dragInfo, e) {
      console.log(dragInfo, e);
      const offset = dropWasAbove(e) ? 0 : 1;
      const sourceIndex = dragInfo.lookupBind("key");
      const newItems = moveKeyIndexToIndex(this.items, sourceIndex, targetIndex, offset);
      return this.setItems(newItems);
    },
  },
  style: css`
    [data-dragging="1"] {
      opacity: 0.5;
    }
    [data-draggingover="my-list-item"] {
      border-top: 2rem solid transparent;
      border-bottom: 2rem solid transparent;
      outline: 1px solid #77777777;
      transition: 0.15s border-top ease;
    }
  `,
  view: html`<section class="flex flex-col gap-3">
    <input
      type="search"
      :value=".query"
      @on.input=".setQuery value"
      @on.keydown+cancel=".resetQuery"
      class="input"
      placeholder="Filter entries"
    />
    <div>
      <div
        class="cursor-grab"
        @each=".items"
        @when="filterItem"
        draggable="true"
        data-dragtype="my-list-item"
        data-droptarget="my-list-item"
        @on.drop="onDropOnItem @key dragInfo event"
      >
        <span @text="@key"></span>: <x text="@value"></x>
      </div>
    </div>
  </section>`,
});

export function getComponents() {
  return [DnDExample];
}

export function getRoot() {
  return DnDExample.make({ items: ITEMS });
}

export function getStoryBookSection() {
  return {
    title: "Drag and Drop",
    description: "Reorder list items via drag and drop",
    items: [
      {
        title: "Default",
        description: "Full list, no filter",
        item: DnDExample.make({ items: ITEMS }),
      },
      {
        title: "Pre-filtered",
        description: "Initial query applied",
        item: DnDExample.make({ items: ITEMS, query: "ones" }),
      },
    ],
  };
}
