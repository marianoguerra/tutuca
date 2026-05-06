import { MOD_WRAPPERS_BY_EVENT, ParseContext } from "../../src/anode.js";
import { lintHtml } from "./htmllinter.js";
import { closestName } from "./util/closest-name.js";

// Literal directive names accepted by `AttrParser.parseDirective` in
// src/attribute.js. Lives here (not in src/) because the linter is the
// only consumer — adding it to the runtime would expand the core API
// surface for tooling-only reasons. If the parser's switch grows, this
// list must grow with it; the test "warn on unknown @directive" + a few
// "known @directives do not raise UNKNOWN_DIRECTIVE" cases catch drift.
// Does not include dotted-prefix forms (on.*, if.*, then.*, else.*) —
// those have their own parsing branch and never produce UNKNOWN_DIRECTIVE.
// Mirror of `KNOWN_SPEC_KEYS` in src/components.js. Lives here, not
// imported from src/, so the tooling-only consumer doesn't expand the
// runtime API surface. If the runtime list changes, update this set —
// the "no false positives on legit spec" test in lint.test.js exercises
// every key and catches drift.
const KNOWN_COMPONENT_SPEC_KEYS = new Set(
  "name view style commonStyle globalStyle input receive bubble response alter on views dynamic fields methods statics".split(
    " ",
  ),
);

const EMPTY_SET = new Set();

const KNOWN_DIRECTIVE_NAMES = new Set([
  "dangerouslysetinnerhtml",
  "slot",
  "push-view",
  "text",
  "show",
  "hide",
  "each",
  "enrich-with",
  "when",
  "loop-with",
  "then",
  "else",
]);

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
export const DUPLICATE_ATTR_DEFINITION = "DUPLICATE_ATTR_DEFINITION";
export const IF_NO_BRANCH_SET = "IF_NO_BRANCH_SET";
export const UNKNOWN_REQUEST_NAME = "UNKNOWN_REQUEST_NAME";
export const UNKNOWN_COMPONENT_NAME = "UNKNOWN_COMPONENT_NAME";
export const UNKNOWN_MACRO_ARG = "UNKNOWN_MACRO_ARG";
export const UNKNOWN_DIRECTIVE = "UNKNOWN_DIRECTIVE";
export const UNKNOWN_X_OP = "UNKNOWN_X_OP";
export const UNKNOWN_X_ATTR = "UNKNOWN_X_ATTR";
export const MAYBE_DROP_AT_PREFIX = "MAYBE_DROP_AT_PREFIX";
export const BAD_VALUE = "BAD_VALUE";
export const UNSUPPORTED_EXPR_SYNTAX = "UNSUPPORTED_EXPR_SYNTAX";
export const REDUNDANT_TEMPLATE_STRING = "REDUNDANT_TEMPLATE_STRING";
export const UNKNOWN_COMPONENT_SPEC_KEY = "UNKNOWN_COMPONENT_SPEC_KEY";

const PARSE_ISSUE_KIND_TO_LINT_ID = {
  "unknown-directive": UNKNOWN_DIRECTIVE,
  "unknown-x-op": UNKNOWN_X_OP,
  "unknown-x-attr": UNKNOWN_X_ATTR,
  "bad-value": BAD_VALUE,
};

const X_KNOWN_OP_NAMES = new Set([
  "slot",
  "text",
  "render",
  "render-it",
  "render-each",
  "show",
  "hide",
]);
const X_KNOWN_ATTR_NAMES = new Set(["as", "when", "loop-with", "show", "hide"]);
const AT_PREFIX_HINT_KNOWN_BY_KIND = {
  "unknown-x-op": X_KNOWN_OP_NAMES,
  "unknown-x-attr": X_KNOWN_ATTR_NAMES,
};

const LEVEL_WARN = "warn";
const LEVEL_ERROR = "error";
const LEVEL_HINT = "hint";

const PARSE_ISSUE_KIND_TO_KNOWN_NAMES = {
  "unknown-directive": KNOWN_DIRECTIVE_NAMES,
  "unknown-x-op": X_KNOWN_OP_NAMES,
  "unknown-x-attr": X_KNOWN_ATTR_NAMES,
};

