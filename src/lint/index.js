import { MOD_WRAPPERS_BY_EVENT, ParseContext } from "../anode.js";

export const RENDER_IT_OUTSIDE_OF_LOOP = "RENDER_IT_OUTSIDE_OF_LOOP";
export const UNKNOWN_EVENT_MODIFIER = "UNKNOWN_EVENT_MODIFIER";
export const UNKNOWN_HANDLER_ARG_NAME = "UNKNOWN_HANDLER_ARG_NAME";
export const INPUT_HANDLER_NOT_IMPLEMENTED = "INPUT_HANDLER_NOT_IMPLEMENTED";
export const INPUT_HANDLER_METHOD_NOT_IMPLEMENTED = "INPUT_HANDLER_METHOD_NOT_IMPLEMENTED";
export const INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD = "INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD";
export const INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER = "INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER";
export const FIELD_VAL_NOT_DEFINED = "FIELD_VAL_NOT_DEFINED";
export const COMPUTED_VAL_NOT_DEFINED = "COMPUTED_VAL_NOT_DEFINED";
export const UNKNOWN_REQUEST_NAME = "UNKNOWN_REQUEST_NAME";
export const UNKNOWN_COMPONENT_NAME = "UNKNOWN_COMPONENT_NAME";

export const LEVEL_WARN = "warn";
export const LEVEL_ERROR = "error";
export const LEVEL_HINT = "hint";

export function checkComponent(Comp, lx = new LintContext()) {
  checkEventHandlersHaveImpls(lx, Comp);
  checkConsistentAttrs(lx, Comp);
  for (const name in Comp.views) {
    checkView(lx, Comp.views[name], Comp);
  }
  return lx;
}

export function checkView(lx, view, Comp) {
  checkRenderItInLoop(lx, view);
  checkEventModifiers(lx, view);
  checkKnownHandlerNames(lx, view, Comp);
}

function checkRenderItInLoop(lx, view) {
  const { nodes } = view.ctx;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.constructor.name === "RenderItNode") {
      const next = nodes[i + 1];
      const nextName = next?.constructor.name;
      if (nextName !== "EachNode" && nextName !== "RenderEachNode") {
        lx.error(RENDER_IT_OUTSIDE_OF_LOOP, { node });
      }
    }
  }
}

const NO_WRAPPERS = {};
function checkEventModifiers(lx, view) {
  for (const event of view.ctx.events) {
    for (const handler of event.handlers) {
      const { name, modifiers } = handler;
      const modWrappers = MOD_WRAPPERS_BY_EVENT[name] ?? NO_WRAPPERS;
      for (const modifier of modifiers) {
        if (modWrappers[modifier] === undefined) {
          lx.warn(UNKNOWN_EVENT_MODIFIER, { name, modifier, handler, event });
        }
      }
    }
  }
}

const KNOWN_HANDLER_NAMES = new Set([
  "value",
  "valueAsInt",
  "valueAsFloat",
  "target",
  "event",
  "isAlt",
  "isShift",
  "isCtrl",
  "isCmd",
  "key",
  "keyCode",
  "isUpKey",
  "isDownKey",
  "isSend",
  "isCancel",
  "isTabKey",
  "ctx",
  "dragInfo",
]);
function isKnownHandlerName(name) {
  return KNOWN_HANDLER_NAMES.has(name);
}

function checkKnownHandlerNames(lx, view, Comp) {
  const { computed, scope, Class } = Comp;
  const { prototype: proto } = Class;
  const { fields } = Class.getMetaClass();
  for (const event of view.ctx.events) {
    for (const handler of event.handlers) {
      const { args } = handler.handlerCall;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        checkConsistentAttrVal(lx, arg, fields, proto, computed, scope);
      }
    }
  }
}

