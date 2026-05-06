const UNSUPPORTED_EXPR_LABEL = {
  ternary: "ternary expression",
  comparison: "comparison",
  logical: "logical expression",
  "call-with-args": "method call with arguments",
};

function unsupportedExprMessage(info) {
  const v = JSON.stringify(info.value);
  const label = UNSUPPORTED_EXPR_LABEL[info.detected] ?? "expression";
  switch (info.role) {
    case "attr":
      return `Unsupported ${label} ${v} in dynamic attribute ':${info.attr}'`;
    case "directive":
      return `Unsupported ${label} ${v} in directive '@${info.directive}'`;
    case "if":
      return `Unsupported ${label} ${v} in '@if.${info.attr}' condition`;
    case "x-op":
      return `Unsupported ${label} ${v} in <x ${info.op}>`;
    default:
      return `Unsupported ${label} ${v}`;
  }
}

function badValueMessage(info) {
  const v = JSON.stringify(info.value);
  switch (info.role) {
    case "attr":
      return `Cannot parse value ${v} for attribute ':${info.attr}'`;
    case "directive":
      return `Cannot parse value ${v} for directive '@${info.directive}'`;
    case "if":
      return `Cannot parse condition ${v} for '@if.${info.attr}'`;
    case "x-op":
      return `Cannot parse value ${v} for <x ${info.op}>`;
    case "handler-name":
      return `Cannot parse handler name ${v}`;
    case "handler-arg":
      return `Cannot parse handler argument ${v}`;
    case "macro-var":
      return `Macro variable '^${info.name}' is not defined`;
    default:
      return `Cannot parse value ${v}`;
  }
}

function tagDisplay(tag) {
  return tag ? String(tag).toLowerCase() : null;
}

function fmtTagSuffix(info) {
  const t = tagDisplay(info?.tag);
  return t && t !== "x" ? ` on <${t}>` : "";
}

