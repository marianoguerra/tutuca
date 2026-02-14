import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { getComponentsDocs, docsToMarkdown } from "../src/util/docs.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    format: { type: "string", short: "f", default: "md" },
  },
  allowPositionals: true,
});

const modulePath = positionals[0];
if (!modulePath) {
  console.error(
    "Usage: bun tools/component-api-docs.js [--format md|json] <module-path>",
  );
  process.exit(1);
}

if (values.format !== "md" && values.format !== "json") {
  console.error(`Unknown format: ${values.format}. Supported: md, json`);
  process.exit(1);
}

const mod = await import(resolve(modulePath));
const docs = getComponentsDocs(mod.getComponents());

if (values.format === "json") {
  console.log(JSON.stringify(docs, null, 2));
} else {
  console.log(docsToMarkdown(docs));
}
