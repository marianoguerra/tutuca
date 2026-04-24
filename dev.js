import { ANode } from "./src/anode.js";
import { ParseCtxClassSetCollector } from "./src/util/parsectx.js";
import { LintParseContext, checkComponent } from "./tools/core/lint-check.js";
import { lintIdToMessage } from "./tools/format/lint.js";

export * from "./extra.js";
export * from "./tools/core/lint-check.js";
export * from "./tools/core/docs.js";
export * from "./tools/format/lint.js";

export function check(app) {
  const counts = { error: 0, warn: 0, hint: 0 };

  for (const Comp of app.comps.byId.values()) {
    const shadowViews = {};
    for (const name in Comp.views) {
      const ctx = new LintParseContext();
      ANode.parse(Comp.views[name].rawView, ctx);
      ctx.compile(Comp.scope);
      shadowViews[name] = { name, ctx };
    }

    const shadowComp = Object.create(Comp);
    shadowComp.views = shadowViews;

    const { reports } = checkComponent(shadowComp);
    if (reports.length === 0) continue;

    console.group(Comp.name);
    for (const r of reports) {
      counts[r.level]++;
      const line = `[${r.level}] ${lintIdToMessage(r.id, r.info)}`;
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
  }
  enterMacro(macroName, macroVars, macroSlots) {
    const { DOMParser: DP, Text, Comment, nodes, events, macroNodes } = this;
    const frame = { macroName, macroVars, macroSlots };
    const v = new LintClassCollectorCtx(DP, Text, Comment, nodes, events, macroNodes, frame, this);
    v.classes = this.classes;
    v.attrs = this.attrs;
    return v;
  }
  onAttributes(attrs, wrapperAttrs, textChild, isMacroCall = false) {
    super.onAttributes(attrs, wrapperAttrs, textChild, isMacroCall);
    this.attrs.push({ attrs, wrapperAttrs, textChild, isMacroCall });
  }
}
