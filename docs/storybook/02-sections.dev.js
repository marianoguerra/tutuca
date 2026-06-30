// 02 — MULTIPLE SECTIONS: getExamples returning an ARRAY of sections.
//
// A module may contribute several sidebar sections at once by returning an array
// of section objects instead of a single one. The engine:
//   - flattens every module's sections into one list,
//   - SORTS them by title (so sidebar order is title order, not module order),
//   - filters them with the sidebar's fuzzy search (over title + description),
//   - and each section independently fuzzy-filters its own items.
//
// Try it: type in the left "Filter sections" box (e.g. "cool") to fuzzy-match
// sections; open a section and use its "Filter examples" box to match items.
import { component, html } from "tutuca";
import { COOL_COLORS, WARM_COLORS } from "./_shared.js";

const Swatch = component({
  name: "Swatch",
  fields: { name: "red", hex: "#ef4444" },
  view: html`<div class="flex items-center gap-3">
    <span class="inline-block w-6 h-6 rounded shadow" :style="$'background: {.hex}'"></span>
    <code @text=".name"></code>
    <code class="opacity-60" @text=".hex"></code>
  </div>`,
});

const toItems = (colors) =>
  colors.map((c) => ({ title: c.name, description: c.hex, value: Swatch.make(c) }));

export function getComponents() {
  return [Swatch];
}

export function getRoot() {
  return Swatch.make(WARM_COLORS[0]);
}

// Returning an ARRAY of sections. Note the deliberately out-of-order titles
// ("Warm" before "Cool") — the engine sorts them, so "Cool Colors" appears first.
export function getExamples() {
  return [
    {
      group: "Authoring · Basics",
      title: "Sections · Warm Colors",
      description: "Section B (defined first, but sorts after 'Cool')",
      items: toItems(WARM_COLORS),
    },
    {
      group: "Authoring · Basics",
      title: "Sections · Cool Colors",
      description: "Section A (defined second, sorts before 'Warm')",
      items: toItems(COOL_COLORS),
    },
  ];
}
