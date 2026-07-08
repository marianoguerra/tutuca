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
  "name view style commonStyle globalStyle input receive bubble response alter views provide lookup fields methods statics".split(
    " ",
  ),
);

const EMPTY_SET = new Set();

// Extra component-spec keys the framework itself recognizes (collected into
// comp.extra by src/components.js but consumed at runtime), so they are never
// flagged as unknown regardless of the caller-supplied wellKnownExtras.
// `requestOverridesField`: the storybook Example uses it to mark the field holding
// per-example request-handler mocks (see src/storybook.js).
const FRAMEWORK_WELL_KNOWN_EXTRAS = new Set(["requestOverridesField"]);

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
export const DYN_VAL_NOT_DEFINED = "DYN_VAL_NOT_DEFINED";
export const DYN_ALIAS_NOT_REFERENCED = "DYN_ALIAS_NOT_REFERENCED";
export const PROVIDE_NOT_ADDRESSABLE = "PROVIDE_NOT_ADDRESSABLE";
export const LOOKUP_BAD_SHAPE = "LOOKUP_BAD_SHAPE";
export const LOOKUP_TARGET_MALFORMED = "LOOKUP_TARGET_MALFORMED";
export const RENDER_IT_OUTSIDE_OF_LOOP = "RENDER_IT_OUTSIDE_OF_LOOP";
export const UNKNOWN_EVENT_MODIFIER = "UNKNOWN_EVENT_MODIFIER";
export const UNKNOWN_HANDLER_ARG_NAME = "UNKNOWN_HANDLER_ARG_NAME";
export const INPUT_HANDLER_NOT_IMPLEMENTED = "INPUT_HANDLER_NOT_IMPLEMENTED";
export const INPUT_HANDLER_NOT_REFERENCED = "INPUT_HANDLER_NOT_REFERENCED";
export const INPUT_HANDLER_METHOD_NOT_IMPLEMENTED = "INPUT_HANDLER_METHOD_NOT_IMPLEMENTED";
export const INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD = "INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD";
export const INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER = "INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER";
export const FIELD_VAL_NOT_DEFINED = "FIELD_VAL_NOT_DEFINED";
export const FIELD_VAL_IS_METHOD = "FIELD_VAL_IS_METHOD";
export const METHOD_VAL_NOT_DEFINED = "METHOD_VAL_NOT_DEFINED";
export const METHOD_VAL_IS_FIELD = "METHOD_VAL_IS_FIELD";
export const DUPLICATE_ATTR_DEFINITION = "DUPLICATE_ATTR_DEFINITION";
export const IF_NO_BRANCH_SET = "IF_NO_BRANCH_SET";
export const UNKNOWN_COMPONENT_NAME = "UNKNOWN_COMPONENT_NAME";
export const UNKNOWN_MACRO_ARG = "UNKNOWN_MACRO_ARG";
export const UNKNOWN_DIRECTIVE = "UNKNOWN_DIRECTIVE";
export const UNKNOWN_X_OP = "UNKNOWN_X_OP";
export const UNKNOWN_X_ATTR = "UNKNOWN_X_ATTR";
export const X_OP_IGNORES_CHILDREN = "X_OP_IGNORES_CHILDREN";
export const MAYBE_DROP_AT_PREFIX = "MAYBE_DROP_AT_PREFIX";
export const MAYBE_ADD_AT_PREFIX = "MAYBE_ADD_AT_PREFIX";
// TEMPORARY (added 2026-07-08): nudges legacy bare `show`/`hide`/`when` on `<x>`
// ops toward the `@`-prefixed directive form. Remove when the bare spelling is
// dropped.
export const DEPRECATED_BARE_X_DIRECTIVE = "DEPRECATED_BARE_X_DIRECTIVE";
export const BAD_VALUE = "BAD_VALUE";
export const UNSUPPORTED_EXPR_SYNTAX = "UNSUPPORTED_EXPR_SYNTAX";
export const BINDING_MEMBER_TOO_DEEP = "BINDING_MEMBER_TOO_DEEP";
export const SUGGEST_BINDING_MEMBER = "SUGGEST_BINDING_MEMBER";
export const REDUNDANT_TEMPLATE_STRING = "REDUNDANT_TEMPLATE_STRING";
export const PLACEHOLDERLESS_TEMPLATE_STRING = "PLACEHOLDERLESS_TEMPLATE_STRING";
export const CONSTANT_CONDITION = "CONSTANT_CONDITION";
export const UNKNOWN_COMPONENT_SPEC_KEY = "UNKNOWN_COMPONENT_SPEC_KEY";
export const COMP_FIELD_BAD_SHAPE = "COMP_FIELD_BAD_SHAPE";
export const ASYNC_HANDLER = "ASYNC_HANDLER";
export const TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE = "TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE";
export const GLOBAL_SELECTOR_IN_SCOPED_STYLE = "GLOBAL_SELECTOR_IN_SCOPED_STYLE";
export const FIELD_NAME_RESERVED_BY_RECORD = "FIELD_NAME_RESERVED_BY_RECORD";

