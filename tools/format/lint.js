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
    case "UNKNOWN_REQUEST_NAME":
      return `Unknown request '!${info.name}'`;
    case "UNKNOWN_COMPONENT_NAME":
      return `Unknown component '${info.name}'`;
    case "ALT_HANDLER_NOT_DEFINED":
      return `Alter handler '${info.name}' is not defined`;
    case "ALT_HANDLER_NOT_REFERENCED":
      return `Alter handler '${info.name}' is defined but not referenced`;
    case "LINT_ERROR":
      return info.message;
    default:
      return id;
  }
}
