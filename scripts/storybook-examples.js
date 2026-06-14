// Copy a curated set of docs/examples into a temp folder as `*.dev.js` and launch
// `tutuca storybook` against it, so you can exercise the storybook engine
// interactively in the browser with real example data (section selection,
// filtering, focus, and the URL state persistence).
//
//   bun run storybook:examples            # default port 4321
//   bun run storybook:examples -- --port 5000 --no-margaui
//
// Extra args after `--` are forwarded verbatim to `tutuca storybook`.
//
// Why a temp folder + rename: the storybook command discovers co-located
// `*.dev.js` modules, but the docs examples ship as plain `.js`. We copy a subset
// that depends only on `tutuca` + `./_shared-data.js` (no sibling-story imports),
// renaming each story to `<name>.dev.js`. The `tutuca` runtime is served from this
// repo's freshly built `dist/`, so local `src/` changes are reflected.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(repoRoot, "docs", "examples");
const outDir = join(tmpdir(), "tutuca-storybook-examples");

// Curated stories: each exports getComponents() + getExamples() and imports only
// "tutuca" and (optionally) "./_shared-data.js" — no sibling-story imports, so a
// plain copy+rename resolves cleanly.
const STORIES = [
  "counter",
  "todo",
  "json",
  "tree",
  "personal-site",
  "traffic-light",
  "tabbed-ui",
  "dnd-example",
  "pagination",
  "list-and-filter",
];

// Helper modules copied verbatim (kept as `.js` so the stories' relative imports
// resolve and so the storybook glob does not treat them as story modules).
const HELPERS = ["_shared-data.js"];

// Rebuild the storybook bundle so the served runtime reflects local src/ changes.
function buildStorybookBundle() {
  const r = spawnSync("bun", ["run", "dist-ext"], { cwd: repoRoot, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function stageExamples() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const h of HELPERS) cpSync(join(examplesDir, h), join(outDir, h));
  for (const name of STORIES) {
    const src = join(examplesDir, `${name}.js`);
    readFileSync(src); // fail fast if a curated name is wrong
    cpSync(src, join(outDir, `${name}.dev.js`));
  }
  return STORIES.length;
}

buildStorybookBundle();
const count = stageExamples();
process.stdout.write(`staged ${count} examples as *.dev.js in ${outDir}\n`);

const passthrough = process.argv.slice(2);
const cli = join(repoRoot, "dist", "tutuca-cli.js");
const r = spawnSync("node", [cli, "storybook", outDir, ...passthrough], {
  cwd: repoRoot,
  stdio: "inherit",
});
process.exit(r.status ?? 0);
