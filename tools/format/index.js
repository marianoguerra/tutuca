import * as cli from "./cli.js";
import * as html from "./html.js";
import * as json from "./json.js";
import * as md from "./md.js";

const FORMATTERS = { cli, md, json, html };

function pickFormatter(name) {
  const f = FORMATTERS[name];
  if (!f) {
    const err = new Error(
      `Unknown format '${name}'. Valid formats: ${Object.keys(FORMATTERS).join(", ")}`,
    );
    err.code = "ERR_FORMAT_UNKNOWN";
    err.formatName = name;
    err.validFormats = Object.keys(FORMATTERS);
    throw err;
  }
  return f;
}

function formattersSupporting(kind) {
  return Object.entries(FORMATTERS)
    .filter(([, f]) => f.supports?.has(kind))
    .map(([name]) => name);
}

export async function formatResult(formatName, result, options = {}) {
  const f = pickFormatter(formatName);
  const kind = result.constructor.name;
  if (!f.supports?.has(kind)) {
    const supported = formattersSupporting(kind);
    const supportedTail = supported.length ? ` Use one of: ${supported.join(", ")}.` : "";
    const err = new Error(`Format '${formatName}' does not support ${kind}.${supportedTail}`);
    err.code = "ERR_FORMAT_UNSUPPORTED";
    err.formatName = formatName;
    err.resultKind = kind;
    err.supportedFormats = supported;
    throw err;
  }
  return await f.format(result, options);
}
