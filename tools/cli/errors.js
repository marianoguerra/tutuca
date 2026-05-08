import { closestName } from "../core/util/closest-name.js";
import { suggestionToMessage } from "../format/lint.js";

export const CODES = {
  USAGE_UNKNOWN_COMMAND: "ERR_USAGE_UNKNOWN_COMMAND",
  USAGE_UNKNOWN_FLAG: "ERR_USAGE_UNKNOWN_FLAG",
  USAGE_BAD_FLAG_VALUE: "ERR_USAGE_BAD_FLAG_VALUE",
  USAGE_MISSING_MODULE: "ERR_USAGE_MISSING_MODULE",
  USAGE_MUTUALLY_EXCLUSIVE: "ERR_USAGE_MUTUALLY_EXCLUSIVE",
  USAGE_MISSING_ARGUMENT: "ERR_USAGE_MISSING_ARGUMENT",
  FORMAT_UNKNOWN: "ERR_FORMAT_UNKNOWN",
  FORMAT_UNSUPPORTED: "ERR_FORMAT_UNSUPPORTED",
  MODULE_LOAD_FAILED: "ERR_MODULE_LOAD_FAILED",
  MODULE_SHAPE_MISMATCH: "EXAMPLES_SHAPE_MISMATCH",
  SKILL_ASSETS_MISSING: "ERR_SKILL_ASSETS_MISSING",
  SKILL_TARGET_EXISTS: "ERR_SKILL_TARGET_EXISTS",
  INTERNAL: "ERR_INTERNAL",
};

function isJsonFormat(opts) {
  return opts?.format === "json";
}

// Render an error to stderr in the active format and exit.
// shape: { code, message, suggestion?, hint?, where?, exit? }
export function emitError(opts, shape) {
  const exit = shape.exit ?? 1;
  if (isJsonFormat(opts)) {
    const envelope = {
      error: {
        code: shape.code ?? CODES.INTERNAL,
        message: shape.message,
      },
    };
    if (shape.suggestion) envelope.error.suggestion = shape.suggestion;
    if (shape.hint) envelope.error.hint = shape.hint;
    if (shape.where) envelope.error.where = shape.where;
    process.stderr.write(`${JSON.stringify(envelope)}\n`);
  } else {
    const where = shape.where ? `[${shape.where}] ` : "";
    process.stderr.write(`tutuca: ${where}${shape.message}\n`);
    const tail = suggestionToMessage(shape.suggestion);
    if (tail) process.stderr.write(`  ${tail}\n`);
    if (shape.hint) process.stderr.write(`  hint: ${shape.hint}\n`);
  }
  process.exit(exit);
}

// Build a "did you mean" suggestion against a list of valid names.
// Returns null when nothing is close enough.
export function didYouMean(name, candidates) {
  const close = closestName(name, candidates);
  return close ? { kind: "replace-name", from: name, to: close } : null;
}

// Translate a node:util parseArgs error into our shape. Returns null
// if `err` isn't a recognizable parseArgs error.
// `validFlags` is the iterable of flag names (without leading "--") that
// would have been accepted in the current parsing context.
export function parseArgsErrorShape(err, validFlags) {
  if (!err?.code?.startsWith?.("ERR_PARSE_ARGS_")) return null;
  if (err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    // Message shape from node: "Unknown option '--foo'. To specify..."
    const m = err.message.match(/Unknown option '(-{1,2}[^']+)'/);
    const raw = m?.[1] ?? null;
    const stripped = raw?.replace(/^-+/, "");
    const candidates = [...(validFlags ?? [])];
    const close = stripped ? closestName(stripped, candidates) : null;
    return {
      code: CODES.USAGE_UNKNOWN_FLAG,
      message: raw ? `Unknown flag '${raw}'` : err.message,
      suggestion: close ? { kind: "replace-name", from: raw, to: `--${close}` } : null,
      hint: candidates.length ? `Valid flags: ${candidates.map((f) => `--${f}`).join(", ")}` : null,
    };
  }
  if (err.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
    return { code: CODES.USAGE_BAD_FLAG_VALUE, message: err.message };
  }
  // Generic parse-args fallback.
  return { code: err.code, message: err.message };
}
