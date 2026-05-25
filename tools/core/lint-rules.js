// Canonical table of component-linter rule codes.
//
// Single source of truth for documentation: `tutuca help lint` prints it
// for humans, `tutuca agent-context` emits it as JSON (`lintCodes`), and
// `docs/llm/cli.md` points at both instead of duplicating the list.
//
// Codes are imported from lint-check.js (where they are emitted), so the
// string values never drift. `level` mirrors the `lx.error|warn|hint`
// call site for each code; `summary` is a static one-liner. The
// "LINT_RULES covers every lint-check code" test in test/lint.test.js
// guards against a new code being added without an entry here.
//
// HTML structural codes (`HTML_*`) come from a separate linter
// (tools/core/htmllinter.js) and are not enumerated here.

import {
  ALT_HANDLER_NOT_DEFINED,
  ALT_HANDLER_NOT_REFERENCED,
  BAD_VALUE,
  COMP_FIELD_BAD_SHAPE,
  DUPLICATE_ATTR_DEFINITION,
  DYN_ALIAS_NOT_REFERENCED,
  DYN_VAL_NOT_DEFINED,
  FIELD_VAL_IS_METHOD,
  FIELD_VAL_NOT_DEFINED,
  IF_NO_BRANCH_SET,
  INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD,
  INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER,
  INPUT_HANDLER_METHOD_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_IMPLEMENTED,
  INPUT_HANDLER_NOT_REFERENCED,
  MAYBE_DROP_AT_PREFIX,
  METHOD_VAL_IS_FIELD,
  METHOD_VAL_NOT_DEFINED,
  PLACEHOLDERLESS_TEMPLATE_STRING,
  REDUNDANT_TEMPLATE_STRING,
  RENDER_IT_OUTSIDE_OF_LOOP,
  UNKNOWN_COMPONENT_NAME,
  UNKNOWN_COMPONENT_SPEC_KEY,
  UNKNOWN_DIRECTIVE,
  UNKNOWN_EVENT_MODIFIER,
  UNKNOWN_HANDLER_ARG_NAME,
  UNKNOWN_MACRO_ARG,
  UNKNOWN_REQUEST_NAME,
  UNKNOWN_X_ATTR,
  UNKNOWN_X_OP,
  UNSUPPORTED_EXPR_SYNTAX,
} from "./lint-check.js";

/**
 * @typedef {{ code: string, level: "error"|"warn"|"hint",
 *             group: string, summary: string }} LintRule
 */

