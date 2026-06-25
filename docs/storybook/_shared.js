// Shared fixtures for the storybook demo modules.
//
// Kept as a plain `.js` file (NOT `*.dev.js`) on purpose: `tutuca storybook`
// discovers only `*.dev.js` modules, so this helper is ignored by discovery while
// the demo modules can still import it. This mirrors the `_shared-data.js`
// convention used by `docs/examples/`.

export const SAMPLE_ROWS = ["alpha", "beta", "gamma", "delta"];

export const WARM_COLORS = [
  { name: "red", hex: "#ef4444" },
  { name: "orange", hex: "#f97316" },
  { name: "amber", hex: "#f59e0b" },
];

export const COOL_COLORS = [
  { name: "blue", hex: "#3b82f6" },
  { name: "cyan", hex: "#06b6d4" },
  { name: "violet", hex: "#8b5cf6" },
];

// Resolve to `value` after `ms` — used to fake async request handlers.
export const delay = (ms, value) => new Promise((res) => setTimeout(() => res(value), ms));