// Walk the prototype chain and collect own keys from every level except
// Object.prototype. Used as the candidate set for "did you mean" against a
// component's instance methods.
function collectProtoMethodNames(proto) {
  const out = [];
  let cursor = proto;
  while (cursor && cursor !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(cursor)) {
      if (key === "constructor") continue;
      out.push(key);
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return out;
}

// Walk a ComponentStack chain (parent → root) and union all keys from each
// frame's `mapKey` map. Inline here, not on the runtime class — the linter
// is the only consumer.
function scopeKeysAlong(scope, mapKey) {
  const out = [];
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    const map = cursor[mapKey];
    if (!map) continue;
    for (const key of Object.keys(map)) out.push(key);
  }
  return out;
}

function replaceNameSuggestion(name, candidates) {
  const close = closestName(name, candidates);
  return close ? { kind: "replace-name", from: name, to: close } : null;
}

// Heuristic classifier for raw value strings the value parser rejected.
// Returns one of "ternary" | "comparison" | "logical" | "call-with-args"
// when the input looks like a JS-style expression that tutuca doesn't
// support in dynamic attributes / directives, or null otherwise.
//
// Order matters: ternary first (its `:` would also confuse adjacent
// checks), then comparison, then logical, then call-with-args.
function classifyBadValue(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s === "") return null;
  if (/\s\?\s.+\s:\s/.test(s)) return "ternary";
  if (/===|!==|==|!=|<=|>=|\s<\s|\s>\s/.test(s)) return "comparison";
  if (/&&|\|\|/.test(s)) return "logical";
  if (/^\.[A-Za-z_]\w*\s+\S/.test(s)) return "call-with-args";
  return null;
}

const UNSUPPORTED_EXPR_GUIDANCE = {
  ternary:
    "Ternary expressions aren't supported in dynamic attributes. Define a method or computed field on the component that returns the value, then reference it as '.methodName'.",
  comparison:
    "Comparisons aren't supported in dynamic attributes. Define a method like '.isFooSelected' that returns the boolean, then reference it as '.isFooSelected'.",
  logical:
    "Logical operators aren't supported in dynamic attributes. Combine the conditions in a method on the component and reference it as '.methodName'.",
  "call-with-args":
    "Method calls with arguments aren't supported here. Reference a no-arg method ('.methodName') and read what you need from component state, or split into per-case methods.",
};

export function checkComponent(Comp, lx = new LintContext(), { wellKnownExtras = EMPTY_SET } = {}) {
  return lx.push({ componentName: Comp.name }, () => {
    checkUnknownSpecKeys(lx, Comp, wellKnownExtras);
    const referencedAlters = new Set();
    const referencedInputs = new Set();
    checkEventHandlersHaveImpls(lx, Comp, referencedInputs);
    checkConsistentAttrs(lx, Comp, referencedAlters);
    for (const name in Comp.views) {
      lx.push({ viewName: name }, () => checkView(lx, Comp.views[name], Comp, referencedAlters));
    }
    checkUnreferencedAlterHandlers(lx, Comp, referencedAlters);
    checkUnreferencedInputHandlers(lx, Comp, referencedInputs);
    return lx;
  });
}

function checkView(lx, view, Comp, referencedAlters) {
  checkParseIssues(lx, view);
  checkRenderItInLoop(lx, view);
  checkEventModifiers(lx, view);
  checkKnownHandlerNames(lx, view, Comp, referencedAlters);
  checkMacroCallArgs(lx, view, Comp);
  checkHtmlStructure(lx, view);
}

const HTML_LINT_OPTS = {
  fragmentContext: "template",
  // Tutuca's <x> and <x:macroname> tags are replaced at render time. Treat as
  // phantom — case checks still apply, but don't enforce parent rules.
  transparentTagPrefixes: ["x"],
};