// Component classes are Immutable.js Records, so a field whose name matches a
// Record-API member loses its `.field` accessor — the value is then only
// reachable via `instance.get("name")`. Most API names are verbs (`get`,
// `set`, `merge`, …) that nobody picks as a field name; this list is the
// noun-like members that read as plausible field names. Verified against
// `deps/immutable.js`: defining a field with one of these triggers Immutable's
// "part of the Record API" warning and drops the accessor. (Note `size`,
// `keys`, `values` are NOT here — in this build the field accessor wins and
// they work fine.)
const RECORD_FIELD_NAME_COLLISIONS = new Set(["entries", "hashCode"]);

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

// Directive-only names that require a leading `@` on a host element (the
// iteration filters and conditional wrappers). On `<x>` they are written
// bare (`when=`, `show=`, …); on a host element the same name without `@` is
// silently swallowed as a plain HTML attribute, so flag it as a probable
// dropped `@`. Symmetric to MAYBE_DROP_AT_PREFIX, which catches the reverse
// mistake (`@when` written on `<x>`). `slot`/`as` are excluded on purpose:
// `slot` is a real global HTML attribute and `as` is `<x>`-only with no `@`
// form, so neither is ever a dropped-`@` typo.
const HOST_DIRECTIVE_ONLY_NAMES = new Set(["when", "enrich-with", "loop-with", "show", "hide"]);

const LEVEL_WARN = "warn";
const LEVEL_ERROR = "error";
const LEVEL_HINT = "hint";

// Parse-issue diagnostics keyed by the issue `kind` emitted during parsing.
// `id`: lint code to report. `candidates`: name set for a "did you mean"
// suggestion. `atPrefix`: name set for detecting a leading-`@` typo (e.g.
// `@render` for `render`) that triggers a drop-prefix hint.
const PARSE_ISSUES = {
  "unknown-directive": { id: UNKNOWN_DIRECTIVE, candidates: KNOWN_DIRECTIVE_NAMES },
  "unknown-x-op": { id: UNKNOWN_X_OP, candidates: X_KNOWN_OP_NAMES, atPrefix: X_KNOWN_OP_NAMES },
  "unknown-x-attr": {
    id: UNKNOWN_X_ATTR,
    candidates: X_KNOWN_ATTR_NAMES,
    atPrefix: X_KNOWN_ATTR_NAMES,
  },
  "bad-value": { id: BAD_VALUE },
};

// True only when `name` is an actual method: a function-valued data property
// somewhere on the prototype chain. The prototype also carries field accessors
// (getters added by extendProto), so a plain `proto[name]` lookup would *invoke*
// the getter against the bare prototype (which is not a Record instance) and
// throw on `this._values`. Reading the descriptor avoids triggering the getter.
function protoHasMethod(proto, name) {
  return protoMethodValue(proto, name) !== null;
}

// The method function itself, found the same descriptor-walking way (or null).
function protoMethodValue(proto, name) {
  let cursor = proto;
  while (cursor && cursor !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(cursor, name);
    if (desc !== undefined) return typeof desc.value === "function" ? desc.value : null;
    cursor = Object.getPrototypeOf(cursor);
  }
  return null;
}

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
  if (/^[.$][A-Za-z_]\w*\s+\S/.test(s)) return "call-with-args";
  if (/^\.[A-Za-z_]\w*\??(\.[A-Za-z_]\w*\??)+$/.test(s)) return "field-path";
  return null;
}

// `@name.member.member…`: a binding member read with more than one member.
// One level is legal (`@value.title`, parsed as `BindMemberVal`); deeper reads
// fail to parse and land here as a bad-value issue.
const BINDING_MEMBER_TOO_DEEP_RE = /^@[a-zA-Z]\w*\??(\.[a-zA-Z]\w*\??){2,}$/;

const UNSUPPORTED_EXPR_GUIDANCE = {
  ternary:
    "Ternary expressions aren't supported in dynamic attributes. Define a method or computed field on the component that returns the value, then reference it as '$methodName'.",
  comparison:
    "Comparisons aren't supported in dynamic attributes. Define a method like 'isFooSelected' that returns the boolean, then reference it as '$isFooSelected'.",
  logical:
    "Logical operators aren't supported in dynamic attributes. Combine the conditions in a method on the component and reference it as '$methodName'.",
  "call-with-args":
    "Method calls with arguments aren't supported here. Reference a no-arg method ('$methodName') and read what you need from component state, or split into per-case methods.",
  "field-path":
    "Fields can't be read through a dotted path. Define a method that returns the value, render a child component for the nested data, or — inside a loop — read one member off a binding ('@value.member').",
};