/** @type {LintRule[]} */
export const LINT_RULES = [
  // Field / method references
  {
    code: FIELD_VAL_NOT_DEFINED,
    level: "error",
    group: "Field / method references",
    summary: "`.field` references a field not declared in `fields`.",
  },
  {
    code: FIELD_VAL_IS_METHOD,
    level: "error",
    group: "Field / method references",
    summary: "`.name` reads a field, but `name` is a method — use `$name`.",
  },
  {
    code: METHOD_VAL_NOT_DEFINED,
    level: "error",
    group: "Field / method references",
    summary: "`$method` references a method not declared in `methods`.",
  },
  {
    code: METHOD_VAL_IS_FIELD,
    level: "error",
    group: "Field / method references",
    summary: "`$name` calls a method, but `name` is a field — use `.name`.",
  },

  // Input-handler / method confusion
  {
    code: INPUT_HANDLER_NOT_IMPLEMENTED,
    level: "error",
    group: "Input-handler / method confusion",
    summary: "Bare handler name has no entry in `input`.",
  },
  {
    code: INPUT_HANDLER_METHOD_NOT_IMPLEMENTED,
    level: "error",
    group: "Input-handler / method confusion",
    summary: "`$handler` has no entry in `methods`.",
  },
  {
    code: INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD,
    level: "hint",
    group: "Input-handler / method confusion",
    summary: "`$name` is a method reference, but `name` is an input handler — drop the `$`.",
  },
  {
    code: INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER,
    level: "hint",
    group: "Input-handler / method confusion",
    summary: "Bare `name` is an input-handler reference, but `name` is a method — add `$`.",
  },
  {
    code: INPUT_HANDLER_NOT_REFERENCED,
    level: "hint",
    group: "Input-handler / method confusion",
    summary: "`input` entry is defined but never wired to an `@on.*` event.",
  },

  // Iteration helpers (`alter`)
  {
    code: ALT_HANDLER_NOT_DEFINED,
    level: "error",
    group: "Iteration helpers (`alter`)",
    summary: "`@when` / `@enrich-with` / `@loop-with` names a handler not in `alter`.",
  },
  {
    code: ALT_HANDLER_NOT_REFERENCED,
    level: "hint",
    group: "Iteration helpers (`alter`)",
    summary: "`alter` entry is defined but never used.",
  },

  // Dynamic bindings
  {
    code: DYN_VAL_NOT_DEFINED,
    level: "error",
    group: "Dynamic bindings",
    summary: "`*name` references a dynamic binding not declared in `dynamic`.",
  },
  {
    code: DYN_ALIAS_NOT_REFERENCED,
    level: "hint",
    group: "Dynamic bindings",
    summary: "`dynamic` alias is defined but never read as `*name` in a view.",
  },

  // Templates / events
  {
    code: RENDER_IT_OUTSIDE_OF_LOOP,
    level: "error",
    group: "Templates / events",
    summary: "`<x render-it>` used outside `@each` / `render-each`.",
  },
  {
    code: UNKNOWN_EVENT_MODIFIER,
    level: "error",
    group: "Templates / events",
    summary: "`@on.<event>+<mod>` uses a modifier not in the recognized set.",
  },
  {
    code: UNKNOWN_HANDLER_ARG_NAME,
    level: "error",
    group: "Templates / events",
    summary: "Handler argument name is not a built-in or a declared component.",
  },
  {
    code: DUPLICATE_ATTR_DEFINITION,
    level: "error",
    group: "Templates / events",
    summary: "Same attribute set more than once (literal + `:attr` + `@if.attr`).",
  },
  {
    code: IF_NO_BRANCH_SET,
    level: "error",
    group: "Templates / events",
    summary: "`@if.<attr>` has no `@then` or `@else` branch.",
  },
  {
    code: UNKNOWN_DIRECTIVE,
    level: "error",
    group: "Templates / events",
    summary: "`@directive` name is not recognized (typo or unsupported).",
  },
  {
    code: UNKNOWN_X_OP,
    level: "error",
    group: "Templates / events",
    summary: "First attribute on `<x>` (or pseudo-`@x`) is not a known op.",
  },
  {
    code: UNKNOWN_X_ATTR,
    level: "error",
    group: "Templates / events",
    summary: "Extra attribute on `<x op>` not consumed by the op and not a known wrapper.",
  },
  {
    code: MAYBE_DROP_AT_PREFIX,
    level: "hint",
    group: "Templates / events",
    summary: "An `<x>` op/attr was written with a leading `@` like a directive.",
  },

  // Value expressions
  {
    code: BAD_VALUE,
    level: "error",
    group: "Value expressions",
    summary: "A value expression could not be parsed.",
  },
  {
    code: UNSUPPORTED_EXPR_SYNTAX,
    level: "error",
    group: "Value expressions",
    summary:
      "Value uses JS-style syntax (ternary, comparison, logical, call-with-args) tutuca does not support — move the logic into a method.",
  },
  {
    code: REDUNDANT_TEMPLATE_STRING,
    level: "warn",
    group: "Value expressions",
    summary: "`$'{expr}'` wraps a single expression — use the expression directly.",
  },
  {
    code: PLACEHOLDERLESS_TEMPLATE_STRING,
    level: "hint",
    group: "Value expressions",
    summary: "`$'…'` template has no `{}` placeholder — use a plain string literal.",
  },

  // Names registered with the app
  {
    code: UNKNOWN_REQUEST_NAME,
    level: "error",
    group: "Names registered with the app",
    summary: "`!name` references a request handler not registered with the app.",
  },
  {
    code: UNKNOWN_COMPONENT_NAME,
    level: "error",
    group: "Names registered with the app",
    summary: "A component type referenced in a template is not registered.",
  },
  {
    code: UNKNOWN_MACRO_ARG,
    level: "error",
    group: "Names registered with the app",
    summary: "A macro call passes an attribute not declared in the macro's defaults.",
  },

  // Component spec
  {
    code: UNKNOWN_COMPONENT_SPEC_KEY,
    level: "warn",
    group: "Component spec",
    summary: "`component({...})` has an unrecognized key; its value is ignored at runtime.",
  },

  // Component field declarations
  {
    code: COMP_FIELD_BAD_SHAPE,
    level: "error",
    group: "Component field declarations",
    summary:
      "`fields: { x: { component, args } }` shape is wrong: `component` must be a string and `args` must be a plain object.",
  },
];

/** Lint codes grouped by their `group` field, preserving table order. */
export function lintRulesByGroup() {
  /** @type {Map<string, LintRule[]>} */
  const groups = new Map();
  for (const rule of LINT_RULES) {
    const list = groups.get(rule.group) ?? [];
    list.push(rule);
    groups.set(rule.group, list);
  }
  return groups;
}