function checkHtmlStructure(lx, view) {
  if (typeof view.rawView !== "string" || !view.rawView) return;
  lintHtml(
    view.rawView,
    (f) => lx.report(f.id, { ...f.info, location: f.location }, f.level, f.suggestion ?? null),
    HTML_LINT_OPTS,
  );
}

function checkParseIssues(lx, view) {
  const issues = view.ctx.parseIssues;
  if (!issues) return;
  for (const { kind, info } of issues) {
    const id = PARSE_ISSUE_KIND_TO_LINT_ID[kind];
    if (!id) continue;
    if (kind === "bad-value") {
      const detected = classifyBadValue(info.value);
      if (detected) {
        lx.error(
          UNSUPPORTED_EXPR_SYNTAX,
          { ...info, detected },
          { kind: "rephrase", from: info.value, text: UNSUPPORTED_EXPR_GUIDANCE[detected] },
        );
        continue;
      }
    }
    const atPrefixKnown = AT_PREFIX_HINT_KNOWN_BY_KIND[kind];
    const isAtPrefixedTypo =
      atPrefixKnown && info.name?.startsWith("@") && atPrefixKnown.has(info.name.slice(1));
    let suggestion = null;
    if (isAtPrefixedTypo) {
      suggestion = { kind: "drop-prefix", from: info.name, to: info.name.slice(1) };
    } else {
      const candidates = PARSE_ISSUE_KIND_TO_KNOWN_NAMES[kind];
      if (candidates) suggestion = replaceNameSuggestion(info.name, candidates);
    }
    lx.error(id, info, suggestion);
    if (isAtPrefixedTypo) {
      lx.hint(
        MAYBE_DROP_AT_PREFIX,
        { ...info, suggestion: info.name.slice(1) },
        { kind: "drop-prefix", from: info.name, to: info.name.slice(1) },
      );
    }
  }
}

function checkMacroCallArgs(lx, view, Comp) {
  const { scope } = Comp;
  for (const macroNode of view.ctx.macroNodes) {
    const macro = scope.lookupMacro(macroNode.name);
    if (macro === null) continue;
    const { defaults } = macro;
    for (const argName in macroNode.attrs) {
      if (!(argName in defaults)) {
        lx.error(
          UNKNOWN_MACRO_ARG,
          { name: argName, macroName: macroNode.name, tag: `x:${macroNode.name}` },
          replaceNameSuggestion(argName, Object.keys(defaults)),
        );
      }
    }
  }
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
      if (loopDepth === 0) {
        lx.error(
          RENDER_IT_OUTSIDE_OF_LOOP,
          { node },
          { kind: "wrap", from: "<x render-it>", to: "<x render-each>" },
        );
      }
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
          const close = closestName(modifier, Object.keys(modWrappers));
          lx.error(
            UNKNOWN_EVENT_MODIFIER,
            {
              name,
              modifier,
              handler,
              event,
              originAttr: `@on.${name}+${modifiers.join("+")}`,
            },
            close ? { kind: "replace-name", from: `+${modifier}`, to: `+${close}` } : null,
          );
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

function checkKnownHandlerNames(lx, view, Comp, referencedAlters) {
  const { scope, alter, Class } = Comp;
  const { prototype: proto } = Class;
  const { fields } = Class.getMetaClass();
  for (const event of view.ctx.events) {
    for (const handler of event.handlers) {
      const { args, handlerVal } = handler.handlerCall;
      const handlerName = handlerVal?.name;
      const eventName = handler.name;
      const errCtx = {
        eventName,
        handlerName,
        originAttr: `@on.${eventName}`,
      };
      for (let i = 0; i < args.length; i++) {
        checkConsistentAttrVal(lx, args[i], fields, proto, scope, alter, referencedAlters, false, {
          ...errCtx,
          argIndex: i,
        });
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
          const eventName = handler.name;
          const originAttr = `@on.${eventName}`;
          if (hvName === "InputHandlerNameVal") {
            referencedInputs?.add(handlerVal.name);
            const { name } = handlerVal;
            if (input[name] === undefined) {
              const isMethodFix = proto[name] !== undefined;
              lx.error(
                INPUT_HANDLER_NOT_IMPLEMENTED,
                { name, handler, event, eventName, originAttr },
                isMethodFix
                  ? { kind: "add-prefix", from: name, to: `.${name}` }
                  : replaceNameSuggestion(name, Object.keys(input)),
              );
              if (isMethodFix) {
                lx.hint(
                  INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER,
                  { name, handler, event, eventName, originAttr },
                  { kind: "add-prefix", from: name, to: `.${name}` },
                );
              }
            }
          } else if (hvName === "RawFieldVal") {
            referencedInputs?.add(handlerVal.name);
            const { name } = handlerVal;
            if (proto[name] === undefined) {
              const isInputFix = input[name] !== undefined;
              lx.error(
                INPUT_HANDLER_METHOD_NOT_IMPLEMENTED,
                { name, handler, event, eventName, originAttr },
                isInputFix
                  ? { kind: "drop-prefix", from: `.${name}`, to: name }
                  : replaceNameSuggestion(name, collectProtoMethodNames(proto)),
              );
              if (isInputFix) {
                lx.hint(
                  INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD,
                  { name, handler, event, eventName, originAttr },
                  { kind: "drop-prefix", from: `.${name}`, to: name },
                );
              }
            }
          }
        }
      }
    });
  }
}

