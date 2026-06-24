// deps/chai.js re-exports chai with the jest-style matchers (toBe, toEqual,
// …) pre-applied for the `expect` injected into `getTests`; chai's BDD chain
// (`.to.equal`) keeps working too.
import { expect } from "../../../deps/chai.js";
import { describeModule } from "../../core/describe.js";
import { docComponents } from "../../core/docs.js";
import { lintComponents } from "../../core/lint.js";
import { listComponents, listExamples } from "../../core/list.js";
import { renderExamples } from "../../core/render.js";
import { runTests } from "../../core/test.js";

function parseLimit(raw) {
  if (raw === undefined || raw === null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export const COMMANDS = {
  get: {
    describe: "Summarize the module's exports and counts.",
    defaultFormat: "cli",
    run: (normalized) => describeModule(normalized.mod, { path: normalized.path }),
  },
  list: {
    describe: "List components in the module.",
    defaultFormat: "cli",
    parseOptions: { limit: { type: "string" } },
    run: (normalized, { values, positionals }) =>
      listComponents(normalized, {
        name: positionals[0] ?? null,
        limit: parseLimit(values.limit),
      }),
  },
  examples: {
    describe: "List examples in the module.",
    defaultFormat: "cli",
    parseOptions: { limit: { type: "string" } },
    run: (normalized, { values }) => listExamples(normalized, { limit: parseLimit(values.limit) }),
  },
  show: {
    describe: "Show API docs for components (optional <name> for one).",
    defaultFormat: "md",
    run: (normalized, { positionals }) =>
      docComponents(normalized, { name: positionals[0] ?? null }),
  },
  lint: {
    describe: "Run the lint checks on components (optional <name> for one).",
    defaultFormat: "cli",
    needsEnv: true,
    run: (normalized, { positionals }, env) =>
      lintComponents(normalized, {
        name: positionals[0] ?? null,
        LintParseContextClass: env.LintParseContext,
      }),
    exitOn: (result) => (result.hasErrors ? 2 : 0),
  },
  render: {
    describe: "Render examples to HTML (optional <name> to filter by component).",
    defaultFormat: "md",
    needsEnv: true,
    parseOptions: {
      title: { type: "string" },
      view: { type: "string" },
    },
    run: (normalized, { values, positionals }, env) =>
      renderExamples(normalized, env, {
        name: positionals[0] ?? null,
        title: values.title ?? null,
        view: values.view ?? null,
      }),
    exitOn: (result) => (result.hasErrors ? 3 : 0),
  },
  test: {
    describe: "Run tests defined by getTests() (optional <name> to filter by component).",
    defaultFormat: "cli",
    needsEnv: true,
    parseOptions: {
      grep: { type: "string" },
      bail: { type: "boolean" },
    },
    run: (normalized, { values, positionals }) =>
      runTests({
        getTests: normalized.mod.getTests,
        components: normalized.components,
        path: normalized.path,
        expect,
        name: positionals[0] ?? null,
        grep: values.grep ?? null,
        bail: values.bail ?? false,
        requestHandlers: normalized.requestHandlers,
        macros: normalized.macros,
      }),
    exitOn: (result) => (result.hasFailures ? 4 : 0),
  },
};
