import * as cli from "./cli.js";
import * as md from "./md.js";
import * as json from "./json.js";
import * as html from "./html.js";

const FORMATTERS = { cli, md, json, html };

export function pickFormatter(name) {
  const f = FORMATTERS[name];
  if (!f) {
    throw new Error(
      `Unknown format: ${name}. Available: ${Object.keys(FORMATTERS).join(", ")}`,
    );
  }
  return f;
}

export async function formatResult(formatName, result, options = {}) {
  const f = pickFormatter(formatName);
  const kind = result.constructor.name;
  if (!f.supports || !f.supports.has(kind)) {
    throw new Error(`Formatter "${formatName}" does not support ${kind}`);
  }
  return await f.format(result, options);
}
