import { component, macro, html } from "tutuca";

const badge = macro(
  {},
  html`<span class="badge badge-info">New</span>`,
);

const StaticMacro = component({
  name: "StaticMacro",
  view: html`<div class="grid grid-cols-[auto_auto] gap-x-4 gap-y-2 items-center justify-start">
    <span>Feature A</span> <x:badge></x:badge>
    <span>Feature B</span> <x:badge></x:badge>
    <span>Feature C</span> <span></span>
  </div>`,
});

export function getMacros() {
  return { badge };
}

export function getComponents() {
  return [StaticMacro];
}

export function getRoot() {
  return StaticMacro.make({});
}

export function getStoryBookSection() {
  return {
    title: "Macro Static",
    description: "Macros without parameters expand to static markup",
    items: [
      {
        title: "Default",
        description: "Three feature rows with optional badges",
        item: StaticMacro.make(),
      },
    ],
  };
}
