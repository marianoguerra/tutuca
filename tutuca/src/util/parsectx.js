import { ParseContext } from "../anode.js";

export class ParseCtxClassSetCollector extends ParseContext {
  constructor() {
    super();
    this.classes = new Set();
  }
  _addClasses(s) {
    for (const v of s.split(/\s+/)) {
      this.classes.add(v);
    }
  }
  onAttributes(attrs, _wrapperAttrs, _textChild) {
    if (Array.isArray(attrs.items)) {
      for (const attr of attrs.items) {
        if (attr.name !== "class") {
          continue;
        }
        const { value, thenVal, elseVal } = attr;
        if (thenVal !== undefined) {
          this._addClasses(thenVal.value);
          if (elseVal) {
            this._addClasses(elseVal.value);
          }
        } else if (typeof value?.value === "string") {
          this._addClasses(value.value);
        }
      }
    } else {
      const attr = attrs.items.class;
      if (attr) {
        this._addClasses(attr);
      }
    }
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
