import { ComponentStack } from "../../src/components.js";
import { checkComponent } from "./lint-check.js";
import { LintComponentResult, LintFinding, LintReport } from "./results.js";

export function lintComponents(normalized, { name = null, LintParseContextClass }) {
  const comps = normalized.components;
  const picked = name === null ? comps : comps.filter((c) => c.name === name);

  const stack = new ComponentStack();
  stack.registerComponents(comps);
  if (normalized.macros) stack.registerMacros(normalized.macros);
  if (normalized.requestHandlers)
    stack.registerRequestHandlers(normalized.requestHandlers);

  const results = [];
  for (const comp of picked) {
    comp.compile(LintParseContextClass);
    const lx = checkComponent(comp);
    results.push(
      new LintComponentResult({
        componentName: comp.name,
        findings: lx.reports.map((r) => new LintFinding(r)),
      }),
    );
  }
  return new LintReport({ components: results });
}