function checkEventHandlersHaveImpls(lx, Comp) {
  const { input, views, Class } = Comp;
  const { prototype: proto } = Class;
  for (const viewName in views) {
    const view = views[viewName];
    for (const event of view.ctx.events) {
      for (const handler of event.handlers) {
        const { handlerVal } = handler.handlerCall;
        const hvName = handlerVal?.constructor.name;
        if (hvName === "InputHandlerNameVal") {
          if (input[handlerVal.name] === undefined) {
            lx.warn(INPUT_HANDLER_NOT_IMPLEMENTED, {
              name: handlerVal.name,
              handler,
              event,
            });
            if (proto[handlerVal.name] !== undefined) {
              lx.hint(INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER, {
                name: handlerVal.name,
                handler,
                event,
              });
            }
          }
        } else if (hvName === "RawFieldVal") {
          if (proto[handlerVal.name] === undefined) {
            lx.warn(INPUT_HANDLER_METHOD_NOT_IMPLEMENTED, {
              name: handlerVal.name,
              handler,
              event,
            });
            if (input[handlerVal.name] !== undefined) {
              lx.hint(INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD, {
                name: handlerVal.name,
                handler,
                event,
              });
            }
          }
        }
      }
    }
  }
}

function checkConsistentAttrVal(lx, val, fields, proto, computed, scope) {
  const valName = val?.constructor.name;
  if (valName === "FieldVal" || valName === "RawFieldVal") {
    const { name } = val;
    if (fields[name] === undefined && proto[name] === undefined) {
      lx.error(FIELD_VAL_NOT_DEFINED, { val, name });
    }
  } else if (valName === "ComputedVal") {
    const { name } = val;
    if (computed[name] === undefined) {
      lx.error(COMPUTED_VAL_NOT_DEFINED, { val, name });
    }
  } else if (valName === "SeqAccessVal") {
    checkConsistentAttrVal(lx, val.seqVal, fields, proto, computed, scope);
    checkConsistentAttrVal(lx, val.keyVal, fields, proto, computed, scope);
  } else if (valName === "RequestVal") {
    if (scope.lookupRequest(val.name) === null) {
      lx.warn(UNKNOWN_REQUEST_NAME, { name: val.name });
    }
  } else if (valName === "TypeVal") {
    if (scope.lookupComponent(val.name) === null) {
      lx.warn(UNKNOWN_COMPONENT_NAME, { name: val.name });
    }
  } else if (valName === "NameVal") {
    if (!isKnownHandlerName(val.name)) {
      lx.warn(UNKNOWN_HANDLER_ARG_NAME, { name: val.name });
    }
  } else if (valName === "StrTplVal") {
    for (const subVal of val.vals) {
      checkConsistentAttrVal(lx, subVal, fields, proto, computed, scope);
    }
  } else if (valName !== "ConstVal" && valName !== "BindVal") {
    console.log(val);
  }
}

function checkConsistentAttrs(lx, Comp) {
  const { computed, scope, views, Class } = Comp;
  const { prototype: proto } = Class;
  const { fields } = Class.getMetaClass();
  for (const viewName in views) {
    const view = views[viewName];
    for (const attr of view.ctx.attrs) {
      const { attrs, wrapperAttrs, textChild } = attr;

      if (attrs?.constructor.name === "DynAttrs") {
        for (const attr of attrs.items) {
          if (attr?.constructor.name === "Attr") {
            checkConsistentAttrVal(lx, attr.val, fields, proto, computed, scope);
          }
        }
      }

      if (wrapperAttrs !== null) {
        for (const { val } of wrapperAttrs) {
          checkConsistentAttrVal(lx, val, fields, proto, computed, scope);
        }
      }

      if (textChild) {
        checkConsistentAttrVal(lx, textChild, fields, proto, computed, scope);
      }
    }
    for (const node of view.ctx.nodes) {
      if (node.val) {
        checkConsistentAttrVal(lx, node.val, fields, proto, computed, scope);
      }
    }
  }
}

export class LintContext {
  constructor() {
    this.reports = [];
  }
  error(id, info) {
    this.report(id, info, LEVEL_ERROR);
  }
  warn(id, info) {
    this.report(id, info, LEVEL_WARN);
  }
  hint(id, info) {
    this.report(id, info, LEVEL_HINT);
  }
  report(id, info = {}, level = LEVEL_ERROR) {
    this.reports.push({ id, info, level });
  }
}

export class LintParseContext extends ParseContext {
  constructor(DOMParser, Text, Comment) {
    super(DOMParser, Text, Comment);
    this.attrs = [];
  }
  onAttributes(attrs, wrapperAttrs, textChild) {
    this.attrs.push({ attrs, wrapperAttrs, textChild });
  }
}