function checkConsistentAttrVal(
  lx,
  val,
  fields,
  proto,
  scope,
  alter,
  referencedAlters,
  skipNameVal = false,
  errCtx = null,
) {
  const valName = val?.constructor.name;
  if (valName === "FieldVal" || valName === "RawFieldVal") {
    const { name } = val;
    if (fields[name] === undefined && proto[name] === undefined) {
      const candidates = [...Object.keys(fields), ...collectProtoMethodNames(proto)];
      lx.error(
        FIELD_VAL_NOT_DEFINED,
        { ...errCtx, val, name },
        replaceNameSuggestion(name, candidates),
      );
    }
  } else if (valName === "SeqAccessVal") {
    checkConsistentAttrVal(
      lx,
      val.seqVal,
      fields,
      proto,
      scope,
      alter,
      referencedAlters,
      skipNameVal,
      errCtx,
    );
    checkConsistentAttrVal(
      lx,
      val.keyVal,
      fields,
      proto,
      scope,
      alter,
      referencedAlters,
      skipNameVal,
      errCtx,
    );
  } else if (valName === "RequestVal") {
    if (scope.lookupRequest(val.name) === null) {
      lx.error(
        UNKNOWN_REQUEST_NAME,
        { ...errCtx, name: val.name },
        replaceNameSuggestion(val.name, scopeKeysAlong(scope, "reqsByName")),
      );
    }
  } else if (valName === "TypeVal") {
    if (scope.lookupComponent(val.name) === null) {
      lx.error(
        UNKNOWN_COMPONENT_NAME,
        { ...errCtx, name: val.name },
        replaceNameSuggestion(val.name, scopeKeysAlong(scope, "byName")),
      );
    }
  } else if (valName === "NameVal") {
    // NameVals on a macro call-site attribute are macro-param bindings, not
    // handler args — their role is determined inside the macro body after
    // ^-substitution, where re-parsing handles validation.
    if (!skipNameVal && !isKnownHandlerName(val.name)) {
      lx.error(
        UNKNOWN_HANDLER_ARG_NAME,
        { ...errCtx, name: val.name },
        replaceNameSuggestion(val.name, KNOWN_HANDLER_NAMES),
      );
    }
  } else if (valName === "StrTplVal") {
    const vs = val.vals;
    // Single-element StrTplVal === single `{expr}` with no surrounding text,
    // since StrTplVal.parse trims empty ConstVal bookends. The wrapper is
    // redundant: `:class="{.foo}"` should just be `:class=".foo"`.
    if (vs.length === 1) {
      const simpler = String(vs[0]);
      lx.warn(
        REDUNDANT_TEMPLATE_STRING,
        { ...errCtx, simpler },
        { kind: "rewrite", from: `{${simpler}}`, to: simpler },
      );
    }
    for (const subVal of vs) {
      checkConsistentAttrVal(
        lx,
        subVal,
        fields,
        proto,
        scope,
        alter,
        referencedAlters,
        skipNameVal,
        errCtx,
      );
    }
  } else if (valName === "AlterHandlerNameVal") {
    referencedAlters?.add(val.name);
    if (alter[val.name] === undefined) {
      lx.error(
        ALT_HANDLER_NOT_DEFINED,
        { ...errCtx, name: val.name },
        replaceNameSuggestion(val.name, Object.keys(alter)),
      );
    }
  } else if (valName !== "ConstVal" && valName !== "BindVal" && valName !== "DynVal") {
    console.log(val);
  }
}

