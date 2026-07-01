import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve tutuca's own package.json by walking up from the calling module.
// Works from every place the CLI runs: a dev checkout (tools/cli/commands/*.js
// → repo root), the bundled CLI (dist/tutuca-cli.js → repo root), and an
// installed package (node_modules/tutuca/dist/ → node_modules/tutuca/).
// Matching on `name === "tutuca"` keeps an installed CLI from picking up the
// consumer project's package.json.
export function findOwnPackageJson(importMetaUrl) {
  let dir = dirname(fileURLToPath(importMetaUrl));
  for (let depth = 0; depth < 5; depth++) {
    const candidate = resolve(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8"));
        if (pkg.name === "tutuca") return { path: candidate, pkg };
      } catch {
        // unreadable/invalid — keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function readPackageVersion(importMetaUrl) {
  return findOwnPackageJson(importMetaUrl)?.pkg.version ?? null;
}
