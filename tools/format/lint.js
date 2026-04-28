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

export function lintIdToMessage(id, info) {
  switch (id) {
    case "RENDER_IT_OUTSIDE_OF_LOOP":
      return "render-it used outside of a loop";
    case "UNKNOWN_EVENT_MODIFIER":
      return `Unknown modifier '${info.modifier}' on '${info.name}' event`;
    case "UNKNOWN_HANDLER_ARG_NAME":
      return `Unknown handler argument '${info.name}'`;
    case "INPUT_HANDLER_NOT_IMPLEMENTED":
      return `Input handler '${info.name}' is not implemented`;
    case "INPUT_HANDLER_NOT_REFERENCED":
      return `Input handler '${info.name}' is defined but not referenced`;
    case "INPUT_HANDLER_METHOD_NOT_IMPLEMENTED":
      return `Method '.${info.name}' is not implemented`;
    case "INPUT_HANDLER_FOR_INPUT_HANDLER_METHOD":
      return `'${info.name}' exists as input handler — use without '.' prefix`;
    case "INPUT_HANDLER_METHOD_FOR_INPUT_HANDLER":
      return `'${info.name}' exists as method — use with '.' prefix`;
    case "FIELD_VAL_NOT_DEFINED":
      return `Field '.${info.name}' is not defined`;
    case "COMPUTED_VAL_NOT_DEFINED":
      return `Computed property '$${info.name}' is not defined`;
    case "COMPUTED_NOT_REFERENCED":
      return `Computed property '$${info.name}' is defined but not referenced`;
    case "DUPLICATE_ATTR_DEFINITION":
      return `Attribute '${info.name}' is defined more than once`;
    case "IF_NO_BRANCH_SET":
      return `'@if.${info.attr}' has no '@then' or '@else' branch — at least one must be set`;
    case "UNKNOWN_REQUEST_NAME":
      return `Unknown request '!${info.name}'`;
    case "UNKNOWN_COMPONENT_NAME":
      return `Unknown component '${info.name}'`;
    case "ALT_HANDLER_NOT_DEFINED":
      return `Alter handler '${info.name}' is not defined`;
    case "ALT_HANDLER_NOT_REFERENCED":
      return `Alter handler '${info.name}' is defined but not referenced`;
    case "UNKNOWN_MACRO_ARG":
      return `Argument '${info.name}' is not declared in macro '${info.macroName}'`;
    case "UNKNOWN_DIRECTIVE":
      return `Unknown directive '@${info.name}=${JSON.stringify(info.value)}'`;
    case "UNKNOWN_X_OP":
      return `Unknown <x> op '${info.name}=${JSON.stringify(info.value)}'`;
    case "UNKNOWN_X_ATTR":
      return `Unknown attribute '${info.name}=${JSON.stringify(info.value)}' on <x ${info.op}>`;
    case "MAYBE_DROP_AT_PREFIX":
      return `Did you mean '${info.suggestion}'? Drop the '@' prefix on <x>.`;
    case "BAD_VALUE":
      return badValueMessage(info);
    case "LINT_ERROR":
      return info.message;
    default:
      return id;
  }
}