export function checkComponent(Comp, lx = new LintContext(), { wellKnownExtras = EMPTY_SET } = {}) {
  return lx.push({ componentName: Comp.name }, () => {
    checkUnknownSpecKeys(lx, Comp, wellKnownExtras);
    checkFieldDeclarations(lx, Comp);
    checkRecordFieldNameCollisions(lx, Comp);
    checkProvidesAreAddressable(lx, Comp);
    checkLookupShapes(lx, Comp);
    checkHandlersNotAsync(lx, Comp);
    checkScopedStyleTopLevel(lx, Comp);
    const referencedAlters = new Set();
    const referencedInputs = new Set();
    const referencedDynamics = new Set();
    checkEventHandlersHaveImpls(lx, Comp, referencedInputs);
    checkConsistentAttrs(lx, Comp, referencedAlters, referencedDynamics);
    for (const name in Comp.views) {
      lx.push({ viewName: name }, () =>
        checkView(lx, Comp.views[name], Comp, referencedAlters, referencedDynamics),
      );
    }
    checkUnreferencedAlterHandlers(lx, Comp, referencedAlters);
    checkUnreferencedInputHandlers(lx, Comp, referencedInputs);
    checkUnreferencedDynamics(lx, Comp, referencedDynamics);
    return lx;
  });
}

function checkView(lx, view, Comp, referencedAlters, referencedDynamics) {
  checkParseIssues(lx, view);
  checkRenderItInLoop(lx, view);
  checkEnrichProjection(lx, view, Comp);
  checkEventModifiers(lx, view);
  checkKnownHandlerNames(lx, view, Comp, referencedAlters, referencedDynamics);
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
    // TEMPORARY (2026-07-08): bare `show`/`hide`/`when` on `<x>` ops still parse,
    // but nudge authors to the `@`-prefixed directive form. Remove with the bare
    // spelling.
    if (kind === "deprecated:bare-x-directive") {
      lx.warn(DEPRECATED_BARE_X_DIRECTIVE, info, {
        kind: "add-prefix",
        from: info.name,
        to: `@${info.name}`,
      });
      continue;
    }
    if (kind === "x-op-ignores-children") {
      lx.warn(X_OP_IGNORES_CHILDREN, info, { kind: "remove", what: "the ignored children" });
      continue;
    }
    const rule = PARSE_ISSUES[kind];
    if (!rule) continue;
    const id = rule.id;
    if (kind === "bad-value") {
      if (typeof info.value === "string" && BINDING_MEMBER_TOO_DEEP_RE.test(info.value.trim())) {
        lx.error(BINDING_MEMBER_TOO_DEEP, info, {
          kind: "rephrase",
          from: info.value,
          text: "Read one level off the binding and compute the rest in a method or an '@enrich-with' handler.",
        });
        continue;
      }
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
    const atPrefixKnown = rule.atPrefix;
    const isAtPrefixedTypo =
      atPrefixKnown && info.name?.startsWith("@") && atPrefixKnown.has(info.name.slice(1));
    let suggestion = null;
    if (isAtPrefixedTypo) {
      suggestion = { kind: "drop-prefix", from: info.name, to: info.name.slice(1) };
    } else if (rule.candidates) {
      suggestion = replaceNameSuggestion(info.name, rule.candidates);
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

// Best-effort source inspection of an `@enrich-with` handler: when every
// statement in its body is a plain projection of the loop value
// (`binds.x = value.y` or `binds.x = value.get('y')`), the enrich is
// boilerplate — each `@x` read could be a `@value.y` member read instead.
// Returns the `{ bind, member }` pairs, or null when the body does anything
// else (or has a shape this heuristic doesn't understand).
function pureProjectionBinds(fn) {
  const src = Function.prototype.toString.call(fn);
  const head = src.match(/^[^(]*\(([^)]*)\)\s*(?:=>)?\s*/);
  if (!head) return null;
  const params = head[1].split(",").map((p) => p.trim());
  const [bindsName, , valueName] = params;
  if (!/^\w+$/.test(bindsName ?? "") || !/^\w+$/.test(valueName ?? "")) return null;
  // Body: either a `{…}` block or a single-expression arrow.
  let body = src.slice(head[0].length).trim();
  if (body.startsWith("{")) {
    if (!body.endsWith("}")) return null;
    body = body.slice(1, -1);
  }
  const statements = body
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "" && !s.startsWith("//"));
  if (statements.length === 0) return null;
  const projectionRe = new RegExp(
    `^${bindsName}\\.(\\w+)\\s*=\\s*${valueName}(?:\\.(\\w+)|\\.get\\((['"])(\\w+)\\3\\))$`,
  );
  const members = [];
  for (const statement of statements) {
    const m = statement.match(projectionRe);
    if (!m) return null;
    members.push({ bind: m[1], member: m[2] ?? m[4] });
  }
  return members;
}

// Hint when an `@each`'s `@enrich-with` handler only projects members of the
// loop value: the same reads are available directly as `@value.member`.
function checkEnrichProjection(lx, view, Comp) {
  for (const node of view.ctx.nodes) {
    if (node.constructor.name !== "EachNode") continue;
    const enrich = node.iterInfo?.enrichWithVal;
    if (!enrich?.name) continue;
    // Bare names resolve in the `alter` namespace, `$name` on the instance.
    const fn =
      enrich.constructor.name === "MethodVal"
        ? protoMethodValue(Comp.Class?.prototype, enrich.name)
        : Comp.alter?.[enrich.name];
    if (typeof fn !== "function") continue;
    const members = pureProjectionBinds(fn);
    if (members === null) continue;
    const rewrites = members.map(({ bind, member }) => `'@${bind}' -> '@value.${member}'`);
    lx.hint(
      SUGGEST_BINDING_MEMBER,
      { name: enrich.name, members },
      {
        kind: "rephrase",
        text: `Replace ${rewrites.join(", ")} in the view, then remove the '@enrich-with' and the '${enrich.name}' alter handler.`,
      },
    );
  }
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

function checkKnownHandlerNames(lx, view, Comp, referencedAlters, referencedDynamics) {
  const env = mkAttrValEnv(Comp, referencedAlters, referencedDynamics);
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
        checkConsistentAttrVal(lx, args[i], env, false, { ...errCtx, argIndex: i });
      }
    }
  }
}

