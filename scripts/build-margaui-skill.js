#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_URL = "https://github.com/marianoguerra/margaui.git";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const outDir = resolve(repo, "skill/margaui");

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function requireBin(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
  } catch {
    process.stderr.write(`build-margaui-skill: required binary not found: ${cmd}\n`);
    process.exit(1);
  }
}

requireBin("git");
requireBin("npm");
requireBin("python3");

const tmp = mkdtempSync(join(tmpdir(), "tutuca-margaui-"));
try {
  process.stdout.write(`cloning ${REPO_URL} → ${tmp}\n`);
  run("git", ["clone", "--depth", "1", REPO_URL, tmp]);

  const sha = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  process.stdout.write(`margaui commit: ${sha}\n`);

  run("npm", ["install"], { cwd: tmp });
  run("npm", ["run", "playground"], { cwd: tmp });
  run("npm", ["run", "gen-skill"], { cwd: tmp });

  const generated = resolve(tmp, ".claude/skills/margaui");
  if (!existsSync(generated)) {
    process.stderr.write(`build-margaui-skill: gen-skill produced no output at ${generated}\n`);
    process.exit(1);
  }

  rmSync(outDir, { recursive: true, force: true });
  cpSync(generated, outDir, { recursive: true });
  process.stdout.write(`built skill/margaui/ from ${REPO_URL}@${sha} → ${outDir}\n`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
