// The three library tiers, single source of truth for the build scripts:
// scripts/dist.js emits <name>.js / <name>.min.js / <name>.min.js.br per tier,
// scripts/dist-ext.js emits the deps-external <name>.ext.js variants.
export const TIERS = [
  ["index.js", "tutuca"],
  ["extra.js", "tutuca-extra"],
  ["dev.js", "tutuca-dev"],
];