// Bundles the per-component context threaded through checkConsistentAttrVal: the
// recursive value walk passes this object through unchanged.
function mkAttrValEnv(Comp, referencedAlters, referencedDynamics) {
  const { scope, alter, provide, lookup, Class } = Comp;
  const { prototype: proto } = Class;
  const { fields } = Class.getMetaClass();
  // `*name` resolves either a lookup or the component's own provide.
  const dynamicMap = { ...provide, ...lookup };
  return { fields, proto, scope, alter, referencedAlters, dynamicMap, referencedDynamics };
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
          if (hvName === "HandlerNameVal") {
            referencedInputs?.add(handlerVal.name);
            const { name } = handlerVal;
            if (input[name] === undefined) {
              const isMethodFix = protoHasMethod(proto, name);
              lx.error(
                INPUT_HANDLER_NOT_IMPLEMENTED,
                { name, handler, event, eventName, originAttr },
                isMethodFix
                  ? { kind: "add-prefix", from: name, to: `$${name}` }
                  : replaceNameSuggestion(name, Object.keys(input)),
              );
              if (isMethodFix) {
                lx.hint(
                  INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER,
                  { name, handler, event, eventName, originAttr },
                  { kind: "add-prefix", from: name, to: `$${name}` },
                );
              }
            }
          } else if (hvName === "MethodVal") {
            referencedInputs?.add(handlerVal.name);
            const { name } = handlerVal;
            if (!protoHasMethod(proto, name)) {
              const isInputFix = input[name] !== undefined;
              lx.error(
                INPUT_HANDLER_METHOD_NOT_IMPLEMENTED,
                { name, handler, event, eventName, originAttr },
                isInputFix
                  ? { kind: "drop-prefix", from: `$${name}`, to: name }
                  : replaceNameSuggestion(name, collectProtoMethodNames(proto)),
              );
              if (isInputFix) {
                lx.hint(
                  INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD,
                  { name, handler, event, eventName, originAttr },
                  { kind: "drop-prefix", from: `$${name}`, to: name },
                );
              }
            }
          }
        }
      }
    });
  }
}

// A "rewrite this to that" lint suggestion.
const fixTo = (from, to) => ({ kind: "rewrite", from, to });

// Report `code` for an undefined `name`, suggesting the closest `candidates` match.
function reportUnknownName(lx, code, name, candidates, info) {
  lx.error(code, { ...info, name }, replaceNameSuggestion(name, candidates));
}

// Boolean-condition slots (parsed via `parseBool`): a literal here is a
// constant condition that never changes. Now that every literal shares the one
// `K_CONST` kind it parses fine, so the linter — not the parser — flags it.
const BOOL_CONDITION_ORIGINS = new Set(["@show", "@hide", "<x show>", "<x hide>"]);
const isBoolConditionCtx = (errCtx) =>
  errCtx != null && (BOOL_CONDITION_ORIGINS.has(errCtx.originAttr) || errCtx.branch === "@if");

