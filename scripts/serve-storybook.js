// Serve docs/storybook/ — the storybook feature reference — with `tutuca storybook`,
// rebuilding the local runtime first so the newest src/ features (the `on` lifecycle
// hooks and the `drive` test helper) are reflected in the served runtime.
//
//   bun run storybook                 # default port 4321
//   bun run storybook -- --port 5000  # extra args after `--` go to `tutuca storybook`
//
// Unlike scripts/storybook-examples.js there is no staging step: the files are
// already `*.dev.js`, so the CLI discovers them in place. The CLI serves the
// runtime from this repo's freshly built dist/ (no node_modules/tutuca).
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// dist → tutuca-dev.js + tutuca-cli.js; dist-ext → tutuca-storybook.js.
run("bun", ["run", "dist"]);
run("bun", ["run", "dist-ext"]);

const passthrough = process.argv.slice(2);
const cli = join(repoRoot, "dist", "tutuca-cli.js");
const r = spawnSync("node", [cli, "storybook", "docs/storybook", ...passthrough], {
  cwd: repoRoot,
  stdio: "inherit",
});
process.exit(r.status ?? 0);
