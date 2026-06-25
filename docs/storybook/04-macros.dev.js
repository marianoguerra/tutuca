// 04 — MACROS: getMacros() with all four flavors.
//
// A macro is a reusable view fragment. Return them from getMacros() so the engine
// registers them; reference them in templates as <x:name>. The four flavors:
//   1. static       — no params, fixed markup.
//   2. params       — ^param placeholders; pass static ("Sale") or dynamic (:label).
//   3. default slot — <x:slot> receives the caller's child content.
//   4. named slots  — <x:slot name="x"> receives <x slot="x"> content.
//
// Macro param defaults are EXPRESSIONS, so a string literal is quoted: { label: "'New'" }.
import { component, html, macro } from "tutuca";

// 1. static
const hr = macro({}, html`<div class="divider my-0 text-xs opacity-50">section</div>`);

// 2. params (static + dynamic binding via :label / :kind)
const badge = macro(
  { label: "'New'", kind: "'info'" },
  html`<span :class="$'badge badge-{^kind}'" @text="^label"></span>`,
);

// 3. default slot
const card = macro(
  { title: "'Card'" },
  html`<div class="card bg-base-200 shadow-sm">
    <div class="card-body">
      <h4 class="card-title text-base" @text="^title"></h4>
      <x:slot></x:slot>
    </div>
  </div>`,
);

// 4. named slots (+ default slot)
const panel = macro(
  { title: "'Panel'" },
  html`<div class="card bg-base-200 shadow-sm">
    <div class="card-body">
      <div class="flex justify-between items-center">
        <h4 class="card-title text-base" @text="^title"></h4>
        <div><x:slot name="actions"></x:slot></div>
      </div>
      <div><x:slot></x:slot></div>
      <div class="card-actions justify-end"><x:slot name="footer"></x:slot></div>
    </div>
  </div>`,
);

const MacroShowcase = component({
  name: "MacroShowcase",
  fields: { status: "active", count: 0 },
  methods: {
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  view: html`<div class="flex flex-col gap-3 max-w-md">
    <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center">
      <span class="text-sm opacity-70">static macro:</span> <x:badge></x:badge>
      <span class="text-sm opacity-70">static label:</span> <x:badge label="Sale"></x:badge>
      <span class="text-sm opacity-70">dynamic param:</span>
      <x:badge :label=".status" kind="success"></x:badge>
    </div>
    <x:hr></x:hr>
    <x:card title="Default slot">
      <p class="text-sm">This paragraph is passed into the card's default slot.</p>
    </x:card>
    <x:panel title="Named slots">
      <x slot="actions">
        <button class="btn btn-xs btn-soft btn-success" @on.click="$inc">+</button>
      </x>
      <p class="text-sm">Default slot body — count: <span @text=".count"></span></p>
      <x slot="footer"><span class="text-xs opacity-60">footer slot</span></x>
    </x:panel>
  </div>`,
});

export function getComponents() {
  return [MacroShowcase];
}

// getMacros is required for the macros referenced in views to resolve.
export function getMacros() {
  return { hr, badge, card, panel };
}

export function getRoot() {
  return MacroShowcase.make({});
}

export function getExamples() {
  return {
    title: "04 · Macros",
    description: "getMacros: static, params (static + dynamic), default slot, named slots",
    items: [
      {
        title: "All macro flavors",
        description: "one component using every macro kind",
        value: MacroShowcase.make(),
      },
      {
        title: "Dynamic param = inactive",
        description: "the :label badge binds the `status` field",
        value: MacroShowcase.make({ status: "inactive" }),
      },
    ],
  };
}
