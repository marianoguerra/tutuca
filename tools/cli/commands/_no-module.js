// Registry of commands that take no module path — the counterpart of
// _registry.js for module commands. Single source of truth for dispatch
// (tools/tutuca.js), help lookup (help.js) and the agent-context schema:
// `describe` comes from each command module's own export; `flags` and
// `positionals` document the surface agent-context emits as JSON.
// agent-context.js and help.js import this module back (cycle) — safe because
// they only read NO_MODULE_COMMANDS inside run().
import * as agentContext from "./agent-context.js";
import * as feedback from "./feedback.js";
import * as help from "./help.js";
import * as installSkill from "./install-skill.js";
import * as storybook from "./storybook.js";

const HELP_FLAG = { name: "help", short: "h", type: "boolean" };

export const NO_MODULE_COMMANDS = {
  help: {
    mod: help,
    flags: [HELP_FLAG],
    positionals: [{ name: "command", required: false }],
  },
  feedback: {
    mod: feedback,
    flags: [HELP_FLAG],
    positionals: [
      {
        name: "message",
        required: false,
        note: "Falls back to piped stdin when omitted.",
      },
    ],
  },
  "install-skill": {
    mod: installSkill,
    flags: [
      { name: "user", type: "boolean", description: "Install at ~/.claude/skills/." },
      {
        name: "project",
        type: "boolean",
        description: "Install at ./.claude/skills/ (default).",
      },
      { name: "margaui-skill", type: "boolean" },
      { name: "immutable-skill", type: "boolean" },
      { name: "all", type: "boolean", description: "Install every bundled skill." },
      {
        name: "dot-agents",
        type: "boolean",
        description: "Use .agents/skills/ instead of .claude/skills/.",
      },
      {
        name: "dry-run",
        type: "boolean",
        description: "Print files that would be written; don't touch disk.",
      },
      {
        name: "force",
        short: "f",
        type: "boolean",
        description: "Overwrite existing files.",
      },
      HELP_FLAG,
    ],
    positionals: [],
  },
  storybook: {
    mod: storybook,
    flags: [
      {
        name: "port",
        type: "string",
        description: "Preferred port (default 4321; falls back to a free port).",
      },
      {
        name: "out",
        type: "string",
        description: "Write a static index.html + bootstrap (CDN import map) instead of serving.",
      },
      {
        name: "no-margaui",
        type: "boolean",
        description: "Render unstyled (skip margaui).",
      },
      {
        name: "no-check",
        type: "boolean",
        description: "Skip the in-browser check(app).",
      },
      {
        name: "no-tests",
        type: "boolean",
        description: "Skip running the modules' getTests() before serving.",
      },
      {
        name: "dry-run",
        type: "boolean",
        description:
          "Do all prep (discover + import + normalize modules, resolve runtime, run tests) and print what would be shown instead of serving. Pass --json for structured output.",
      },
      HELP_FLAG,
    ],
    positionals: [
      {
        name: "dir",
        required: false,
        description: "Project root to scan and serve (default: cwd).",
      },
    ],
  },
  "agent-context": {
    mod: agentContext,
    flags: [],
    positionals: [],
  },
};
