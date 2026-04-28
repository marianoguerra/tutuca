import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

export const describe = "Install the tutuca Claude Code skill into .claude/skills/tutuca/.";

const SKILL_FILES = ["SKILL.md", "core.md", "cli.md", "advanced.md"];

function findSkillDir() {
  // tools/tutuca.js (dev) → ../skill, dist/tutuca-cli.js (released) → ../skill.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "..", "..", "..", "skill"), resolve(here, "..", "skill")];
  for (const c of candidates) {
    if (existsSync(resolve(c, "SKILL.md"))) return c;
  }
  return null;
}

function targetDir(scope) {
  if (scope === "user") return resolve(homedir(), ".claude/skills/tutuca");
  return resolve(process.cwd(), ".claude/skills/tutuca");
}

export async function run(argv) {
  const parsed = parseArgs({
    args: argv,
    options: {
      user: { type: "boolean", default: false },
      project: { type: "boolean", default: false },
      force: { type: "boolean", short: "f", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    process.stdout.write(
      "tutuca install-skill [--user | --project] [--force]\n" +
        "\n" +
        "  Copies SKILL.md + core.md + cli.md + advanced.md into\n" +
        "  .claude/skills/tutuca/. Defaults to --project (cwd).\n" +
        "  --user installs at ~/.claude/skills/tutuca/.\n" +
        "  --force overwrites existing files.\n",
    );
    return;
  }

  if (parsed.values.user && parsed.values.project) {
    process.stderr.write("tutuca: --user and --project are mutually exclusive\n");
    process.exit(1);
  }
  const scope = parsed.values.user ? "user" : "project";
  const target = targetDir(scope);
  const src = findSkillDir();

  if (!src) {
    process.stderr.write(
      "tutuca: skill assets not found alongside this CLI.\n" +
        "If you're running from a checkout, run `bun scripts/build-skill.js` first.\n",
    );
    process.exit(1);
  }

  if (existsSync(target) && !parsed.values.force) {
    const existing = readdirSync(target).filter((n) => SKILL_FILES.includes(n));
    if (existing.length > 0) {
      process.stderr.write(
        `tutuca: ${target} already contains skill files. Re-run with --force to overwrite.\n`,
      );
      process.exit(1);
    }
  }

  mkdirSync(target, { recursive: true });
  for (const name of SKILL_FILES) {
    const from = resolve(src, name);
    if (!existsSync(from)) {
      process.stderr.write(`tutuca: missing skill asset: ${from}\n`);
      process.exit(1);
    }
    const buf = readFileSync(from);
    writeFileSync(resolve(target, name), buf);
  }

  const rel = scope === "project" ? ".claude/skills/tutuca" : target;
  process.stdout.write(`installed tutuca skill → ${rel}\n`);
  process.stdout.write("Open a Claude Code session in this directory to use it.\n");
}
