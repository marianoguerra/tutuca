import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "..", "tools", "tutuca.js");
const fixture = resolve(here, "fixtures", "collect-helper.js");
const storyset = resolve(here, "fixtures", "collect-storyset");

// The dev-build resolve hook uses Node's module.register, so it only takes
// effect under `node` (how the `#!/usr/bin/env node` bin runs) — not `bun`,
// where it gracefully no-ops. Drive the CLI with node here on purpose.
//
// Both commands that import user modules and run their getTests() in Node must
// install the hook; `storybook` used to skip it, so helper-based tests passed
// under `tutuca test` and failed under `tutuca storybook --dry-run` (which is
// what a project's `npm test` typically runs).
describe("CLI — dev-build resolve hook", () => {
  test("collectIterBindings resolves to the real impl under `node tutuca test`", () => {
    const r = spawnSync("node", [cli, "test", fixture], { encoding: "utf8" });
    // The fixture's getTests passes only if the bare "tutuca" import was
    // redirected to the dev build (otherwise collectIterBindings returns []).
    expect(r.stdout).toContain("Total: 1 passed, 0 failed");
  });

  test("collectIterBindings resolves to the real impl under `node tutuca storybook --dry-run`", () => {
    const r = spawnSync("node", [cli, "storybook", storyset, "--dry-run"], { encoding: "utf8" });
    expect(r.stdout).toContain("tests: 1/1 passed");
  });
});
