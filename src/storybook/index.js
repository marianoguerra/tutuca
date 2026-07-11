// Storybook engine, split by responsibility:
//   components.js — the Storybook/Section/SidebarEntry/SidebarGroup/Example UI
//                   components plus the pure helpers they render with
//   build.js      — pure aggregation (buildStorybook, buildExampleRequestHandlers)
//   mount.js      — browser bootstrap (mountStorybook)
//   themes.js     — the margaui palette names the theme switcher offers
// This barrel is the public `tutuca/storybook` surface.
import { Example, Section, SidebarEntry, SidebarGroup, Storybook } from "./components.js";

export { buildExampleRequestHandlers, buildStorybook } from "./build.js";
export { Example, fuzzyMatch, Section, Storybook, slugify } from "./components.js";
export { mountStorybook } from "./mount.js";
export { BUNDLED_THEMES, MARGAUI_THEMES } from "./themes.js";

// Follow the module convention so the storybook engine can be inspected by the
// CLI like any other module.
export function getComponents() {
  return [Storybook, Section, Example, SidebarGroup, SidebarEntry];
}
