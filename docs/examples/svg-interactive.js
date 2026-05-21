import { component, html } from "tutuca";

// SVG elements are first-class: `@on.click` wires events to them, `:fill`
// binds attributes to state, and `@if` / `@then` / `@else` set an attribute
// conditionally. Clicking a swatch sets the `color` field; the preview rect
// and the selected ring both react to it.
const SwatchPicker = component({
  name: "SwatchPicker",
  fields: {
    color: "#ef4444",
    palette: [
      "#ef4444",
      "#f97316",
      "#eab308",
      "#22c55e",
      "#06b6d4",
      "#3b82f6",
      "#8b5cf6",
      "#ec4899",
    ],
  },
  alter: {
    // place each swatch along a row and mark the selected one; `this` is the
    // component, so the current `color` field decides which ring shows
    swatch(binds, key, value) {
      binds.cx = 32 + key * 46;
      binds.ring = value === this.color ? "#0f172a" : "transparent";
    },
  },
  view: html`<div class="flex flex-col gap-2">
    <svg viewBox="0 0 380 130" style="width:100%;height:170px" role="img">
      <rect x="20" y="12" width="340" height="52" rx="8" :fill=".color"></rect>
      <circle
        @each=".palette"
        @enrich-with="swatch"
        :cx="@cx"
        cy="98"
        r="18"
        :fill="@value"
        stroke-width="3"
        :stroke="@ring"
        @on.click="$setColor @value"
      ></circle>
    </svg>
    <p class="text-sm">
      Selected: <code @text=".color"></code>
    </p>
  </div>`,
});

export function getComponents() {
  return [SwatchPicker];
}

export function getRoot() {
  return SwatchPicker.make({});
}

export function getExamples() {
  return {
    title: "Interactive SVG",
    description: "Clickable SVG swatches bound to component state",
    items: [
      { title: "Red", description: "Default selection", value: SwatchPicker.make() },
      {
        title: "Blue",
        description: "A different starting color",
        value: SwatchPicker.make({ color: "#3b82f6" }),
      },
    ],
  };
}
