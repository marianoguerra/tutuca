import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { JSDOM } from "jsdom";
import { renderToHTML } from "../src/util/render.js";
import { HeadlessParseContext } from "../test/dom.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    format: { type: "string", short: "f", default: "md" },
    pretty: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const modulePath = positionals[0];
if (!modulePath) {
  console.error(
    "Usage: bun tools/render-examples.js [--format md|json] [--pretty] <module-path>",
  );
  process.exit(1);
}

if (values.format !== "md" && values.format !== "json") {
  console.error(`Unknown format: ${values.format}. Supported: md, json`);
  process.exit(1);
}

const mod = await import(resolve(modulePath));
const examples = mod.getExamples();

const { document } = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>")
  .window;
globalThis.document = document;

const prettify = values.pretty ? (await import("prettier")).format : null;

const results = [];
for (const example of examples) {
  let html = renderToHTML(
    document,
    mod.getComponents(),
    mod.getMacros?.() ?? null,
    example.value,
    HeadlessParseContext,
  );
  if (prettify) {
    html = (await prettify(html, { parser: "html" })).trimEnd();
  }
  results.push({ title: example.title, html });
}

if (values.format === "json") {
  console.log(JSON.stringify(results, null, 2));
} else {
  const lines = [];
  for (const { title, html } of results) {
    lines.push(`# ${title}\n`);
    lines.push("```html");
    lines.push(html);
    lines.push("```\n");
  }
  console.log(lines.join("\n"));
}
