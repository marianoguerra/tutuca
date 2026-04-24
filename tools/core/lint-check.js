import { MOD_WRAPPERS_BY_EVENT, ParseContext } from "../../src/anode.js";

export const ALT_HANDLER_NOT_DEFINED = "ALT_HANDLER_NOT_DEFINED";
export const ALT_HANDLER_NOT_REFERENCED = "ALT_HANDLER_NOT_REFERENCED";
export const RENDER_IT_OUTSIDE_OF_LOOP = "RENDER_IT_OUTSIDE_OF_LOOP";
export const UNKNOWN_EVENT_MODIFIER = "UNKNOWN_EVENT_MODIFIER";
export const UNKNOWN_HANDLER_ARG_NAME = "UNKNOWN_HANDLER_ARG_NAME";
export const INPUT_HANDLER_NOT_IMPLEMENTED = "INPUT_HANDLER_NOT_IMPLEMENTED";
export const INPUT_HANDLER_NOT_REFERENCED = "INPUT_HANDLER_NOT_REFERENCED";
export const INPUT_HANDLER_METHOD_NOT_IMPLEMENTED = "INPUT_HANDLER_METHOD_NOT_IMPLEMENTED";
export const INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD = "INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD";
export const INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER = "INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER";
export const FIELD_VAL_NOT_DEFINED = "FIELD_VAL_NOT_DEFINED";
export const COMPUTED_VAL_NOT_DEFINED = "COMPUTED_VAL_NOT_DEFINED";
export const COMPUTED_NOT_REFERENCED = "COMPUTED_NOT_REFERENCED";
export const UNKNOWN_REQUEST_NAME = "UNKNOWN_REQUEST_NAME";
export const UNKNOWN_COMPONENT_NAME = "UNKNOWN_COMPONENT_NAME";

const LEVEL_WARN = "warn";
const LEVEL_ERROR = "error";
const LEVEL_HINT = "hint";

export function checkComponent(Comp, lx = new LintContext()) {
  return lx.push({ componentName: Comp.name }, () => {
    const referencedAlters = new Set();
    const referencedInputs = new Set();
    const referencedComputed = new Set();
    checkEventHandlersHaveImpls(lx, Comp, referencedInputs);
    checkConsistentAttrs(lx, Comp, referencedAlters, referencedComputed);
    for (const name in Comp.views) {
      lx.push({ viewName: name }, () =>
        checkView(lx, Comp.views[name], Comp, referencedAlters, referencedComputed),
      );
    }
    checkUnreferencedAlterHandlers(lx, Comp, referencedAlters);
    checkUnreferencedInputHandlers(lx, Comp, referencedInputs);
    checkUnreferencedComputed(lx, Comp, referencedComputed);
    return lx;
  });
}

function checkView(lx, view, Comp, referencedAlters, referencedComputed) {
  checkRenderItInLoop(lx, view);
  checkEventModifiers(lx, view);
  checkKnownHandlerNames(lx, view, Comp, referencedAlters, referencedComputed);
}

function checkRenderItInLoop(lx, view) {
  let hasRenderIt = false;
  for (const node of view.ctx.nodes) {
    if (node.constructor.name === "RenderItNode") {
      hasRenderIt = true;
      break;
    }
  }
  if (!hasRenderIt) return;
  walkForRenderIt(lx, view.anode, 0);
}

