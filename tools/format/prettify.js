// Build the HTML prettifier used by the md and html RenderBatch formatters.
// Lazily imports prettier only when --pretty was requested; the returned
// function falls back to the raw input when prettier fails to parse it.
export async function makeHtmlPrettifier(pretty) {
  if (!pretty) return (html) => html;
  const { format } = await import("prettier");
  return async (html) => {
    try {
      return (await format(html, { parser: "html" })).trimEnd();
    } catch {
      return html;
    }
  };
}
