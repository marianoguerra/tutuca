import { ParseContext } from "../anode.js";
import { ConstVal } from "../value.js";

export class ParseCtxClassSetCollector extends ParseContext {
  constructor(...args) {
    super(...args);
    this.classes = new Set();
  }
  _addClasses(s) {
    for (const v of s.split(/\s+/)) {
      this.classes.add(v);
    }
  }
  enterMacro(macroName, macroVars, macroSlots) {
    const { document, Text, Comment, nodes, events, macroNodes } = this;
    const frame = { macroName, macroVars, macroSlots };
    const v = new ParseCtxClassSetCollector(
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
    return v;
  }
  onAttributes(attrs, _wrapperAttrs, _textChild) {
    if (Array.isArray(attrs.items)) {
      for (const attr of attrs.items) {
        if (attr.name !== "class") {
          continue;
        }
        const { val, thenVal, elseVal } = attr;
        if (thenVal !== undefined) {
          this._maybeAddVal(thenVal);
          this._maybeAddVal(elseVal);
        } else {
          this._maybeAddVal(val);
        }
      }
    } else {
      const attr = attrs.items.class;
      if (attr) {
        this._addClasses(attr);
      }
    }
  }
  _maybeAddVal(value) {
    if (!this._maybeAddStrTpl(value) && typeof value?.val === "string") {
      this._addClasses(value.val);
    }
  }
  _maybeAddStrTpl(value) {
    if (value?.vals !== undefined) {
      for (const val of value.vals) {
        if (val instanceof ConstVal && val.val !== "") {
          this._addClasses(val.val);
        }
      }
      return true;
    }
    return false;
  }
}

export function collectAppClassesInSet(app) {
  const classes = new Set();
  for (const Comp of app.comps.byId.values()) {
    for (const key in Comp.views) {
      const view = Comp.views[key];
      for (const name of view.ctx.classes) {
        classes.add(name);
      }
    }
  }
  return classes;
}
