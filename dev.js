import { ParseCtxClassSetCollector } from "./src/util/parsectx.js";

export * from "./extra.js";
export * from "./tools/core/lint-check.js";
export * from "./tools/core/docs.js";
export * from "./tools/format/lint.js";
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
  onAttributes(attrs, wrapperAttrs, textChild) {
    super.onAttributes(attrs, wrapperAttrs, textChild);
    this.attrs.push({ attrs, wrapperAttrs, textChild });
  }
}
