import { component, html, macro } from "tutuca";

// A macro can expand to an `<svg>` subtree, so an icon set is just a few
// parametrized macros. `^size` and `^color` are macro parameters; passing
// them dynamically (`:size=".size"`) makes every icon react to state.
const iconParams = { size: "'24'", color: "'currentColor'" };
const iconSvg = (path) => html`<svg
  :width="^size"
  :height="^size"
  viewBox="0 0 24 24"
  fill="none"
  :stroke="^color"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="${path}"></path>
</svg>`;

const iconHeart = macro(
  iconParams,
  iconSvg(
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z",
  ),
);
const iconStar = macro(
  iconParams,
  iconSvg(
    "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
  ),
);
const iconBolt = macro(iconParams, iconSvg("M13 2L3 14h7l-1 8 10-12h-7z"));

const IconGallery = component({
  name: "IconGallery",
  fields: { size: 40 },
  view: html`<div class="flex flex-col gap-4">
    <label class="flex items-center gap-2 text-sm">
      Size
      <input type="range" min="16" max="80" :value=".size" @on.input="$setSize valueAsInt" />
      <code @text=".size"></code>
    </label>
    <div class="flex items-end gap-6 text-primary">
      <x:iconheart :size=".size" :color="'#e11d48'"></x:iconheart>
      <x:iconstar :size=".size" :color="'#f59e0b'"></x:iconstar>
      <x:iconbolt :size=".size" :color="'#2563eb'"></x:iconbolt>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-sm">Fixed 20px:</span>
      <x:iconheart size="20"></x:iconheart>
      <x:iconstar size="20"></x:iconstar>
      <x:iconbolt size="20"></x:iconbolt>
    </div>
  </div>`,
});

export function getMacros() {
  return { iconHeart, iconStar, iconBolt };
}

export function getComponents() {
  return [IconGallery];
}

export function getRoot() {
  return IconGallery.make({});
}

export function getExamples() {
  return {
    title: "SVG Icon Macro",
    description: "Parametrized SVG icons defined as macros",
    items: [
      { title: "Default", description: "40px icons", value: IconGallery.make() },
      { title: "Small", description: "16px icons", value: IconGallery.make({ size: 16 }) },
    ],
  };
}
