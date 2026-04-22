import { docsToMarkdown } from "../../src/util/docs.js";

export const supports = new Set([
  "ComponentDocs",
  "RenderBatch",
  "ExampleIndex",
  "LintReport",
  "ModuleInfo",
  "ComponentList",
]);

function fmtComponentDocs(docs) {
  return docsToMarkdown(docs.items);
}

async function fmtRenderBatch(batch, { pretty = false } = {}) {
  const prettify = pretty ? (await import("prettier")).format : null;
  const lines = [];
  if (batch.section) {
    lines.push(`# ${batch.section.title}`);
    if (batch.section.description) lines.push(`\n${batch.section.description}`);
    lines.push("");
  }
  let currentGroup = undefined;
  for (const item of batch.items) {
    if (item.groupTitle !== currentGroup) {
      currentGroup = item.groupTitle;
      if (currentGroup) lines.push(`## ${currentGroup}\n`);
    }
    const depth = currentGroup ? "###" : "##";
    lines.push(`${depth} ${item.title}\n`);
    if (item.description) lines.push(`${item.description}\n`);
    if (item.error) {
      lines.push("```");
      lines.push(`ERROR: ${item.error.message}`);
      lines.push("```\n");
      continue;
    }
    let html = item.html;
    if (prettify) {
      try {
        html = (await prettify(html, { parser: "html" })).trimEnd();
      } catch {
        // fall back to raw html
      }
    }
    lines.push("```html");
    lines.push(html);
    lines.push("```\n");
  }
  return lines.join("\n");
}

function fmtExampleIndex(idx) {
  if (!idx.section) return "_(no examples)_";
  const s = idx.section;
  const lines = [`# ${s.title}`];
  if (s.description) lines.push("", s.description);
  if (s.items.length) {
    lines.push("");
    for (const item of s.items) {
      lines.push(`- **${item.title}** — \`${item.componentName}\`${item.description ? ` — ${item.description}` : ""}`);
    }
  }
  for (const group of s.groups) {
    lines.push("", `## ${group.title}`);
    if (group.description) lines.push("", group.description);
    lines.push("");
    for (const item of group.items) {
      lines.push(`- **${item.title}** — \`${item.componentName}\`${item.description ? ` — ${item.description}` : ""}`);
    }
  }
  return lines.join("\n");
}

function fmtLintReport(rep) {
  const lines = ["# Lint report", ""];
  for (const c of rep.components) {
    lines.push(`## ${c.componentName}`, "");
    if (c.findings.length === 0) {
      lines.push("_ok_", "");
      continue;
    }
    for (const f of c.findings) {
      lines.push(`- **${f.level.toUpperCase()}** \`${f.id}\``);
    }
    lines.push("");
  }
  lines.push(`**Total:** ${rep.totalErrors} error(s), ${rep.totalWarnings} warning(s)`);
  return lines.join("\n");
}

function fmtModuleInfo(info) {
  const lines = [`# Module: ${info.path ?? "<in-memory>"}`, ""];
  lines.push(`- Exports: ${[...info.present].map((k) => `\`${k}\``).join(", ") || "(none)"}`);
  lines.push(`- Components: ${info.counts.components}`);
  lines.push(`- Macros: ${info.counts.macros}`);
  lines.push(`- Request handlers: ${info.counts.requestHandlers}`);
  lines.push(`- Examples: ${info.counts.examples} (groups: ${info.counts.groups})`);
  if (info.warnings.length) {
    lines.push("", "## Warnings", "");
    for (const w of info.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}

function fmtComponentList(list) {
  if (list.items.length === 0) return "_(no components)_";
  const lines = ["# Components", ""];
  for (const c of list.items) {
    lines.push(`## ${c.name}`, "");
    if (c.views.length) lines.push(`Views: ${c.views.map((v) => `\`${v}\``).join(", ")}`, "");
    if (c.fields.length) {
      lines.push("Fields:", "");
      for (const f of c.fields) lines.push(`- \`${f.name}\` (${f.type})`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

const DISPATCH = {
  ComponentDocs: fmtComponentDocs,
  RenderBatch: fmtRenderBatch,
  ExampleIndex: fmtExampleIndex,
  LintReport: fmtLintReport,
  ModuleInfo: fmtModuleInfo,
  ComponentList: fmtComponentList,
};

export async function format(result, opts) {
  const fn = DISPATCH[result.constructor.name];
  if (!fn) throw new Error(`md formatter missing dispatch for ${result.constructor.name}`);
  return await fn(result, opts);
}
