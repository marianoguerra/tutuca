import { component, css, html } from "tutuca";

const JsonNull = component({
  name: "JsonNull",
  view: html`<span class="text-warning text-xs font-mono p-3">null</span>`,
});

const JsonBool = component({
  name: "JsonBool",
  fields: { value: true },
  view: html`<button
    @if.class=".value"
    @then="'btn btn-sm btn-soft btn-success font-mono'"
    @else="'btn btn-sm btn-soft btn-error font-mono'"
    @on.click=".toggleValue"
  >
    <span @show=".value">true</span>
    <span @hide=".value">false</span>
  </button>`,
});

const JsonString = component({
  name: "JsonString",
  fields: {
    value: "hello",
  },
  view: html`<input
    class="input input-sm input-ghost text-green-500 font-mono"
    :value=".value"
    @on.input=".setValue value"
  />`,
});

const JsonNumber = component({
  name: "JsonNumber",
  fields: {
    strValue: "0",
    value: 0,
  },
  methods: {
    setRawValue(v) {
      const value = parseFloat(v);
      return Number.isFinite(value)
        ? this.setValue(value).setStrValue(v)
        : this.setStrValue(v);
    },
  },
  view: html`<input
    type="number"
    class="input input-sm input-ghost text-primary font-mono"
    :title=".value"
    :value=".strValue"
    @on.input=".setRawValue value"
  />`,
});

export const JsonSelector = component({
  name: "JsonSelector",
  methods: {
    setTo(Comp) {
      return Comp.make();
    },
    setToBool(Comp, isCtrl) {
      return Comp.make({ value: !isCtrl });
    },
  },
  view: html`<div class="join gap-3 font-mono">
    <button class="btn btn-sm btn-soft btn-warning" @on.click=".setTo JsonNull">
      null
    </button>
    <button
      class="btn btn-sm btn-soft btn-success"
      @on.click=".setToBool JsonBool isCtrl"
    >
      bool
    </button>
    <button
      class="btn btn-sm btn-soft btn-primary"
      @on.click=".setTo JsonNumber"
    >
      0
    </button>
    <button
      class="btn btn-sm btn-soft btn-accent"
      @on.click=".setTo JsonString"
    >
      ""
    </button>
    <button class="btn btn-sm btn-soft btn-info" @on.click=".setTo JsonArray">
      []
    </button>
    <button class="btn btn-sm btn-soft btn-info" @on.click=".setTo JsonObject">
      {}
    </button>
  </div>`,
});

const JsonArray = component({
  name: "JsonArray",
  fields: {
    items: [], // TODO: new KList()
  },
  input: {
    addItem(Comp) {
      return this.pushInItems(Comp.make());
    },
    onDropOnItem(key, dragInfo) {
      return this.setItems(
        this.items.moveKeyBeforeKey(dragInfo.lookupBind("key"), key),
      );
    },
  },
  style: css`
    [data-draggingover="json-list-item"] {
      border-top: 4rem solid transparent;
      transition: 0.15s border-top ease;
    }
  `,
  view: html`<section
    class="join join-vertical gap-3 pl-3 border-l-1 border-l-neutral-500"
  >
    <button
      class="btn btn-sm btn-soft btn-primary"
      @on.click="addItem JsonSelector"
    >
      +
    </button>
    <div class="join join-vertical gap-3">
      <div
        class="join gap-3 justify-between items-center group"
        @each=".items"
        draggable="true"
        data-dragtype="json-list-item"
        data-droptarget="json-list-item"
        @on.drop="onDropOnItem @key dragInfo"
      >
        <x render-it></x
        ><button
          class="btn btn-sm btn-soft btn-circle btn-error font-mono opacity-20 group-hover:opacity-100"
          @on.click=".removeInItemsAt @key"
        >
          x
        </button>
      </div>
    </div>
  </section>`,
});

const JsonObjectKeyVal = component({
  name: "JsonObjectKeyVal",
  fields: {
    key: "k",
    value: null,
  },
  view: html`<div class="join gap-3 items-center justify-center">
    <input
      class="input input-sm input-ghost text-green-500 font-mono"
      :value=".key"
      @on.input=".setKey value"
    />
    <span class="text-xs font-mono text-gray-500">:</span>
    <x render=".value"></x>
  </div>`,
});

const JsonObject = component({
  name: "JsonObject",
  fields: {
    items: [], // TODO: new KList()
  },
  input: {
    addItem(KV, JsonSelector) {
      return this.pushInItems(KV.make({ value: JsonSelector.make() }));
    },
    onDropOnItem(key, dragInfo) {
      return this.setItems(
        this.items.moveKeyBeforeKey(dragInfo.lookupBind("key"), key),
      );
    },
  },
  style: css`
    [data-draggingover="json-kv-item"] {
      border-top: 4rem solid transparent;
      transition: 0.15s border-top ease;
    }
  `,
  view: html`<section
    class="join join-vertical gap-3 pl-3 border-l-1 border-l-neutral-500"
  >
    <button
      class="btn btn-sm btn-soft font-mono btn-primary"
      @on.click="addItem JsonObjectKeyVal JsonSelector"
    >
      +
    </button>
    <div class="join join-vertical gap-3">
      <div
        class="join gap-3 justify-between items-center group"
        @each=".items"
        draggable="true"
        data-dragtype="json-kv-item"
        data-droptarget="json-kv-item"
        @on.drop="onDropOnItem @key dragInfo"
      >
        <x render-it></x
        ><button
          class="btn btn-sm btn-soft btn-circle btn-error font-mono opacity-20 group-hover:opacity-100"
          @on.click=".removeInItemsAt @key"
        >
          x
        </button>
      </div>
    </div>
  </section>`,
});

export function getComponents() {
  return [
    JsonSelector,
    JsonNull,
    JsonBool,
    JsonString,
    JsonNumber,
    JsonArray,
    JsonObjectKeyVal,
    JsonObject,
  ];
}

export function getRoot() {
  return JsonArray.make().pushInItems(JsonSelector.make());
}
