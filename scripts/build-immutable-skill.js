#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_URL = "https://github.com/marianoguerra/immutable-js.git";
const BRANCH = "7.x";
const UPSTREAM_SKILL = ".claude/skills/immutable-js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const outDir = resolve(repo, "skill/immutable-js");

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function requireBin(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
  } catch {
    process.stderr.write(`build-immutable-skill: required binary not found: ${cmd}\n`);
    process.exit(1);
  }
}

requireBin("git");

const tmp = mkdtempSync(join(tmpdir(), "tutuca-immutable-"));
try {
  process.stdout.write(`cloning ${REPO_URL} (${BRANCH}) → ${tmp}\n`);
  run("git", ["clone", "--depth", "1", "--branch", BRANCH, REPO_URL, tmp]);

  const sha = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  process.stdout.write(`immutable-js commit: ${sha}\n`);

  const src = resolve(tmp, UPSTREAM_SKILL);
  if (!existsSync(resolve(src, "SKILL.md"))) {
    process.stderr.write(`build-immutable-skill: ${UPSTREAM_SKILL}/SKILL.md missing in clone\n`);
    process.exit(1);
  }

  rmSync(outDir, { recursive: true, force: true });
  cpSync(src, outDir, { recursive: true });
  process.stdout.write(
    `built skill/immutable-js/ from ${REPO_URL}@${sha} (${BRANCH}) → ${outDir}\n`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
