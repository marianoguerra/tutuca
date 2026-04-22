import { component, macro, html } from "tutuca";

const panel = macro(
  { title: "'Panel'" },
  html`<div class="card bg-base-200 shadow-sm">
    <div class="card-body">
      <div class="flex justify-between items-center">
        <h2 class="card-title" @text="^title"></h2>
        <div><x:slot name="actions"></x:slot></div>
      </div>
      <div><x:slot></x:slot></div>
      <div class="card-actions justify-end">
        <x:slot name="footer"></x:slot>
      </div>
    </div>
  </div>`,
);

const MacroNamedSlots = component({
  name: "MacroNamedSlots",
  fields: { count: 0 },
  methods: {
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  view: html`<x:panel title="Dashboard">
    <x slot="actions">
      <button class="btn btn-sm btn-soft btn-success" @on.click=".inc">+</button>
    </x>
    <p>Count: <span @text=".count"></span></p>
    <p>This is the default slot content.</p>
    <x slot="footer">
      <span class="text-sm opacity-60">Footer content here</span>
    </x>
  </x:panel>`,
});

export function getMacros() {
  return { panel };
}

export function getComponents() {
  return [MacroNamedSlots];
}

export function getRoot() {
  return MacroNamedSlots.make({});
}

export function getExamples() {
  return {
    title: "Macro Named Slots",
    description: "Macros with multiple named slots (header, body, footer)",
    items: [
      {
        title: "Default",
        description: "Panel macro with all slots filled",
        value: MacroNamedSlots.make(),
      },
      {
        title: "With Initial Count",
        description: "Pre-populated counter",
        value: MacroNamedSlots.make({ count: 7 }),
      },
    ],
  };
}
