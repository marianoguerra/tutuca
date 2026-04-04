import { component, css, html } from "tutuca";

export const TreeItem = component({
  name: "TreeItem",
  fields: { type: "dir", label: "A Tree Item", isOpen: true, items: [] },
  methods: {
    areChildsVisible() {
      return this.isOpen && this.items.size > 0;
    },
  },
  statics: {
    fromData({ type = "dir", label = "A Tree Item", isOpen = true, items = [] }) {
      return TreeItem.make({
        type,
        label,
        isOpen,
        items: items.map((v) => TreeItem.Class.fromData(v)),
      });
    },
  },
  input: {
    onItemClick(ctx) {
      ctx.bubble("treeItemSelected", [this]);
      return this.toggleIsOpen();
    },
  },
  bubble: {
    treeItemSelected(_selectedItem) {
      return this;
    },
  },
  style: css`
    user-select: none;
    .head {
      cursor: pointer;
    }
    .head:before {
      content: "⏺️";
      margin-right: 0.25rem;
    }
    .head.type-file:before {
      content: "📄️";
    }
    .head.open.type-dir:before {
      content: "📂️";
    }
    .head.closed.type-dir:before {
      content: "📁️";
    }
  `,
  view: html`<secction>
    <p
      @if.class=".isOpen"
      @then="head open type-{.type}"
      @else="head closed type-{.type}"
      @text=".label"
      @on.click="onItemClick ctx"
    ></p>
    <div class="pl-3 pt-1 flex flex-col gap-2" @show=".areChildsVisible">
      <x render-each=".items"></x>
    </div>
  </secction>`,
});

export const TreeRoot = component({
  name: "TreeRoot",
  fields: { items: [], log: [] },
  statics: {
    fromData(items) {
      return TreeRoot.make({
        items: items.map((v) => TreeItem.Class.fromData(v)),
      });
    },
  },
  bubble: {
    treeItemSelected(selectedItem) {
      const msg = `Selected ${selectedItem.type}: ${selectedItem.label}`;
      return this.insertInLogAt(0, msg);
    },
  },
  view: html`<secction class="flex gap-2">
    <div class="flex flex-col gap-2 flex-1">
      <x render-each=".items"></x>
    </div>
    <div class="flex flex-col gap-2 max-h-[40vh] overflow-y-auto flex-1">
      <p @each=".log" @text="@value"></p>
    </div>
  </secction>`,
});

export function getComponents() {
  return [TreeRoot, TreeItem];
}

export function getRoot() {
  return TreeRoot.Class.fromData([
    {
      label: "home",
      items: [
        {
          label: "alice",
          items: [
            { type: "file", label: ".bashrc" },
            { type: "file", label: ".profile" },
          ],
        },
        {
          label: "bob",
          items: [
            { type: "file", label: ".zrc" },
            {
              label: "Desktop",
              items: [{ type: "file", label: ".DS_Store" }],
            },
          ],
        },
      ],
    },
    {
      label: "etc",
      items: [{ type: "file", label: "passwd" }],
    },
  ]);
}