function fmtOriginSuffix(info) {
  if (!info) return "";
  const parts = [];
  if (info.originAttr) {
    const branch = info.branch ? `[${info.branch}]` : "";
    parts.push(`in ${info.originAttr}${branch}`);
  }
  if (info.handlerName) {
    parts.push(
      `handler '${info.handlerName}'${info.argIndex !== undefined ? ` arg ${info.argIndex}` : ""}`,
    );
  }
  const t = tagDisplay(info.tag);
  if (t && t !== "x") parts.push(`on <${t}>`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function fmtEventSuffix(info) {
  if (info?.originAttr) return ` in ${info.originAttr}`;
  if (info?.eventName) return ` in @on.${info.eventName}`;
  return "";
}

export function lintIdToMessage(id, info) {
  switch (id) {
    case "RENDER_IT_OUTSIDE_OF_LOOP":
      return "<x render-it> used outside of a loop";
    case "UNKNOWN_EVENT_MODIFIER": {
      const mods = info.handler?.modifiers ?? [info.modifier];
      const written = `@on.${info.name}+${mods.join("+")}`;
      return `Unknown modifier '+${info.modifier}' in '${written}'`;
    }
    case "UNKNOWN_HANDLER_ARG_NAME":
      return `Unknown handler argument '${info.name}'${fmtOriginSuffix(info)}`;
    case "INPUT_HANDLER_NOT_IMPLEMENTED":
      return `Input handler '${info.name}' is not implemented${fmtEventSuffix(info)}`;
    case "INPUT_HANDLER_NOT_REFERENCED":
      return `Input handler '${info.name}' is defined but never used — remove it or wire it to an @on.* event`;
    case "INPUT_HANDLER_METHOD_NOT_IMPLEMENTED":
      return `Method '.${info.name}' is not implemented${fmtEventSuffix(info)}`;
    case "INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD":
      return `'.${info.name}' is a method reference, but '${info.name}' is defined as an input handler${fmtEventSuffix(info)}`;
    case "INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER":
      return `'${info.name}' is an input handler reference, but '${info.name}' is defined as a method${fmtEventSuffix(info)}`;
    case "FIELD_VAL_NOT_DEFINED":
      return `Field '.${info.name}' is not defined${fmtOriginSuffix(info)}`;
    case "DUPLICATE_ATTR_DEFINITION": {
      const sources = info.sources?.length ? ` (${info.sources.join(", ")})` : "";
      const tag = info.tag ? ` on <${String(info.tag).toLowerCase()}>` : "";
      return `Attribute '${info.name}' is set ${info.sources?.length ?? "multiple"} times${sources}${tag}`;
    }
    case "IF_NO_BRANCH_SET":
      return `'@if.${info.attr}' has no '@then' or '@else' branch — add '@then="…"' or '@else="…"' (or both)${fmtTagSuffix(info)}`;
    case "UNKNOWN_REQUEST_NAME":
      return `Unknown request '!${info.name}'${fmtOriginSuffix(info)}`;
    case "UNKNOWN_COMPONENT_NAME":
      return `Unknown component '${info.name}'${fmtOriginSuffix(info)}`;
    case "ALT_HANDLER_NOT_DEFINED":
      return `Alter handler '${info.name}' is not defined${fmtOriginSuffix(info)}`;
    case "ALT_HANDLER_NOT_REFERENCED":
      return `Alter handler '${info.name}' is defined but never used — remove it or reference it from @when, @enrich-with, or @loop-with`;
    case "UNKNOWN_MACRO_ARG":
      return `Argument '${info.name}' is not declared in macro '${info.macroName}'`;
    case "UNKNOWN_DIRECTIVE":
      return `Unknown directive '@${info.name}=${JSON.stringify(info.value)}'${fmtTagSuffix(info)}`;
    case "UNKNOWN_X_OP":
      return `Unknown <x> op '${info.name}=${JSON.stringify(info.value)}'${fmtTagSuffix(info)}`;
    case "UNKNOWN_X_ATTR":
      return `Unknown attribute '${info.name}=${JSON.stringify(info.value)}' on <x ${info.op}>${fmtTagSuffix(info)}`;
    case "MAYBE_DROP_AT_PREFIX": {
      const written =
        info.value !== undefined ? `${info.name}=${JSON.stringify(info.value)}` : info.name;
      return `'${written}' on <x> looks like a directive but is actually an x op/attr written with a leading '@'`;
    }
    case "BAD_VALUE":
      return `${badValueMessage(info)}${fmtTagSuffix(info)}`;
    case "UNSUPPORTED_EXPR_SYNTAX":
      return `${unsupportedExprMessage(info)}${fmtTagSuffix(info)}`;
    case "REDUNDANT_TEMPLATE_STRING":
      return `Redundant template string — '{${info.simpler}}' should be just '${info.simpler}'${fmtOriginSuffix(info)}`;
    case "UNKNOWN_COMPONENT_SPEC_KEY":
      return `Unknown component spec key '${info.key}' — value will be ignored at runtime`;
    case "HTML_TAG_NAME_HAS_UPPERCASE":
      return `Tag <${info.raw}> will be lowercased to <${info.lowercased}>${fmtLocationSuffix(info)}`;
    case "HTML_SVG_TAG_WILL_LOWERCASE":
      return `SVG tag <${info.raw}> is not in the WHATWG case-correction list — will be lowercased to <${info.lowercased}>${fmtLocationSuffix(info)}`;
    case "HTML_TAG_NOT_ALLOWED_IN_PARENT":
      return `<${info.tag}> not allowed under <${info.parent ?? "?"}> in ${info.mode} — ${htmlActionPhrase(info.action, info.tag, info.parent)}${fmtLocationSuffix(info)}`;
    case "HTML_TEXT_NOT_ALLOWED_IN_PARENT":
      return `Non-whitespace text not allowed in ${info.mode}: ${JSON.stringify(info.snippet)}${fmtLocationSuffix(info)}`;
    case "HTML_VOID_ELEMENT_HAS_CLOSE_TAG":
      return `Void element <${info.tag}> has an explicit close tag${fmtLocationSuffix(info)}`;
    case "HTML_DUPLICATE_FORM":
      return `Nested <form> — the inner form will be dropped by the parser${fmtLocationSuffix(info)}`;
    case "HTML_NESTED_INTERACTIVE":
      return `<${info.tag}> nested inside another <${info.tag}> — adoption agency will reorder${fmtLocationSuffix(info)}`;
    case "HTML_MISNESTED_FORMATTING":
      return `Misnested formatting tag </${info.tag}> — adoption agency will reorder nodes${fmtLocationSuffix(info)}`;
    case "HTML_UNEXPECTED_END_TAG":
      return `Unexpected end tag </${info.tag}>${fmtLocationSuffix(info)}`;
    case "HTML_UNCLOSED_BEFORE_END":
      return `<${info.unclosed}> still open when </${info.tag}> was seen — implicitly closed${fmtLocationSuffix(info)}`;
    case "HTML_DUPLICATE_ATTRIBUTE":
      return `Duplicate attribute '${info.name}' — second occurrence dropped${fmtLocationSuffix(info)}`;
    case "HTML_ATTRIBUTES_ON_END_TAG":
      return `Attributes on end tag </${info.tag}> — dropped by the parser${fmtLocationSuffix(info)}`;
    case "HTML_SELF_CLOSING_END_TAG":
      return `Self-closing end tag </${info.tag}/> — trailing '/' is meaningless${fmtLocationSuffix(info)}`;
    case "HTML_MISSING_ATTRIBUTE_VALUE":
      return `Attribute '${info.name}' is missing a value${fmtLocationSuffix(info)}`;
    case "HTML_CDATA_IN_HTML_NAMESPACE":
      return `CDATA section in HTML namespace — reinterpreted as a bogus comment${fmtLocationSuffix(info)}`;
    case "HTML_BOGUS_COMMENT":
      return `Bogus comment — content dropped by the parser${fmtLocationSuffix(info)}`;
    case "HTML_SVG_ATTR_WILL_LOWERCASE":
      return `SVG attribute '${info.raw}' will be rewritten to '${info.canonical}'${fmtLocationSuffix(info)}`;
    case "HTML_MATHML_ATTR_WILL_LOWERCASE":
      return `MathML attribute '${info.raw}' will be rewritten to '${info.canonical}'${fmtLocationSuffix(info)}`;
    case "LINT_ERROR":
      return info.message;
    default:
      return id;
  }
}

// Render a structured suggestion as a one-line tail. Returns null if the
// suggestion is missing or has no human-readable form for its kind. Callers
// concatenate this onto the message with " — " when non-null.
export function suggestionToMessage(suggestion) {
  if (!suggestion) return null;
  switch (suggestion.kind) {
    case "replace-name":
      return `did you mean '${suggestion.to}'?`;
    case "drop-prefix":
      return `did you mean '${suggestion.to}'? (drop the leading '${suggestion.from.slice(0, suggestion.from.length - suggestion.to.length)}')`;
    case "add-prefix":
      return `did you mean '${suggestion.to}'? (add the leading '${suggestion.to.slice(0, suggestion.to.length - suggestion.from.length)}')`;
    case "remove":
      return `remove ${suggestion.what}`;
    case "rewrite":
      return `use '${suggestion.to}' instead of '${suggestion.from}'`;
    case "wrap":
      return `wrap it in ${suggestion.to}`;
    case "rephrase":
      return suggestion.text ?? null;
    default:
      return null;
  }
}

function fmtLocationSuffix(info) {
  const loc = info?.location;
  if (!loc) return "";
  return ` at line ${loc.line}, col ${loc.column}`;
}

function htmlActionPhrase(action, tag, parent) {
  switch (action) {
    case "ignored":
      return `the parser will drop this <${tag}>`;
    case "drop":
      return `the parser will drop this <${tag}>`;
    case "auto-close-implicit":
      return `the parser will close <${parent ?? "?"}> first, then place <${tag}> as a sibling`;
    case "foster-parent":
      return `the parser will move <${tag}> outside <${parent ?? "?"}> (foster-parenting)`;
    case "foreign-breakout":
      return `the parser will exit foreign content and re-process <${tag}> in HTML mode`;
    default:
      return `parser action: ${action}`;
  }
}
