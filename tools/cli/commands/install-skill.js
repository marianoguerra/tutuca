import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CODES, emitError } from "../errors.js";
import { walkFiles } from "../walk.js";

export const describe =
  "Install Claude Code skills (tutuca, margaui, immutable-js) into .claude/skills/.";

const SKILLS = [
  { name: "tutuca", srcSubdir: "tutuca", flag: null },
  { name: "margaui", srcSubdir: "margaui", flag: "margaui-skill" },
  { name: "immutable-js", srcSubdir: "immutable-js", flag: "immutable-skill" },
];

function findSkillsRoot() {
  // tools/tutuca.js (dev) → ../skill, dist/tutuca-cli.js (released) → ../skill.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "..", "..", "..", "skill"), resolve(here, "..", "skill")];
  for (const c of candidates) {
    if (existsSync(resolve(c, "tutuca", "SKILL.md"))) return c;
  }
  return null;
}

function targetDir(scope, name, dotAgents) {
  const base = scope === "user" ? homedir() : process.cwd();
  const dir = dotAgents ? ".agents/skills" : ".claude/skills";
  return resolve(base, dir, name);
}

function targetHasSkillFiles(dir) {
  if (!existsSync(dir)) return false;
  return walkFiles(dir, { match: (name) => name.endsWith(".md") }).length > 0;
}

function installSkill(skill, root, scope, force, dotAgents, dryRun, opts) {
  const src = resolve(root, skill.srcSubdir);
  if (!existsSync(resolve(src, "SKILL.md"))) {
    emitError(opts, {
      code: CODES.SKILL_ASSETS_MISSING,
      message: `missing skill assets for '${skill.name}' at ${src}`,
      hint: "If you're running from a checkout, run `bun scripts/build-skill.js` first.",
    });
  }
  const target = targetDir(scope, skill.name, dotAgents);
  if (targetHasSkillFiles(target) && !force) {
    emitError(opts, {
      code: CODES.SKILL_TARGET_EXISTS,
      message: `${target} already contains skill files`,
      hint: "Re-run with --force to overwrite, or --dry-run to see what would change.",
    });
  }
  const baseDir = dotAgents ? ".agents/skills" : ".claude/skills";
  const rel = scope === "project" ? `${baseDir}/${skill.name}` : target;

  if (dryRun) {
    const files = walkFiles(src, { match: () => true }).map((f) => relative(src, f));
    process.stdout.write(`would install ${skill.name} skill → ${rel}\n`);
    for (const f of files) process.stdout.write(`  + ${f}\n`);
    return;
  }
  mkdirSync(target, { recursive: true });
  cpSync(src, target, { recursive: true });
  process.stdout.write(`installed ${skill.name} skill → ${rel}\n`);
}

export async function run(argv, opts = {}) {
  const parsed = parseArgs({
    args: argv,
    options: {
      user: { type: "boolean", default: false },
      project: { type: "boolean", default: false },
      "margaui-skill": { type: "boolean", default: false },
      "immutable-skill": { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      "dot-agents": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", short: "f", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    process.stdout.write(
      "tutuca install-skill [--user | --project] [--margaui-skill | --immutable-skill | --all]\n" +
        "                    [--dot-agents] [--dry-run] [--force]\n" +
        "\n" +
        "  Installs Claude Code skill assets into .claude/skills/<name>/.\n" +
        "  Defaults to --project (cwd); --user installs at ~/.claude/skills/.\n" +
        "\n" +
        "  Selection:\n" +
        "    (default)         install the tutuca skill\n" +
        "    --margaui-skill   install the margaui skill instead\n" +
        "    --immutable-skill install the immutable-js skill instead\n" +
        "    --all             install every bundled skill (tutuca + margaui + immutable-js)\n" +
        "\n" +
        "  --dot-agents installs into .agents/skills/ instead of .claude/skills/.\n" +
        "  --dry-run prints the files that would be written without touching the filesystem.\n" +
        "  --force overwrites existing files.\n",
    );
    return;
  }

  if (parsed.values.user && parsed.values.project) {
    emitError(opts, {
      code: CODES.USAGE_MUTUALLY_EXCLUSIVE,
      message: "--user and --project are mutually exclusive",
      hint: "Use --user for ~/.claude/skills/ or --project (the default) for ./.claude/skills/.",
    });
  }
  const selectionFlags = ["margaui-skill", "immutable-skill", "all"].filter(
    (k) => parsed.values[k],
  );
  if (selectionFlags.length > 1) {
    emitError(opts, {
      code: CODES.USAGE_MUTUALLY_EXCLUSIVE,
      message: `${selectionFlags.map((f) => `--${f}`).join(", ")} are mutually exclusive`,
      hint: "Pick one skill, or use --all to install every bundled skill.",
    });
  }

  const scope = parsed.values.user ? "user" : "project";
  const root = findSkillsRoot();
  if (!root) {
    emitError(opts, {
      code: CODES.SKILL_ASSETS_MISSING,
      message: "skill assets not found alongside this CLI",
      hint: "If you're running from a checkout, run `bun scripts/build-skill.js` first.",
    });
  }

  let selected;
  if (parsed.values.all) {
    selected = SKILLS;
  } else {
    const selFlag = SKILLS.find((s) => s.flag && parsed.values[s.flag]);
    selected = selFlag ? [selFlag] : SKILLS.filter((s) => s.name === "tutuca");
  }

  for (const skill of selected) {
    installSkill(
      skill,
      root,
      scope,
      parsed.values.force,
      parsed.values["dot-agents"],
      parsed.values["dry-run"],
      opts,
    );
  }

  if (!parsed.values["dry-run"]) {
    process.stdout.write("Open a Claude Code session in this directory to use it.\n");
  }
}
