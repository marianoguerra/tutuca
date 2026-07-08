import { component, html } from "tutuca";

const Tab = component({
  name: "Tabs",
  fields: {
    label: "A Tab",
    content: { component: "ComponentSelector", args: {} },
    isEditing: false,
  },
  receive: {
    init(ctx) {
      ctx.at.field("content").send("init");
      return this;
    },
    newComponentsLoaded(res, ctx) {
      ctx.at.field("content").send("newComponentsLoaded", [res]);
      return this;
    },
  },
  view: html`<section>
    <x render=".content"></x>
  </section>`,
});

const Tabs = component({
  name: "Tabs",
  fields: { selectedIndex: 0, items: [] },
  receive: {
    init(ctx) {
      ctx.at.index("items", 0).send("init");
      return this.pushInItems(Tab.make());
    },
    newComponentsLoaded(res, ctx) {
      for (let i = 0; i < this.items.size; i++) {
        ctx.at.index("items", i).send("newComponentsLoaded", [res]);
      }
      return this;
    },
  },
  alter: {
    enrichTabs(binds, key, item) {
      binds.label = item.label;
      binds.isSelected = this.selectedIndex === key;
      binds.isEditing = item.isEditing;
    },
  },
  input: {
    onAddTabSelected(ctx) {
      ctx.at.index("items", this.items.size).send("init");
      const label = `Tab ${this.items.size + 1}`;
      return this.pushInItems(Tab.make({ label }));
    },
    onEditTabSelected(key) {
      return this.updateInItemsAt(key, (t) => t.toggleIsEditing());
    },
    onRemoveTabSelected(key) {
      return this.deleteInItemsAt(key);
    },
    onTabLabelChange(key, value) {
      return this.updateInItemsAt(key, (t) => t.setLabel(value));
    },
    onTabLabelEditEnd(key) {
      return this.updateInItemsAt(key, (t) => t.setIsEditing(false));
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div role="tablist" class="tabs tabs-border align-center">
      <div
        role="tab"
        @each=".items"
        @enrich-with="enrichTabs"
        @if.class="@isSelected"
        @then="'tab tab-active'"
        @else="'tab'"
        @on.click="$setSelectedIndex @key"
        @on.click+ctrl="onEditTabSelected @key"
      >
        <x text="@label" @hide="@isEditing"></x>
        <div @show="@isEditing" class="flex gap-3 justify-between pb-2">
          <input
            class="input input-sm"
            :value="@label"
            @on.input="onTabLabelChange @key value"
            @on.keydown+send="onTabLabelEditEnd @key"
          />
          <button
            class="btn btn-sm btn-soft btn-circle btn-error"
            @on.click="onRemoveTabSelected @key"
          >
            x
          </button>
        </div>
      </div>
      <span class="tab"
        ><button
          class="btn btn-sm btn-soft btn-circle btn-success"
          @on.click="onAddTabSelected"
        >
          +
        </button></span
      >
    </div>
    <x render=".items[.selectedIndex]"></x>
  </section>`,
});

export function getComponents() {
  return [Tabs, Tab];
}

export function getExamples() {
  return {
    title: "Tabs",
    items: [
      {
        title: "Tabs",
        value: Tabs.make(),
      },
    ],
  };
}
