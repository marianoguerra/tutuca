import { component, css, html } from "../index.js";

export const JsonNull = component({
  name: "JsonNull",
  fields: { uid: "" },
  view: html`<span :data-test-id=".uid" class="text-warning text-xs font-mono p-3">null</span>`,
});

export const JsonBool = component({
  name: "JsonBool",
  fields: { uid: "", value: true },
  view: html`<button
    :data-test-id=".uid"
    @if.class=".value"
    @then="'btn btn-sm btn-ghost btn-success font-mono'"
    @else="'btn btn-sm btn-ghost btn-error font-mono'"
    @on.click=".toggleValue"
  >
    <span @show=".value">true</span>
    <span @hide=".value">false</span>
  </button>`,
});

export const JsonString = component({
  name: "JsonString",
  fields: {
    uid: "",
    value: "hello",
  },
  view: html`<input
    :data-test-id=".uid"
    class="input input-sm input-ghost text-green-500 font-mono"
    :value=".value"
    @on.input=".setValue value"
  />`,
});

export const JsonNumber = component({
  name: "JsonNumber",
  fields: {
    uid: "",
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
    :data-test-id=".uid"
    type="number"
    class="input input-sm input-ghost text-primary font-mono"
    :title=".value"
    :value=".strValue"
    @on.input=".setRawValue value"
  />`,
});

export const JsonSelector = component({
  name: "JsonSelector",
  fields: { uid: "" },
  methods: {
    setTo(Comp) {
      return Comp.make();
    },
    setToBool(Comp, isCtrl) {
      return Comp.make({ value: !isCtrl });
    },
  },
  view: html`<div :data-test-id=".uid" class="join gap-3 font-mono">
    <button
      class="btn btn-sm btn-ghost btn-warning"
      @on.click=".setTo JsonNull"
    >
      null
    </button>
    <button
      class="btn btn-sm btn-ghost btn-success"
      @on.click=".setToBool JsonBool isCtrl"
    >
      bool
    </button>
    <button
      class="btn btn-sm btn-ghost btn-primary"
      @on.click=".setTo JsonNumber"
    >
      0
    </button>
    <button
      class="btn btn-sm btn-ghost btn-accent"
      @on.click=".setTo JsonString"
    >
      ""
    </button>
    <button class="btn btn-sm btn-ghost btn-info" @on.click=".setTo JsonArray">
      []
    </button>
    <button class="btn btn-sm btn-ghost btn-info" @on.click=".setTo JsonObject">
      {}
    </button>
  </div>`,
});

export const JsonArray = component({
  name: "JsonArray",
  fields: {
    uid: "",
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
    :data-test-id=".uid"
    class="join join-vertical gap-3 pl-3 border-l-1 border-l-neutral-500"
  >
    <button
      class="btn btn-sm btn-ghost btn-primary"
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
          class="btn btn-sm btn-ghost btn-circle btn-danger opacity-0 group-hover:opacity-100"
          @on.click=".removeInItemsAt @key"
        >
          ⛔
        </button>
      </div>
    </div>
  </section>`,
});

export const JsonObjectKeyVal = component({
  name: "JsonObjectKeyVal",
  fields: {
    uid: "",
    key: "k",
    value: null,
  },
  view: html`<div :data-test-id=".uid" class="join gap-3 items-center justify-center">
    <input
      class="input input-sm input-ghost text-green-500 font-mono"
      :value=".key"
      @on.input=".setKey value"
    />
    <span class="text-xs font-mono text-gray-500">:</span>
    <x render=".value"></x>
  </div>`,
});

export const JsonObject = component({
  name: "JsonObject",
  fields: {
    uid: "",
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
    :data-test-id=".uid"
    class="join join-vertical gap-3 pl-3 border-l-1 border-l-neutral-500"
  >
    <button
      class="btn btn-sm btn-ghost btn-primary"
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
          class="btn btn-sm btn-ghost btn-circle btn-danger opacity-0 group-hover:opacity-100"
          @on.click=".removeInItemsAt @key"
        >
          ⛔
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

function kv(uid, key, value) {
  return JsonObjectKeyVal.make({ uid, key, value });
}

export function getExamples() {
  const leaves = [
    { title: "JsonNull", make: (uid) => JsonNull.make({ uid }) },
    { title: "JsonBool true", make: (uid) => JsonBool.make({ uid, value: true }) },
    { title: "JsonBool false", make: (uid) => JsonBool.make({ uid, value: false }) },
    { title: "JsonString", make: (uid) => JsonString.make({ uid }) },
    { title: "JsonNumber", make: (uid) => JsonNumber.make({ uid }) },
  ];

  // Level 1: scalar components + selector
  const examples = [
    { title: "JsonSelector", value: JsonSelector.make({ uid: "sel" }) },
    ...leaves.map((l) => ({ title: l.title, value: l.make(l.title) })),
  ];

  // Level 2: container > leaf (all combinations)
  for (const leaf of leaves) {
    examples.push({
      title: `JsonArray > ${leaf.title}`,
      value: JsonArray.make({ uid: "arr", items: [leaf.make(leaf.title)] }),
    });
    examples.push({
      title: `JsonObject > ${leaf.title}`,
      value: JsonObject.make({
        uid: "obj",
        items: [kv("kv", "key", leaf.make(leaf.title))],
      }),
    });
  }

  // Level 3: container > container > leaf (all combinations)
  for (const leaf of leaves) {
    examples.push({
      title: `JsonArray > JsonArray > ${leaf.title}`,
      value: JsonArray.make({
        uid: "arr-o",
        items: [JsonArray.make({ uid: "arr-i", items: [leaf.make(leaf.title)] })],
      }),
    });
    examples.push({
      title: `JsonArray > JsonObject > ${leaf.title}`,
      value: JsonArray.make({
        uid: "arr-o",
        items: [
          JsonObject.make({
            uid: "obj-i",
            items: [kv("kv", "key", leaf.make(leaf.title))],
          }),
        ],
      }),
    });
    examples.push({
      title: `JsonObject > JsonArray > ${leaf.title}`,
      value: JsonObject.make({
        uid: "obj-o",
        items: [
          kv(
            "kv",
            "key",
            JsonArray.make({ uid: "arr-i", items: [leaf.make(leaf.title)] }),
          ),
        ],
      }),
    });
    examples.push({
      title: `JsonObject > JsonObject > ${leaf.title}`,
      value: JsonObject.make({
        uid: "obj-o",
        items: [
          kv(
            "kv-o",
            "key",
            JsonObject.make({
              uid: "obj-i",
              items: [kv("kv-i", "k2", leaf.make(leaf.title))],
            }),
          ),
        ],
      }),
    });
  }

  return examples;
}
