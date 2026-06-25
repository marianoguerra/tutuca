// 01 — BASICS: getComponents + getExamples (single section) + the core item fields.
//
// This is the minimum a story module needs:
//   - getComponents(): every component the module defines (so the engine can
//     register + compile them).
//   - getExamples(): ONE section object { title, description?, items: [...] } (or an
//     array of sections — see 02-sections).
//
// Each item is one rendered card. The fields used here are the essentials:
//   - title       (required) — card heading
//   - description (optional) — shown under the title; use it to explain the state
//   - value       (required) — a real component INSTANCE (Comp.make({...})), never
//                              the class or a plain object
//
// Listing one item per meaningful state turns a section into a "state matrix" you
// can eyeball at a glance.
import { component, html } from "tutuca";

// A tiny presentational component. It renders a margaui badge whose colour comes
// from the `tone` field, plus a caption echoing its own state so the card is
// self-describing.
const StatusBadge = component({
  name: "StatusBadge",
  fields: { label: "Ready", tone: "info" },
  view: html`<div class="flex items-center gap-3">
    <span :class="$'badge badge-{.tone}'" @text=".label"></span>
    <span class="text-xs opacity-60">
      tone=<code @text=".tone"></code>
    </span>
  </div>`,
});

export function getComponents() {
  return [StatusBadge];
}

// Optional: lets `tutuca render docs/storybook/01-basics.dev.js` show a default.
export function getRoot() {
  return StatusBadge.make({});
}

export function getExamples() {
  return {
    title: "01 · Basics",
    description:
      "getComponents + getExamples (single section). One item per state = a state matrix.",
    items: [
      { title: "Ready", description: "the default tone (info)", value: StatusBadge.make() },
      {
        title: "Busy",
        description: "warning tone",
        value: StatusBadge.make({ label: "Busy", tone: "warning" }),
      },
      {
        title: "Done",
        description: "success tone",
        value: StatusBadge.make({ label: "Done", tone: "success" }),
      },
      {
        title: "Failed",
        description: "error tone",
        value: StatusBadge.make({ label: "Failed", tone: "error" }),
      },
    ],
  };
}
