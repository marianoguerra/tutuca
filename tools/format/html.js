import { makeFormatter } from "./_dispatch.js";
import { makeHtmlPrettifier } from "./prettify.js";

async function fmtRenderBatch(result, { pretty = false } = {}) {
  const prettify = await makeHtmlPrettifier(pretty);
  const parts = [];
  for (const section of result.sections) {
    parts.push(`<!-- === ${section.title} === -->`);
    for (const item of section.items) {
      if (item.error) {
        parts.push(`<!-- ERROR ${item.title}: ${item.error.message} -->`);
        continue;
      }
      parts.push(`<!-- ${item.title} -->`);
      parts.push(await prettify(item.html));
    }
  }
  return parts.join("\n");
}

export const { supports, format } = makeFormatter("html", {
  RenderBatch: fmtRenderBatch,
});