const NODE_KIND_TO_CTX = {
  RenderTextNode: { originAttr: "<x text>" },
  RenderNode: { originAttr: "<x render>" },
  RenderItNode: { originAttr: "<x render-it>" },
  RenderEachNode: { originAttr: "<x render-each>" },
  ShowNode: { originAttr: "<x show>" },
  HideNode: { originAttr: "<x hide>" },
  PushViewNameNode: { originAttr: "<x push-view>" },
};
function nodeCtxForNode(nodeKind) {
  return NODE_KIND_TO_CTX[nodeKind] ?? null;
}

function attrSourceLabel(attr) {
  const cn = attr.constructor.name;
  if (cn === "ConstAttr") return "literal";
  if (cn === "IfAttr") return `@if.${attr.name}`;
  if (cn === "RawHtmlAttr") return "@dangerouslysetinnerhtml";
  return `:${attr.name}`;
}

function attrOriginAttr(attr) {
  const cn = attr.constructor.name;
  if (cn === "IfAttr") return `@if.${attr.name}`;
  if (cn === "RawHtmlAttr") return "@dangerouslysetinnerhtml";
  return `:${attr.name}`;
}

function checkConsistentAttrs(lx, Comp, referencedAlters) {
  const { scope, views, alter, Class } = Comp;
  const { prototype: proto } = Class;
  const { fields } = Class.getMetaClass();
  for (const viewName in views) {
    lx.push({ viewName }, () => {
      const view = views[viewName];
      for (const entry of view.ctx.attrs) {
        const { attrs, wrapperAttrs, textChild, isMacroCall, tag } = entry;

        if (attrs?.constructor.name === "DynAttrs") {
          const sourcesByName = new Map();
          for (const attr of attrs.items) {
            const name = attr?.name;
            if (name !== undefined && name !== "data-eid") {
              const sources = sourcesByName.get(name);
              const label = attrSourceLabel(attr);
              if (sources) sources.push(label);
              else sourcesByName.set(name, [label]);
            }
            if (attr?.constructor.name === "IfAttr") {
              if (!attr.anyBranchIsSet) {
                lx.error(IF_NO_BRANCH_SET, { attr: attr.name, tag });
              }
              const branches = [
                ["@if", attr.condVal],
                ["@then", attr.thenVal],
                ["@else", attr.elseVal],
              ];
              for (const [branch, subVal] of branches) {
                checkConsistentAttrVal(
                  lx,
                  subVal,
                  fields,
                  proto,
                  scope,
                  alter,
                  referencedAlters,
                  isMacroCall,
                  { tag, originAttr: `@if.${attr.name}`, branch },
                );
              }
            } else if (attr?.val !== undefined) {
              checkConsistentAttrVal(
                lx,
                attr.val,
                fields,
                proto,
                scope,
                alter,
                referencedAlters,
                isMacroCall,
                { tag, originAttr: attrOriginAttr(attr) },
              );
            }
          }
          for (const [name, sources] of sourcesByName) {
            if (sources.length > 1) {
              lx.error(DUPLICATE_ATTR_DEFINITION, { name, sources, tag });
            }
          }
        }

        if (wrapperAttrs !== null) {
          for (const w of wrapperAttrs) {
            if (w.name === "each") {
              if (w.whenVal)
                checkConsistentAttrVal(
                  lx,
                  w.whenVal,
                  fields,
                  proto,
                  scope,
                  alter,
                  referencedAlters,
                  false,
                  { tag, originAttr: "@when" },
                );
              if (w.enrichWithVal)
                checkConsistentAttrVal(
                  lx,
                  w.enrichWithVal,
                  fields,
                  proto,
                  scope,
                  alter,
                  referencedAlters,
                  false,
                  { tag, originAttr: "@enrich-with" },
                );
              if (w.loopWithVal)
                checkConsistentAttrVal(
                  lx,
                  w.loopWithVal,
                  fields,
                  proto,
                  scope,
                  alter,
                  referencedAlters,
                  false,
                  { tag, originAttr: "@loop-with" },
                );
            } else {
              // "scope" wrappers come from `@enrich-with` outside `@each`; the
              // ScopeNode in view.ctx.nodes references the same val, so we only
              // check it here (with attr context) and skip in the node loop.
              const originAttr = w.name === "scope" ? "@enrich-with" : `@${w.name}`;
              checkConsistentAttrVal(
                lx,
                w.val,
                fields,
                proto,
                scope,
                alter,
                referencedAlters,
                false,
                { tag, originAttr },
              );
            }
          }
        }

        if (textChild) {
          checkConsistentAttrVal(
            lx,
            textChild,
            fields,
            proto,
            scope,
            alter,
            referencedAlters,
            false,
            { tag, originAttr: "@text" },
          );
        }
      }
      for (const node of view.ctx.nodes) {
        const nodeKind = node.constructor.name;
        // ScopeNode.val is already checked via wrapperAttrs with @enrich-with context.
        if (nodeKind === "ScopeNode") continue;
        const baseCtx = nodeCtxForNode(nodeKind);
        if (node.val) {
          checkConsistentAttrVal(
            lx,
            node.val,
            fields,
            proto,
            scope,
            alter,
            referencedAlters,
            false,
            baseCtx,
          );
        }
        if (nodeKind === "RenderEachNode") {
          const iter = node.iterInfo;
          if (iter.whenVal)
            checkConsistentAttrVal(
              lx,
              iter.whenVal,
              fields,
              proto,
              scope,
              alter,
              referencedAlters,
              false,
              { originAttr: "<x render-each when>" },
            );
          if (iter.loopWithVal)
            checkConsistentAttrVal(
              lx,
              iter.loopWithVal,
              fields,
              proto,
              scope,
              alter,
              referencedAlters,
              false,
              { originAttr: "<x render-each loop-with>" },
            );
        }
      }
    });
  }
}

