// Storybook engine, split by responsibility:
//   components.js — the Storybook/Section/SidebarEntry/SidebarGroup/Example UI
//                   components plus the pure helpers they render with
//   build.js      — pure aggregation (buildStorybook, buildExampleRequestHandlers)
//   mount.js      — browser bootstrap (mountStorybook)
// This barrel is the public `tutuca/storybook` surface.
import {
  ActivityEntry,
  Example,
  Section,
  SidebarEntry,
  SidebarGroup,
  Storybook,
} from "./components.js";

export { buildExampleRequestHandlers, buildStorybook } from "./build.js";
export { ActivityEntry, Example, fuzzyMatch, Section, Storybook, slugify } from "./components.js";
export { mountStorybook } from "./mount.js";

// Follow the module convention so the storybook engine can be inspected by the
// CLI like any other module.
export function getComponents() {
  return [Storybook, Section, Example, SidebarGroup, SidebarEntry, ActivityEntry];
}