function walkForRenderIt(lx, node, loopDepth) {
  if (node === null || node === undefined) return;
  switch (node.constructor.name) {
    case "RenderItNode":
      if (loopDepth === 0) lx.error(RENDER_IT_OUTSIDE_OF_LOOP, { node });
      return;
    case "EachNode":
      walkForRenderIt(lx, node.node, loopDepth + 1);
      return;
    case "ShowNode":
    case "HideNode":
    case "ScopeNode":
    case "SlotNode":
    case "PushViewNameNode":
    case "MacroNode":
    case "RenderOnceNode":
      walkForRenderIt(lx, node.node, loopDepth);
      return;
    case "DomNode":
    case "FragmentNode":
      for (const child of node.childs) walkForRenderIt(lx, child, loopDepth);
      return;
    default:
      return;
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

function checkKnownHandlerNames(lx, view, Comp, referencedAlters, referencedComputed) {
  const { computed, scope, alter, Class } = Comp;
  const { prototype: proto } = Class;
  const { fields } = Class.getMetaClass();
  for (const event of view.ctx.events) {
    for (const handler of event.handlers) {
      const { args } = handler.handlerCall;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        checkConsistentAttrVal(lx, arg, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
      }
    }
  }
}

function checkEventHandlersHaveImpls(lx, Comp, referencedInputs) {
  const { input, views, Class } = Comp;
  const { prototype: proto } = Class;
  for (const viewName in views) {
    lx.push({ viewName }, () => {
      const view = views[viewName];
      for (const event of view.ctx.events) {
        for (const handler of event.handlers) {
          const { handlerVal } = handler.handlerCall;
          const hvName = handlerVal?.constructor.name;
          if (hvName === "InputHandlerNameVal") {
            referencedInputs?.add(handlerVal.name);
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
            referencedInputs?.add(handlerVal.name);
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
    });
  }
}

function checkConsistentAttrVal(lx, val, fields, proto, computed, scope, alter, referencedAlters, referencedComputed, skipNameVal = false) {
  const valName = val?.constructor.name;
  if (valName === "FieldVal" || valName === "RawFieldVal") {
    const { name } = val;
    if (fields[name] === undefined && proto[name] === undefined) {
      lx.error(FIELD_VAL_NOT_DEFINED, { val, name });
    }
  } else if (valName === "ComputedVal") {
    const { name } = val;
    referencedComputed?.add(name);
    if (computed[name] === undefined) {
      lx.error(COMPUTED_VAL_NOT_DEFINED, { val, name });
    }
  } else if (valName === "SeqAccessVal") {
    checkConsistentAttrVal(lx, val.seqVal, fields, proto, computed, scope, alter, referencedAlters, referencedComputed, skipNameVal);
    checkConsistentAttrVal(lx, val.keyVal, fields, proto, computed, scope, alter, referencedAlters, referencedComputed, skipNameVal);
  } else if (valName === "RequestVal") {
    if (scope.lookupRequest(val.name) === null) {
      lx.warn(UNKNOWN_REQUEST_NAME, { name: val.name });
    }
  } else if (valName === "TypeVal") {
    if (scope.lookupComponent(val.name) === null) {
      lx.warn(UNKNOWN_COMPONENT_NAME, { name: val.name });
    }
  } else if (valName === "NameVal") {
    // NameVals on a macro call-site attribute are macro-param bindings, not
    // handler args — their role is determined inside the macro body after
    // ^-substitution, where re-parsing handles validation.
    if (!skipNameVal && !isKnownHandlerName(val.name)) {
      lx.warn(UNKNOWN_HANDLER_ARG_NAME, { name: val.name });
    }
  } else if (valName === "StrTplVal") {
    for (const subVal of val.vals) {
      checkConsistentAttrVal(lx, subVal, fields, proto, computed, scope, alter, referencedAlters, referencedComputed, skipNameVal);
    }
  } else if (valName === "AlterHandlerNameVal") {
    referencedAlters?.add(val.name);
    if (alter[val.name] === undefined) {
      lx.warn(ALT_HANDLER_NOT_DEFINED, { name: val.name });
    }
  } else if (valName !== "ConstVal" && valName !== "BindVal") {
    console.log(val);
  }
}

function checkConsistentAttrs(lx, Comp, referencedAlters, referencedComputed) {
  const { computed, scope, views, alter, Class } = Comp;
  const { prototype: proto } = Class;
  const { fields } = Class.getMetaClass();
  for (const viewName in views) {
    lx.push({ viewName }, () => {
      const view = views[viewName];
      for (const attr of view.ctx.attrs) {
        const { attrs, wrapperAttrs, textChild, isMacroCall } = attr;

        if (attrs?.constructor.name === "DynAttrs") {
          for (const attr of attrs.items) {
            if (attr?.constructor.name === "Attr") {
              checkConsistentAttrVal(lx, attr.val, fields, proto, computed, scope, alter, referencedAlters, referencedComputed, isMacroCall);
            }
          }
        }

        if (wrapperAttrs !== null) {
          for (const w of wrapperAttrs) {
            if (w.name === "each") {
              if (w.whenVal)
                checkConsistentAttrVal(lx, w.whenVal, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
              if (w.enrichWithVal)
                checkConsistentAttrVal(lx, w.enrichWithVal, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
              if (w.loopWithVal)
                checkConsistentAttrVal(lx, w.loopWithVal, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
            } else if (w.name !== "scope") {
              // "scope" wrappers create a registered ScopeNode whose .val is the same
              // reference; it's already checked via the view.ctx.nodes loop below.
              checkConsistentAttrVal(lx, w.val, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
            }
          }
        }

        if (textChild) {
          checkConsistentAttrVal(lx, textChild, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
        }
      }
      for (const node of view.ctx.nodes) {
        if (node.val) {
          checkConsistentAttrVal(lx, node.val, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
        }
        if (node.constructor.name === "RenderEachNode") {
          const iter = node.iterInfo;
          if (iter.whenVal)
            checkConsistentAttrVal(lx, iter.whenVal, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
          if (iter.loopWithVal)
            checkConsistentAttrVal(lx, iter.loopWithVal, fields, proto, computed, scope, alter, referencedAlters, referencedComputed);
        }
      }
    });
  }
}

function checkUnreferencedAlterHandlers(lx, Comp, referencedAlters) {
  for (const name in Comp.alter) {
    if (!referencedAlters.has(name)) {
      lx.hint(ALT_HANDLER_NOT_REFERENCED, { name });
    }
  }
}

function checkUnreferencedInputHandlers(lx, Comp, referencedInputs) {
  for (const name in Comp.input) {
    if (!referencedInputs.has(name)) {
      lx.hint(INPUT_HANDLER_NOT_REFERENCED, { name });
    }
  }
}

function checkUnreferencedComputed(lx, Comp, referencedComputed) {
  for (const name in Comp.computed) {
    if (!referencedComputed.has(name)) {
      lx.hint(COMPUTED_NOT_REFERENCED, { name });
    }
  }
}

export class LintContext {
  constructor() {
    this.reports = [];
    this.frame = {};
  }
  push(patch, fn) {
    const prev = this.frame;
    this.frame = { ...prev, ...patch };
    try {
      return fn();
    } finally {
      this.frame = prev;
    }
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
    this.reports.push({ id, info, level, context: { ...this.frame } });
  }
}

export class LintParseContext extends ParseContext {
  constructor(DOMParser, Text, Comment) {
    super(DOMParser, Text, Comment);
    this.attrs = [];
  }
  onAttributes(attrs, wrapperAttrs, textChild, isMacroCall = false) {
    this.attrs.push({ attrs, wrapperAttrs, textChild, isMacroCall });
  }
}
