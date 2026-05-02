import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) return true;
    if (entry.isDirectory() && targetHasSkillFiles(resolve(dir, entry.name))) return true;
  }
  return false;
}

function installSkill(skill, root, scope, force, dotAgents) {
  const src = resolve(root, skill.srcSubdir);
  if (!existsSync(resolve(src, "SKILL.md"))) {
    process.stderr.write(`tutuca: missing skill assets for ${skill.name} at ${src}\n`);
    process.exit(1);
  }
  const target = targetDir(scope, skill.name, dotAgents);
  if (targetHasSkillFiles(target) && !force) {
    process.stderr.write(
      `tutuca: ${target} already contains skill files. Re-run with --force to overwrite.\n`,
    );
    process.exit(1);
  }
  mkdirSync(target, { recursive: true });
  cpSync(src, target, { recursive: true });
  const baseDir = dotAgents ? ".agents/skills" : ".claude/skills";
  const rel = scope === "project" ? `${baseDir}/${skill.name}` : target;
  process.stdout.write(`installed ${skill.name} skill → ${rel}\n`);
}

export async function run(argv) {
  const parsed = parseArgs({
    args: argv,
    options: {
      user: { type: "boolean", default: false },
      project: { type: "boolean", default: false },
      "margaui-skill": { type: "boolean", default: false },
      "immutable-skill": { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      "dot-agents": { type: "boolean", default: false },
      force: { type: "boolean", short: "f", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    process.stdout.write(
      "tutuca install-skill [--user | --project] [--margaui-skill | --immutable-skill | --all] [--dot-agents] [--force]\n" +
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
        "  --force overwrites existing files.\n",
    );
    return;
  }

  if (parsed.values.user && parsed.values.project) {
    process.stderr.write("tutuca: --user and --project are mutually exclusive\n");
    process.exit(1);
  }
  const selectionFlags = ["margaui-skill", "immutable-skill", "all"].filter(
    (k) => parsed.values[k],
  );
  if (selectionFlags.length > 1) {
    process.stderr.write(
      `tutuca: ${selectionFlags.map((f) => `--${f}`).join(", ")} are mutually exclusive\n`,
    );
    process.exit(1);
  }

  const scope = parsed.values.user ? "user" : "project";
  const root = findSkillsRoot();
  if (!root) {
    process.stderr.write(
      "tutuca: skill assets not found alongside this CLI.\n" +
        "If you're running from a checkout, run `bun scripts/build-skill.js` first.\n",
    );
    process.exit(1);
  }

  let selected;
  if (parsed.values.all) {
    selected = SKILLS;
  } else {
    const selFlag = SKILLS.find((s) => s.flag && parsed.values[s.flag]);
    selected = selFlag ? [selFlag] : SKILLS.filter((s) => s.name === "tutuca");
  }

  for (const skill of selected) {
    installSkill(skill, root, scope, parsed.values.force, parsed.values["dot-agents"]);
  }

  process.stdout.write("Open a Claude Code session in this directory to use it.\n");
}
