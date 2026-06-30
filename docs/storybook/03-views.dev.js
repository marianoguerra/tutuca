// 03 — NAMED VIEWS: views:{...} + @push-view + the per-example `view` field +
// <x render as="...">.
//
// A component has one default view (its `view:`, named "main") and any number of
// extra named views under `views: { ... }`. There are three ways to pick which
// view renders:
//   1. The example item's `view` field — the storybook card renders the value
//      under that pushed view (@push-view=".view" in the engine's Example card).
//   2. @push-view inside a component — forces descendants to a view (see 05).
//   3. <x render=".value" as="edit"> — render a specific view inline.
import { component, html } from "tutuca";

const Profile = component({
  name: "Profile",
  fields: { name: "Ada Lovelace", role: "Mathematician" },
  // Extra named views. The default ("main") is the `view:` below.
  views: {
    compact: html`<span class="badge badge-soft badge-lg">
      <span @text=".name"></span> · <span class="opacity-60" @text=".role"></span>
    </span>`,
    edit: html`<div class="flex flex-col gap-2 max-w-xs">
      <input class="input" :value=".name" @on.input="$setName value" />
      <input class="input" :value=".role" @on.input="$setRole value" />
    </div>`,
  },
  view: html`<div class="card bg-base-100 shadow-sm max-w-xs">
    <div class="card-body">
      <h3 class="card-title" @text=".name"></h3>
      <p class="opacity-70" @text=".role"></p>
    </div>
  </div>`,
});

// Renders ONE instance under three views at once via `<x render as="...">`.
const ProfileViews = component({
  name: "ProfileViews",
  fields: { value: Profile.make() },
  view: html`<div class="flex flex-col gap-3">
    <span class="text-xs opacity-60">the same instance rendered as main / compact / edit:</span>
    <x render=".value"></x>
    <x render=".value" as="compact"></x>
    <x render=".value" as="edit"></x>
  </div>`,
});

export function getComponents() {
  return [Profile, ProfileViews];
}

export function getRoot() {
  return ProfileViews.make({});
}

export function getExamples() {
  return {
    group: "Authoring · Basics",
    title: "Views",
    description: "Named views selected via the example `view` field and <x render as>",
    items: [
      {
        title: "main view",
        description: "default view (view field omitted → 'main')",
        value: Profile.make(),
      },
      {
        title: "compact view",
        description: "item.view='compact' pushes the compact named view",
        value: Profile.make(),
        view: "compact",
      },
      {
        title: "edit view",
        description: "item.view='edit' pushes the editable named view",
        value: Profile.make(),
        view: "edit",
      },
      {
        title: "<x render as>",
        description: "one instance, three views inline",
        value: ProfileViews.make(),
      },
    ],
  };
}
