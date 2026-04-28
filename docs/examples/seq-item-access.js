import { component, html, IMap } from "tutuca";
import { Entry } from "./entry.js";
import { ITEMS } from "./_shared-data.js";

export const SeqItemAccess = component({
  name: "SeqItemAccess",
  fields: { byKey: {}, byIndex: [], currentKey: null, currentIndex: 0 },
  methods: {
    getMaxIndex() {
      return Math.max(0, this.byIndex.size - 1);
    },
    setRawCurrentIndex() {},
  },
  alter: {
    enrichByKey(binds, _key, item) {
      binds.label = item.title;
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <input
      type="range"
      min="0"
      :max=".getMaxIndex"
      :value=".currentIndex"
      @on.input=".setCurrentIndex valueAsInt"
    />
    <x render=".byIndex[.currentIndex]"></x>
    <select
      class="select"
      :value=".currentKey"
      @on.input=".setCurrentKey value"
    >
      <option
        @each=".byKey"
        @enrich-with="enrichByKey"
        :value="@key"
        @text="@label"
      ></option>
    </select>
    <x render=".byKey[.currentKey]"></x>
  </section>`,
});

export function getComponents() {
  return [SeqItemAccess, Entry];
}

export function getRoot() {
  const ENTRIES = ITEMS.map((v) => Entry.make({ title: v, description: `Length: ${v.length}` }));
  return SeqItemAccess.make({
    byIndex: ENTRIES,
    currentKey: "key-0",
    byKey: IMap(
      ITEMS.map((v, i) => [
        `key-${i}`,
        Entry.make({ title: v, description: `Length: ${v.length}` }),
      ]),
    ),
  });
}

export function getExamples() {
  return {
    title: "Sequence Item Access",
    description: "Render specific items by index or key into a sequence",
    items: [
      {
        title: "Default (First Item)",
        description: "Shows items at index 0 / key-0",
        value: getRoot(),
      },
      {
        title: "Different Selection",
        description: "Pre-selects index 3 and key-3",
        value: getRoot().setCurrentIndex(3).setCurrentKey("key-3"),
      },
    ],
  };
}
