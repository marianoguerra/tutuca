import { lintComponents } from "./lint.js";
import { renderExamples } from "./render.js";
import { DoctorReport } from "./results.js";

export function runDoctor(normalized, env) {
  const lint = lintComponents(normalized, { LintParseContextClass: env.LintParseContext });
  const renders = renderExamples(normalized, env);
  return new DoctorReport({ lint, renders });
}