function checkUnknownSpecKeys(lx, Comp, wellKnownExtras) {
  const extra = Comp.extra;
  if (!extra) return;
  let candidates = null;
  for (const key of Object.keys(extra)) {
    if (wellKnownExtras.has(key)) continue;
    candidates ??= [...KNOWN_COMPONENT_SPEC_KEYS, ...wellKnownExtras];
    lx.warn(UNKNOWN_COMPONENT_SPEC_KEY, { key }, replaceNameSuggestion(key, candidates));
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
  error(id, info, suggestion = null) {
    this.report(id, info, LEVEL_ERROR, suggestion);
  }
  warn(id, info, suggestion = null) {
    this.report(id, info, LEVEL_WARN, suggestion);
  }
  hint(id, info, suggestion = null) {
    this.report(id, info, LEVEL_HINT, suggestion);
  }
  report(id, info = {}, level = LEVEL_ERROR, suggestion = null) {
    this.reports.push({ id, info, level, context: { ...this.frame }, suggestion });
  }
}

export class LintParseContext extends ParseContext {
  constructor(document, Text, Comment) {
    super(document, Text, Comment);
    this.attrs = [];
    this.parseIssues = [];
  }
  onAttributes(attrs, wrapperAttrs, textChild, isMacroCall = false, tag = null) {
    this.attrs.push({ attrs, wrapperAttrs, textChild, isMacroCall, tag });
  }
  onParseIssue(kind, info) {
    const tag = this.currentTag;
    this.parseIssues.push({ kind, info: tag && info.tag === undefined ? { ...info, tag } : info });
  }
}