// Per value-kind consistency checks, keyed by the value AST node's constructor
// name. Each receives a context `c` bundling the linter, the value, the lint
// `env`, the `errCtx` location, `skipNameVal`, and `recurse` (to descend into
// sub-values). Kinds with no entry (BindVal, …) are inert.
const ATTR_VAL_CHECKERS = {
  // A literal is legal in most slots, but a *non-boolean* literal as the whole
  // boolean condition (`@show="'x'"`, `@if.class="1"`) is a constant that never
  // varies — almost always a mistyped field/method. `true`/`false` are left
  // alone, and so is a literal nested as a predicate argument
  // (`@show="equals? .status 'idle'"`) — only the root value is the condition.
  ConstVal({ lx, val, errCtx, isRoot }) {
    if (isRoot && isBoolConditionCtx(errCtx) && typeof val.val !== "boolean")
      lx.warn(CONSTANT_CONDITION, { ...errCtx, literal: String(val) });
  },
  // `.name` must be a field. If it names a method, the fix is `$name`.
  FieldVal({ lx, val, env, errCtx }) {
    const { fields, proto } = env;
    const { name } = val;
    if (fields[name] !== undefined) return;
    if (protoHasMethod(proto, name))
      lx.error(FIELD_VAL_IS_METHOD, { ...errCtx, val, name }, fixTo(`.${name}`, `$${name}`));
    else
      reportUnknownName(lx, FIELD_VAL_NOT_DEFINED, name, Object.keys(fields), { ...errCtx, val });
  },
  // `$name` must be a method. If it names a field, the fix is `.name`.
  MethodVal({ lx, val, env, errCtx }) {
    const { fields, proto } = env;
    const { name } = val;
    if (protoHasMethod(proto, name)) return;
    if (fields[name] !== undefined)
      lx.error(METHOD_VAL_IS_FIELD, { ...errCtx, val, name }, fixTo(`$${name}`, `.${name}`));
    else
      reportUnknownName(lx, METHOD_VAL_NOT_DEFINED, name, collectProtoMethodNames(proto), {
        ...errCtx,
        val,
      });
  },
  SeqAccessVal({ val, recurse }) {
    recurse(val.seqVal);
    recurse(val.keyVal);
  },
  TypeVal({ lx, val, env, errCtx }) {
    if (env.scope.lookupComponent(val.name) === null)
      reportUnknownName(
        lx,
        UNKNOWN_COMPONENT_NAME,
        val.name,
        scopeKeysAlong(env.scope, "byName"),
        errCtx,
      );
  },
  NameVal({ lx, val, errCtx, skipNameVal }) {
    // NameVals on a macro call-site attribute are macro-param bindings, not
    // handler args — their role is determined inside the macro body after
    // ^-substitution, where re-parsing handles validation.
    if (!skipNameVal && !isKnownHandlerName(val.name))
      reportUnknownName(lx, UNKNOWN_HANDLER_ARG_NAME, val.name, KNOWN_HANDLER_NAMES, errCtx);
  },
  StrTplVal({ lx, val, errCtx, recurse, isRoot }) {
    const vs = val.vals;
    const literal = val.toLiteralSource();
    if (literal !== null) {
      // Every part is constant — the `$'…'` template has no dynamic placeholder.
      // As the whole boolean condition that makes it a constant condition;
      // elsewhere (including as a predicate argument) it is just a string
      // literal written the long way: `$'foo'` → `'foo'`.
      if (isRoot && isBoolConditionCtx(errCtx)) lx.warn(CONSTANT_CONDITION, { ...errCtx, literal });
      else
        lx.hint(
          PLACEHOLDERLESS_TEMPLATE_STRING,
          { ...errCtx, literal },
          fixTo(`$${literal}`, literal),
        );
      // Parts are all plain constants — nothing to recurse into (and recursing
      // would re-flag them via the ConstVal checker in a boolean slot).
      return;
    } else if (vs.length === 1) {
      // Single-element StrTplVal === single `{expr}` with no surrounding text,
      // since StrTplVal.parse trims empty ConstVal bookends. The wrapper is
      // redundant: `:class="{.foo}"` should just be `:class=".foo"`.
      const simpler = String(vs[0]);
      lx.warn(REDUNDANT_TEMPLATE_STRING, { ...errCtx, simpler }, fixTo(`$'{${simpler}}'`, simpler));
    }
    for (const subVal of vs) recurse(subVal);
  },
  HandlerNameVal({ lx, val, env, errCtx }) {
    env.referencedAlters?.add(val.name);
    if (env.alter[val.name] === undefined)
      reportUnknownName(lx, ALT_HANDLER_NOT_DEFINED, val.name, Object.keys(env.alter), errCtx);
  },
  // Predicate args recurse as non-root: a literal arg (`equals? .status 'idle'`)
  // is normal usage, not a constant condition. But a predicate whose args are
  // ALL literals never changes, so the whole call is flagged as one.
  PredicateVal({ lx, val, errCtx, recurse }) {
    const isConstArg = (a) =>
      a.constructor.name === "ConstVal" ||
      (a.constructor.name === "StrTplVal" && a.toLiteralSource() !== null);
    if (isBoolConditionCtx(errCtx) && val.args.every(isConstArg))
      lx.warn(CONSTANT_CONDITION, { ...errCtx, literal: String(val) });
    for (const arg of val.args) recurse(arg);
  },
  DynVal({ lx, val, env, errCtx }) {
    env.referencedDynamics?.add(val.name);
    if (env.dynamicMap[val.name] === undefined)
      reportUnknownName(lx, DYN_VAL_NOT_DEFINED, val.name, Object.keys(env.dynamicMap), errCtx);
  },
};

function checkConsistentAttrVal(lx, val, env, skipNameVal = false, errCtx = null, isRoot = true) {
  const check = ATTR_VAL_CHECKERS[val?.constructor.name];
  if (check === undefined) return;
  const recurse = (sub) => checkConsistentAttrVal(lx, sub, env, skipNameVal, errCtx, false);
  check({ lx, val, env, errCtx, skipNameVal, recurse, isRoot });
}

