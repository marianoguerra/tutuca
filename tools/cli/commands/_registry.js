import { describeModule } from "../../core/describe.js";
import { docComponents } from "../../core/docs.js";
import { runDoctor } from "../../core/doctor.js";
import { listComponents, listExamples } from "../../core/list.js";
import { lintComponents } from "../../core/lint.js";
import { renderExamples } from "../../core/render.js";

export const COMMANDS = {
  info: {
    describe: "Summarize the module's exports and counts.",
    defaultFormat: "cli",
    run: (normalized) =>
      describeModule(normalized.mod, { path: normalized.path }),
  },
  list: {
    describe: "List components in the module.",
    defaultFormat: "cli",
    run: (normalized) => listComponents(normalized),
  },
  examples: {
    describe: "List examples in the module.",
    defaultFormat: "cli",
    run: (normalized) => listExamples(normalized),
  },
  docs: {
    describe: "Produce API docs for components (optional <name> for one).",
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
    describe:
      "Render examples to HTML (optional <name> to filter by component).",
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
  doctor: {
    describe: "Run lint + render as a smoke test over the module.",
    defaultFormat: "cli",
    needsEnv: true,
    run: (normalized, _parsed, env) => runDoctor(normalized, env),
    exitOn: (result) => {
      if (result.lint.hasErrors) return 2;
      if (result.renders.hasErrors) return 3;
      return 0;
    },
  },
};
