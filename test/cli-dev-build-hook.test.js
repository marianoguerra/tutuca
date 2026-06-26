import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "..", "tools", "tutuca.js");
const fixture = resolve(here, "fixtures", "collect-helper.js");

// The dev-build resolve hook uses Node's module.register, so it only takes
// effect under `node` (how the `#!/usr/bin/env node` bin runs) — not `bun`,
// where it gracefully no-ops. Drive the CLI with node here on purpose.
describe("CLI test command — dev-build resolve hook", () => {
  test("collectIterBindings resolves to the real impl under `node tutuca test`", () => {
    const r = spawnSync("node", [cli, "test", fixture], { encoding: "utf8" });
    // The fixture's getTests passes only if the bare "tutuca" import was
    // redirected to the dev build (otherwise collectIterBindings returns []).
    expect(r.stdout).toContain("Total: 1 passed, 0 failed");
  });
});
