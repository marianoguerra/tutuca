// The margaui palette names, mirroring `margaui/dist/themes/*.css` (minus the
// `theme.css` bundle). margaui publishes no theme manifest in its dist — its
// `gen-theme-list` script writes to a file that isn't shipped — so the list lives
// here. It is data, not a dependency: nothing in the storybook imports margaui.
//
// Every theme is a `[data-theme="<name>"]` block of CSS custom properties, and all
// margaui-compiled utilities read those through `var(--color-*)`. Switching a theme
// is therefore just the attribute flip — the compiled stylesheet never changes.
export const MARGAUI_THEMES = [
  "light",
  "dark",
  "abyss",
  "acid",
  "aqua",
  "autumn",
  "black",
  "bumblebee",
  "business",
  "caramellatte",
  "cmyk",
  "coffee",
  "corporate",
  "cupcake",
  "cyberpunk",
  "dim",
  "dracula",
  "emerald",
  "fantasy",
  "forest",
  "garden",
  "halloween",
  "lemonade",
  "lofi",
  "luxury",
  "night",
  "nord",
  "pastel",
  "retro",
  "silk",
  "sunset",
  "synthwave",
  "valentine",
  "winter",
  "wireframe",
];

// margaui's `theme.css` is `@import"./light.css";@import"./dark.css";` — these two
// are already on the page, so selecting them needs no extra stylesheet fetch.
export const BUNDLED_THEMES = new Set(["light", "dark"]);
