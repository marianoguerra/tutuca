import { expect } from "chai";
import { ANode } from "./src/anode.js";
import { ParseCtxClassSetCollector } from "./src/util/parsectx.js";
import { checkComponent, LintParseContext } from "./tools/core/lint-check.js";
import { runTests } from "./tools/core/test.js";
import { reportTestReportToConsole } from "./tools/core/test-console.js";
import { lintIdToMessage, suggestionToMessage } from "./tools/format/lint.js";

export * from "./extra.js";
export * from "./tools/core/docs.js";
export * from "./tools/core/lint-check.js";
export * from "./tools/core/results.js";
export * from "./tools/core/test.js";
export * from "./tools/core/test-console.js";
export * from "./tools/core/tests.js";
export * from "./tools/format/lint.js";

export async function test(opts = {}) {
  const report = await runTests({ expect, ...opts });
  reportTestReportToConsole(report);
  return report;
}

export function check(app) {
  const counts = { error: 0, warn: 0, hint: 0 };

  for (const Comp of app.comps.byId.values()) {
    const shadowViews = {};
    for (const name in Comp.views) {
      const rawView = Comp.views[name].rawView;
      const ctx = new LintParseContext();
      ANode.parse(rawView, ctx);
      ctx.compile(Comp.scope);
      shadowViews[name] = { name, ctx, rawView };
    }

    const shadowComp = Object.create(Comp);
    shadowComp.views = shadowViews;

    const { reports } = checkComponent(shadowComp);
    if (reports.length === 0) continue;

    console.group(Comp.name);
    for (const r of reports) {
      counts[r.level]++;
      const tail = suggestionToMessage(r.suggestion);
      const suffix = tail ? ` — ${tail}` : "";
      const line = `[${r.level}] ${lintIdToMessage(r.id, r.info)}${suffix}`;
      if (r.level === "error") console.error(line);
      else if (r.level === "warn") console.warn(line);
      else console.log(line);
    }
    console.groupEnd();
  }

  const total = counts.error + counts.warn + counts.hint;
  console.log(
    total === 0
      ? "check: no issues"
      : `check: ${counts.error} error, ${counts.warn} warn, ${counts.hint} hint`,
  );
  return counts;
}
export class LintClassCollectorCtx extends ParseCtxClassSetCollector {
  constructor(...args) {
    super(...args);
    this.attrs = [];
    this.parseIssues = [];
  }
  enterMacro(macroName, macroVars, macroSlots) {
    const { document, Text, Comment, nodes, events, macroNodes } = this;
    const frame = { macroName, macroVars, macroSlots };
    const v = new LintClassCollectorCtx(
      document,
      Text,
      Comment,
      nodes,
      events,
      macroNodes,
      frame,
      this,
    );
    v.classes = this.classes;
    v.attrs = this.attrs;
    v.parseIssues = this.parseIssues;
    return v;
  }
  onAttributes(attrs, wrapperAttrs, textChild, isMacroCall = false, tag = null) {
    super.onAttributes(attrs, wrapperAttrs, textChild, isMacroCall, tag);
    this.attrs.push({ attrs, wrapperAttrs, textChild, isMacroCall, tag });
  }
  onParseIssue(kind, info) {
    const tag = this.currentTag;
    this.parseIssues.push({ kind, info: tag && info.tag === undefined ? { ...info, tag } : info });
  }
}
