import { component, html, macro } from "tutuca";

const badge = macro(
  { label: "'New'", kind: "'info'" },
  html`<span :class="badge badge-{^kind}" @text="^label"></span>`,
);

const MacroParams = component({
  name: "MacroParams",
  fields: { status: "active" },
  view: html`<div class="grid grid-cols-[auto_auto] gap-x-4 gap-y-2 items-center">
    <span>Default:</span> <x:badge></x:badge>
    <span>Static label:</span> <x:badge label="Sale"></x:badge>
    <span>Dynamic label:</span> <x:badge :label="'Sale'"></x:badge>
    <span>Custom kind:</span> <x:badge kind="success" label="OK"></x:badge>
    <span>Dynamic:</span> <x:badge :label=".status" :kind="'warning'"></x:badge>
  </div>`,
});

export function getMacros() {
  return { badge };
}

export function getComponents() {
  return [MacroParams];
}

export function getRoot() {
  return MacroParams.make({});
}

export function getStoryBookSection() {
  return {
    title: "Macro Params",
    description: "Static and dynamic macro parameter passing",
    items: [
      {
        title: "Default",
        description: "Active status",
        item: MacroParams.make(),
      },
      {
        title: "Inactive",
        description: "Inactive status binding",
        item: MacroParams.make({ status: "inactive" }),
      },
    ],
  };
}