const NODE_KIND_TO_CTX = {
  RenderTextNode: { originAttr: "<x text>" },
  RenderNode: { originAttr: "<x render>" },
  RenderItNode: { originAttr: "<x render-it>" },
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

// Flag a directive-only name (`when`, `@enrich-with`, …) written as a plain
// attribute on a host element — almost always a dropped `@`. `<x>` ops never
// reach `onAttributes` (they go through parseXOp), and macro calls carry macro
// args rather than directives, so both are skipped. The `@`-prefixed forms are
// parsed into `wrapperAttrs`/`eachAttr`, so any directive name reaching `attrs`
// here is necessarily the bare form.
function checkHostBareDirectives(lx, attrs, tag, isMacroCall) {
  if (isMacroCall || !attrs) return;
  const kind = attrs.constructor.name;
  let names;
  if (kind === "ConstAttrs") names = Object.keys(attrs.items);
  else if (kind === "DynAttrs") names = attrs.items.map((a) => a?.name);
  else return;
  for (const name of names) {
    if (HOST_DIRECTIVE_ONLY_NAMES.has(name)) {
      lx.hint(
        MAYBE_ADD_AT_PREFIX,
        { name, tag, suggestion: `@${name}` },
        { kind: "add-prefix", from: name, to: `@${name}` },
      );
    }
  }
}

function checkConsistentAttrs(lx, Comp, referencedAlters, referencedDynamics) {
  const { views } = Comp;
  const env = mkAttrValEnv(Comp, referencedAlters, referencedDynamics);
  for (const viewName in views) {
    lx.push({ viewName }, () => {
      const view = views[viewName];
      for (const entry of view.ctx.attrs) {
        const { attrs, wrapperAttrs, textChild, isMacroCall, tag } = entry;

        checkHostBareDirectives(lx, attrs, tag, isMacroCall);

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
                checkConsistentAttrVal(lx, subVal, env, isMacroCall, {
                  tag,
                  originAttr: `@if.${attr.name}`,
                  branch,
                });
              }
            } else if (attr?.val !== undefined) {
              checkConsistentAttrVal(lx, attr.val, env, isMacroCall, {
                tag,
                originAttr: attrOriginAttr(attr),
              });
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
                checkConsistentAttrVal(lx, w.whenVal, env, false, { tag, originAttr: "@when" });
              if (w.enrichWithVal)
                checkConsistentAttrVal(lx, w.enrichWithVal, env, false, {
                  tag,
                  originAttr: "@enrich-with",
                });
              if (w.loopWithVal)
                checkConsistentAttrVal(lx, w.loopWithVal, env, false, {
                  tag,
                  originAttr: "@loop-with",
                });
            } else {
              // "scope" wrappers come from `@enrich-with` outside `@each`; the
              // ScopeNode in view.ctx.nodes references the same val, so we only
              // check it here (with attr context) and skip in the node loop.
              const originAttr = w.name === "scope" ? "@enrich-with" : `@${w.name}`;
              checkConsistentAttrVal(lx, w.val, env, false, { tag, originAttr });
            }
          }
        }

        if (textChild) {
          checkConsistentAttrVal(lx, textChild, env, false, { tag, originAttr: "@text" });
        }
      }
      for (const node of view.ctx.nodes) {
        const nodeKind = node.constructor.name;
        // ScopeNode.val is already checked via wrapperAttrs with @enrich-with context.
        if (nodeKind === "ScopeNode") continue;
        const baseCtx = nodeCtxForNode(nodeKind);
        if (node.val) {
          checkConsistentAttrVal(lx, node.val, env, false, baseCtx);
        }
        // `<x render-each>` is sugar for `@each` + `<x render-it>`, so its
        // EachNode carries @when/@loop-with on iterInfo but has no wrapperAttr
        // entry to check them through — do it here (marked by `fromRenderEach`).
        if (nodeKind === "EachNode" && node.fromRenderEach) {
          const iter = node.iterInfo;
          if (iter.whenVal)
            checkConsistentAttrVal(lx, iter.whenVal, env, false, {
              originAttr: "<x render-each when>",
            });
          if (iter.loopWithVal)
            checkConsistentAttrVal(lx, iter.loopWithVal, env, false, {
              originAttr: "<x render-each loop-with>",
            });
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
    if (FRAMEWORK_WELL_KNOWN_EXTRAS.has(key) || wellKnownExtras.has(key)) continue;
    candidates ??= [
      ...KNOWN_COMPONENT_SPEC_KEYS,
      ...FRAMEWORK_WELL_KNOWN_EXTRAS,
      ...wellKnownExtras,
    ];
    lx.warn(UNKNOWN_COMPONENT_SPEC_KEY, { key }, replaceNameSuggestion(key, candidates));
  }
}

function checkFieldDeclarations(lx, Comp) {
  const fields = Comp.Class?.getMetaClass?.().fields;
  if (!fields) return;
  for (const fieldName in fields) {
    const field = fields[fieldName];
    // FieldComp is the only Field subclass that owns an `args` property
    // (set in its constructor). Structural check — `instanceof FieldComp`
    // breaks when the linter and the spec under lint resolve `src/oo.js`
    // through different module instances (e.g. `"tutuca"` package import vs
    // direct path).
    if (!Object.hasOwn(field, "args")) continue;
    if (typeof field.type !== "string") {
      lx.error(COMP_FIELD_BAD_SHAPE, {
        fieldName,
        kind: "component-not-string",
        got: typeof field.type,
        gotName: field.type?.name ?? null,
      });
    }
    if (field.args == null || field.args.constructor !== Object) {
      lx.error(COMP_FIELD_BAD_SHAPE, {
        fieldName,
        kind: "args-not-object",
        got: field.args === null ? "null" : typeof field.args,
      });
    }
  }
}

function checkRecordFieldNameCollisions(lx, Comp) {
  const fields = Comp.Class?.getMetaClass?.().fields;
  if (!fields) return;
  for (const name in fields) {
    if (RECORD_FIELD_NAME_COLLISIONS.has(name)) {
      lx.error(FIELD_NAME_RESERVED_BY_RECORD, { name });
    }
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

// The five handler blocks are invoked synchronously: the transactor treats a
// handler's return value as the new state leaf without awaiting it. An async
// handler returns a Promise instead of an updated `this`, so the update is lost.
// Async work belongs in a request handler (which the transactor does await),
// never in these blocks. Detect async-ness on the raw function object — it isn't
// represented in the value AST. Request handlers live in `scope.reqsByName`, not
// on the component, so they're never reached here.
const HANDLER_CHANNELS = ["input", "receive", "bubble", "response", "alter"];
const ASYNC_HANDLER_HELP =
  "Move the async work into a request handler and trigger it with " +
  "ctx.request('name', args), then handle the result in a synchronous response " +
  "handler. To coordinate other components, keep the handler synchronous and use " +
  "ctx.send to deliver a message or ctx.bubble to raise an event.";

function checkHandlersNotAsync(lx, Comp) {
  for (const channel of HANDLER_CHANNELS) {
    const block = Comp[channel];
    if (!block) continue;
    for (const name in block) {
      const fn = block[name];
      if (typeof fn === "function" && fn.constructor?.name === "AsyncFunction") {
        lx.error(
          ASYNC_HANDLER,
          { name, channel },
          { kind: "rephrase", from: name, text: ASYNC_HANDLER_HELP },
        );
      }
    }
  }
}

// `style`/`commonStyle` are wrapped by Component.compileStyle in a
// component-scoped selector (`[data-cid="N"]{ … }` / `…[data-vid="V"]{ … }`),
// so their CSS lands *inside* a style-rule block. Top-level-only at-rules
// (@import, @keyframes, @font-face, …) and rules whose leading selector targets
// the document root (html/body/:root) are invalid or dead once nested there —
// the browser silently drops them. `globalStyle` is injected verbatim with no
// wrapper, so it is the correct home and is never checked here.
//
// CSS is a raw string with no parser in the project; we scan with regexes after
// blanking out comments and string literals so @-tokens inside `content: "@x"`
// or `/* @x */` don't trip the rule. A `/* tutuca-lint-ignore */` comment on the
// same line as a finding suppresses it (the only inline lint-suppression in
// tutuca, intentionally scoped to this CSS scan).

// Only these names — the nestable conditional-group rules (@media, @supports,
// @container, @layer, @scope, @starting-style) are deliberately absent, so they
// never match. Optional vendor prefix covers @-webkit-keyframes etc. The
// leading [\s;{}] (or string start) ensures it's a real at-rule, and \b stops
// @importx / @pages from matching.
const NON_NESTABLE_AT_RULE =
  /(?:^|[\s;{}])@(?:-[a-z]+-)?(charset|import|namespace|font-face|keyframes|page|property|counter-style|font-feature-values|font-palette-values|view-transition)\b/gi;

// A rule whose leading compound selector is html/body/:root and which opens a
// block (`{`) before any `;` (so declarations can't match). Anchored on
// start/`{`/`}` so only the *leading* selector counts — `& body` / `div body`
// descendant selectors are left alone. `:scope` is excluded: nested, it
// correctly refers to the component root.
const GLOBAL_LEADING_SELECTOR = /(?:^|[{}])\s*(html|body|:root)\b[^{};]*\{/gi;

const IGNORE_DIRECTIVE = /\/\*\s*tutuca-lint-ignore\s*\*\//g;

// Replace every non-newline character of a match with a space, preserving both
// byte offsets and line numbers so match positions stay accurate.
const blankRun = (m) => m.replace(/[^\n]/g, " ");
function blankCssNoise(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, blankRun) // block comments
    .replace(/"(?:[^"\\\n]|\\.)*"/g, blankRun) // double-quoted strings
    .replace(/'(?:[^'\\\n]|\\.)*'/g, blankRun); // single-quoted strings
}

// 1-based line/column of `index` within `str`.
function offsetToLineCol(str, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    if (str[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

// Set of 1-based line numbers carrying a `/* tutuca-lint-ignore */` directive.
function suppressedLines(css) {
  const lines = new Set();
  IGNORE_DIRECTIVE.lastIndex = 0;
  for (let m = IGNORE_DIRECTIVE.exec(css); m !== null; m = IGNORE_DIRECTIVE.exec(css)) {
    lines.add(offsetToLineCol(css, m.index).line);
  }
  return lines;
}

const STYLE_TO_GLOBAL_HELP =
  "Move it to the component's 'globalStyle' key, which is injected without the " +
  "component-scoping wrapper. To suppress a false positive, put a " +
  "/* tutuca-lint-ignore */ comment on the same line.";

function scanScopedCss(lx, css, key) {
  if (!css) return;
  const ignore = suppressedLines(css);
  const clean = blankCssNoise(css);
  const report = (id, info) => {
    if (ignore.has(info.location.line)) return;
    lx.error(id, { key, ...info }, { kind: "rephrase", text: STYLE_TO_GLOBAL_HELP });
  };
  NON_NESTABLE_AT_RULE.lastIndex = 0;
  for (let m = NON_NESTABLE_AT_RULE.exec(clean); m !== null; m = NON_NESTABLE_AT_RULE.exec(clean)) {
    // The atRule keyword starts at the `@`, after the optional leading separator.
    const at = m.index + m[0].indexOf("@");
    report(TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE, {
      atRule: m[1].toLowerCase(),
      location: offsetToLineCol(clean, at),
    });
  }
  GLOBAL_LEADING_SELECTOR.lastIndex = 0;
  for (
    let m = GLOBAL_LEADING_SELECTOR.exec(clean);
    m !== null;
    m = GLOBAL_LEADING_SELECTOR.exec(clean)
  ) {
    const at = m.index + m[0].indexOf(m[1]);
    report(GLOBAL_SELECTOR_IN_SCOPED_STYLE, {
      selector: m[1].toLowerCase(),
      location: offsetToLineCol(clean, at),
    });
  }
}

function checkScopedStyleTopLevel(lx, Comp) {
  scanScopedCss(lx, Comp.commonStyle, "commonStyle");
  for (const name in Comp.views) {
    const { style } = Comp.views[name];
    if (style) lx.push({ viewName: name }, () => scanScopedCss(lx, style, "style"));
  }
}

// A `provide` value must be addressable (a `.field` or `.seq[.key]`): it is used
// as a render-target / teleport path, not only read as a value. `compile()` drops
// any raw provide that fails to parse as such, so a key present in `_rawProvide`
// but absent from `provide` is a non-path value (e.g. `$method`, a constant).
function checkProvidesAreAddressable(lx, Comp) {
  for (const name in Comp._rawProvide) {
    if (Comp.provide[name] === undefined) {
      lx.error(PROVIDE_NOT_ADDRESSABLE, { name, value: Comp._rawProvide[name] });
    }
  }
}

// Validates each raw `lookup` entry against its two legal shapes, inspecting the
// authored spec directly (not the compiled result, which silently tolerates
// unknown keys and wrong-typed `default`):
//   - a bare `"Producer.provideName"` string, or
//   - `{ for: "Producer.provideName", default?: "<value expr>" }` — only those
//     two keys, both string-valued.
// A malformed container emits LOOKUP_BAD_SHAPE; a well-shaped entry whose target
// string isn't exactly `Producer.provideName` emits LOOKUP_TARGET_MALFORMED.
const KNOWN_LOOKUP_KEYS = new Set(["for", "default"]);
function checkLookupShapes(lx, Comp) {
  for (const name in Comp._rawLookup) {
    const raw = Comp._rawLookup[name];
    let target;
    if (typeof raw === "string") {
      target = raw;
    } else if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      lx.error(LOOKUP_BAD_SHAPE, {
        name,
        problem: 'must be a "Producer.provideName" string or a { for, default } object',
      });
      continue;
    } else {
      const extra = Object.keys(raw).filter((k) => !KNOWN_LOOKUP_KEYS.has(k));
      if (extra.length > 0) {
        lx.error(LOOKUP_BAD_SHAPE, { name, problem: `unknown key(s): ${extra.join(", ")}` });
        continue;
      }
      if (typeof raw.for !== "string") {
        lx.error(LOOKUP_BAD_SHAPE, { name, problem: "'for' is required and must be a string" });
        continue;
      }
      if (raw.default !== undefined && typeof raw.default !== "string") {
        lx.error(LOOKUP_BAD_SHAPE, { name, problem: "'default' must be a string" });
        continue;
      }
      target = raw.for;
    }
    const parts = target.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      lx.error(LOOKUP_TARGET_MALFORMED, { name, target });
    }
  }
}

// Only flags `lookup` entries: a `provide` is a producer pushed down the render
// stack and consumed by *child* components, so it legitimately need not appear in
// this component's own views.
function checkUnreferencedDynamics(lx, Comp, referencedDynamics) {
  for (const name in Comp.lookup) {
    if (!referencedDynamics.has(name)) {
      lx.hint(DYN_ALIAS_NOT_REFERENCED, { name });
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
  // TEMPORARY (2026-07-08): record deprecation nudges on the same channel as
  // parse issues so checkParseIssues can surface them as warnings. Remove with
  // the bare `show`/`hide`/`when` spelling.
  onDeprecatedSyntax(kind, info) {
    const tag = this.currentTag;
    this.parseIssues.push({
      kind: `deprecated:${kind}`,
      info: tag && info.tag === undefined ? { ...info, tag } : info,
    });
  }
}
