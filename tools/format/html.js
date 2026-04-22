export const supports = new Set(["RenderBatch"]);

export async function format(result, { pretty = false } = {}) {
  const prettify = pretty ? (await import("prettier")).format : null;
  const parts = [];
  for (const item of result.items) {
    if (item.error) {
      parts.push(`<!-- ERROR ${item.title}: ${item.error.message} -->`);
      continue;
    }
    let html = item.html;
    if (prettify) {
      try {
        html = (await prettify(html, { parser: "html" })).trimEnd();
      } catch {}
    }
    parts.push(`<!-- ${item.title} -->`);
    parts.push(html);
  }
  return parts.join("\n");
}
