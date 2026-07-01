import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "..", "tools", "tutuca.js");
const repo = resolve(here, "..");
const todoModule = resolve(here, "todo.js");
const storyset = resolve(here, "fixtures", "storyset");

function run(args) {
  const r = spawnSync("bun", [cli, ...args], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("CLI: --json flag", () => {
  test("--json on get emits JSON to stdout", () => {
    const { code, stdout } = run(["get", todoModule, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.path).toBe(todoModule);
    expect(parsed.present).toBeInstanceOf(Array);
  });

  test("--json is equivalent to -f json", () => {
    const a = run(["get", todoModule, "--json"]);
    const b = run(["get", todoModule, "-f", "json"]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(a.stdout).toBe(b.stdout);
  });
});

describe("CLI: error envelope under --json", () => {
  test("unknown command emits JSON envelope on stderr", () => {
    const { code, stderr, stdout } = run(["renderr", todoModule, "--json"]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    const env = JSON.parse(stderr);
    expect(env.error.code).toBe("ERR_USAGE_UNKNOWN_COMMAND");
    expect(env.error.suggestion).toEqual({
      kind: "replace-name",
      from: "renderr",
      to: "render",
    });
  });

  test("unknown flag emits JSON envelope with did-you-mean", () => {
    const { code, stderr } = run(["render", todoModule, "--titel", "x", "--json"]);
    expect(code).toBe(1);
    const env = JSON.parse(stderr);
    expect(env.error.code).toBe("ERR_USAGE_UNKNOWN_FLAG");
    expect(env.error.suggestion).toEqual({
      kind: "replace-name",
      from: "--titel",
      to: "--title",
    });
  });

  test("bad --format value rejects with did-you-mean", () => {
    const { code, stderr } = run(["get", todoModule, "-f", "jzon"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown format 'jzon'");
    expect(stderr).toContain("did you mean 'json'?");
  });

  test("--json overrides an earlier --format (last-wins)", () => {
    // Order is left-to-right; --json simply sets format=json.
    const { code, stdout } = run(["get", todoModule, "-f", "cli", "--json"]);
    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});

describe("CLI: human-readable error format", () => {
  test("unknown command shows did-you-mean line", () => {
    const { code, stderr } = run(["renderr", todoModule]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown command 'renderr'");
    expect(stderr).toContain("did you mean 'render'?");
    expect(stderr).toContain("hint:");
  });

  test("missing module shows hint when command is given alone", () => {
    const { code, stderr } = run(["lint"]);
    expect(code).toBe(1);
    expect(stderr).toContain("'lint' requires a module path");
  });

  test("feedback without message shows usage example", () => {
    // Pipe an empty stdin to force the no-message path even when
    // the test runner attaches a TTY.
    const r = spawnSync("bun", [cli, "feedback"], { encoding: "utf8", input: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("feedback requires a message");
    expect(r.stderr).toContain("hint:");
  });
});

describe("CLI: command-first invocation", () => {
  test("module as second positional works", () => {
    const { code } = run(["lint", todoModule]);
    expect(code).toBe(0);
  });

  test("--module=<path> overrides positional", () => {
    const { code, stdout } = run(["get", `--module=${todoModule}`, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).path).toBe(todoModule);
  });

  test("legacy module-first invocation errors with did-you-mean", () => {
    // ./test/todo.js is parsed as the command; it doesn't match anything.
    const { code, stderr } = run([todoModule, "lint"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown command");
  });
});

describe("CLI: rename info → get, docs → show", () => {
  test("'info' is no longer a command", () => {
    const { code, stderr } = run(["info", todoModule]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown command 'info'");
  });

  test("'docs' is no longer a command", () => {
    const { code, stderr } = run(["docs", todoModule]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown command 'docs'");
  });

  test("'show' produces API docs", () => {
    const { code, stdout } = run(["show", todoModule]);
    expect(code).toBe(0);
    expect(stdout).toContain("# ");
  });
});

describe("CLI: agent-context", () => {
  test("emits a versioned schema with every command", () => {
    const { code, stdout } = run(["agent-context"]);
    expect(code).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema.schemaVersion).toBe(3);
    expect(schema.cli).toBe("tutuca");
    const names = schema.commands.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "agent-context",
        "examples",
        "feedback",
        "get",
        "help",
        "install-skill",
        "lint",
        "list",
        "render",
        "show",
        "storybook",
        "test",
      ].sort(),
    );
    expect(schema.formats).toEqual(["cli", "md", "json", "html"]);
    expect(schema.errorCodes).toContain("ERR_USAGE_UNKNOWN_COMMAND");
    expect(schema.invocation.moduleFirst).toBe(false);
  });

  test("emits the lint-code table", () => {
    const { code, stdout } = run(["agent-context"]);
    expect(code).toBe(0);
    const schema = JSON.parse(stdout);
    expect(Array.isArray(schema.lintCodes)).toBe(true);
    const rule = schema.lintCodes.find((r) => r.code === "FIELD_VAL_NOT_DEFINED");
    expect(rule).toBeDefined();
    expect(rule.level).toBe("error");
    expect(typeof rule.summary).toBe("string");
  });
});

describe("CLI: --limit on list/examples", () => {
  test("list --limit 1 caps output and reports truncation in JSON", () => {
    const { code, stdout } = run(["list", todoModule, "--limit", "1", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBeGreaterThan(1);
  });

  test("examples --limit 1 caps and reports total in JSON", () => {
    const { code, stdout } = run(["examples", todoModule, "--limit", "1", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBeGreaterThan(1);
    const shown = parsed.sections.reduce((n, s) => n + s.items.length, 0);
    expect(shown).toBe(1);
  });

  test("list with no --limit emits all and not truncated", () => {
    const { code, stdout } = run(["list", todoModule, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.truncated).toBe(false);
    expect(parsed.items.length).toBe(parsed.total);
  });

  test("cli format shows '… N more' footer when truncated", () => {
    const { code, stdout } = run(["list", todoModule, "--limit", "1"]);
    expect(code).toBe(0);
    expect(stdout).toContain("more component");
  });
});

describe("CLI: test <dir> and module-load errors", () => {
  test("test on a directory walks and runs every test module", () => {
    const { code, stdout } = run(["test", storyset]);
    expect(code).toBe(0);
    // Both the top-level and the nested *.dev.js modules ran.
    expect(stdout).toContain("bump increments n");
    expect(stdout).toContain("label default");
  });

  test("a non-directory-aware command on a directory errors cleanly", () => {
    const { code, stderr } = run(["lint", storyset]);
    expect(code).toBe(1);
    expect(stderr).toContain("expected a module file, got a directory");
    // Not a raw Node ESM resolver stack.
    expect(stderr).not.toContain("ERR_UNSUPPORTED_DIR_IMPORT");
  });

  test("a directory error emits a JSON envelope under --json", () => {
    const { code, stderr } = run(["lint", storyset, "--json"]);
    expect(code).toBe(1);
    const env = JSON.parse(stderr);
    expect(env.error.code).toBe("ERR_MODULE_LOAD_FAILED");
  });

  test("a missing module file errors cleanly, not with a raw stack", () => {
    const { code, stderr } = run(["test", resolve(here, "does-not-exist.js")]);
    expect(code).toBe(1);
    expect(stderr).toContain("module not found");
    expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});

describe("CLI: install-skill --dry-run", () => {
  // skill/ is a gitignored build artifact; install-skill reads real files from it.
  // Build the tutuca skill (a local copy of docs/skill/, no network) if it's absent.
  beforeAll(() => {
    if (existsSync(resolve(repo, "skill", "tutuca", "SKILL.md"))) return;
    const r = spawnSync("bun", [resolve(repo, "scripts", "build-skill.js"), "tutuca"], {
      cwd: repo,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`build-skill failed: ${r.stderr}`);
  });

  test("prints would-install lines and does not exit nonzero", () => {
    const { code, stdout } = run(["install-skill", "--dry-run", "--user"]);
    expect(code).toBe(0);
    expect(stdout).toContain("would install tutuca skill");
    expect(stdout).toContain("SKILL.md");
  });
});

describe("CLI: storybook margaui resolution", () => {
  const CDN_JS = "https://cdn.jsdelivr.net/npm/margaui/+esm";

  function dryRun(dir, ...extra) {
    const { code, stdout } = run(["storybook", dir, "--dry-run", "--json", "--no-tests", ...extra]);
    expect(code).toBe(0);
    return JSON.parse(stdout);
  }

  test("defaults to the CDN when no node_modules/margaui is present", () => {
    const r = dryRun(storyset);
    expect(r.margaui.source).toBe("CDN");
    expect(r.margaui.jsUrl).toBe(CDN_JS);
    expect(r.imports.margaui).toBe(CDN_JS);
  });

  test("--no-margaui drops margaui entirely", () => {
    const r = dryRun(storyset, "--no-margaui");
    expect(r.margaui).toBe(null);
    expect(r.imports.margaui).toBeUndefined();
    expect(r.options.margaui).toBe(false);
  });

  test("--margaui <url> overrides the source", () => {
    const url = "https://cdn.jsdelivr.net/npm/margaui@0.5606.1/+esm";
    const r = dryRun(storyset, "--margaui", url);
    expect(r.margaui.source).toBe("override");
    expect(r.margaui.jsUrl).toBe(url);
    expect(r.imports.margaui).toBe(url);
  });

  describe("with a local node_modules/margaui", () => {
    // Local margaui resolves to a dedicated virtual route (not /node_modules/...)
    // so the whole dist/ — including themes/{theme,light,dark}.css reached via
    // theme.css's relative @imports — is served even when the install lives above
    // the served projectDir.
    const JS = "/__margaui__/margaui.min.js";
    const THEME = "/__margaui__/themes/theme.css";
    let root;
    beforeAll(() => {
      // A throwaway project that installs margaui: a *.dev.js plus the files
      // resolveMargaui probes for. Contents are irrelevant to the Node-side dry
      // run — only existence/paths are resolved.
      root = mkdtempSync(join(tmpdir(), "tutuca-sb-margaui-"));
      writeFileSync(
        join(root, "x.dev.js"),
        "export function getComponents() { return []; }\nexport function getExamples() { return []; }\n",
      );
      const md = join(root, "node_modules", "margaui", "dist");
      mkdirSync(join(md, "themes"), { recursive: true });
      writeFileSync(join(md, "margaui.min.js"), "export const compile = () => ({});\n");
      writeFileSync(join(md, "themes", "theme.css"), '@import"./light.css";@import"./dark.css";');
      // A served subdirectory: node_modules lives at the root above it. Mirrors
      // `tutuca storybook src`, the case where a plain projectDir check misses it.
      mkdirSync(join(root, "src"));
      writeFileSync(
        join(root, "src", "y.dev.js"),
        "export function getComponents() { return []; }\nexport function getExamples() { return []; }\n",
      );
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    test("auto-detects the local install (offline path)", () => {
      const r = dryRun(root);
      expect(r.margaui.source).toBe("node_modules");
      expect(r.margaui.jsUrl).toBe(JS);
      expect(r.margaui.themeUrl).toBe(THEME);
      expect(r.imports.margaui).toBe(JS);
    });

    test("finds node_modules above the served subdirectory (tutuca storybook src)", () => {
      const r = dryRun(join(root, "src"));
      expect(r.margaui.source).toBe("node_modules");
      expect(r.margaui.jsUrl).toBe(JS);
      expect(r.margaui.themeUrl).toBe(THEME);
    });

    test("--margaui-cdn forces the CDN even when local is present", () => {
      const r = dryRun(root, "--margaui-cdn");
      expect(r.margaui.source).toBe("CDN");
      expect(r.margaui.jsUrl).toBe(CDN_JS);
    });

    test("--margaui override wins over the local install", () => {
      const r = dryRun(root, "--margaui", "./vendor.js");
      expect(r.margaui.source).toBe("override");
      expect(r.margaui.jsUrl).toBe("/vendor.js");
    });
  });
});
