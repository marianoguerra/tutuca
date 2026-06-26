import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Recursively collect absolute file paths under `dir` whose basename satisfies
// `match`, skipping dotfiles/dirs and node_modules. Shared by `tutuca storybook`
// (*.dev.js discovery) and `tutuca test <dir>` (*.test.js / *.dev.js discovery).
// (tools/cli/commands/install-skill.js has a third hand-rolled walker that could
// fold into this later.)
export function walkFiles(dir, { match }, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = resolve(dir, e.name);
    if (e.isDirectory()) walkFiles(full, { match }, acc);
    else if (e.isFile() && match(e.name)) acc.push(full);
  }
  return acc;
}
