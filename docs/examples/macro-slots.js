import { component, macro, html } from "tutuca";

const card = macro(
  { title: "'Card'" },
  html`<div class="card bg-base-200 shadow-sm">
    <div class="card-body">
      <h2 class="card-title" @text="^title"></h2>
      <x:slot></x:slot>
    </div>
  </div>`,
);

const MacroSlots = component({
  name: "MacroSlots",
  fields: { count: 0 },
  methods: {
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  view: html`<div class="flex gap-3">
    <x:card title="Static Content">
      <p>This content is passed into the card's slot.</p>
    </x:card>
    <x:card title="Interactive">
      <button class="btn btn-soft btn-success" @on.click=".inc">+</button>
      <p>Count: <span @text=".count"></span></p>
    </x:card>
  </div>`,
});

export function getMacros() {
  return { card };
}

export function getComponents() {
  return [MacroSlots];
}

export function getRoot() {
  return MacroSlots.make({});
}
