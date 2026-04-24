import { makeFormatter } from "./_dispatch.js";

function fmtComponentDocs(docs) {
  const lines = [];
  for (const comp of docs.items) {
    lines.push(`# ${comp.name}\n`);

    if (comp.methods.length > 0) {
      lines.push("## Methods\n");
      for (const m of comp.methods) {
        lines.push(`- \`${m.sig}\``);
      }
      lines.push("");
    }

    if (comp.input.length > 0) {
      lines.push("## Input Handlers\n");
      for (const m of comp.input) {
        lines.push(`- \`${m.sig}\``);
      }
      lines.push("");
    }

    for (const field of comp.fields) {
      lines.push(
        `## Field: \`${field.name}\` (${field.type}, default: \`${JSON.stringify(field.default)}\`)\n`,
      );
      for (const m of field.methods) {
        lines.push(`- \`${m.sig}\` — ${m.desc}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function fmtRenderBatch(batch, { pretty = false } = {}) {
  const prettify = pretty ? (await import("prettier")).format : null;
  const lines = [];
  for (const section of batch.sections) {
    lines.push(`# ${section.title}`);
    if (section.description) lines.push(`\n${section.description}`);
    lines.push("");
    for (const item of section.items) {
      lines.push(`## ${item.title}\n`);
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
  }
  return lines.join("\n");
}

function fmtExampleIndex(idx) {
  if (idx.sections.length === 0) return "_(no examples)_";
  const lines = [];
  for (const s of idx.sections) {
    lines.push(`# ${s.title}`);
    if (s.description) lines.push("", s.description);
    if (s.items.length) {
      lines.push("");
      for (const item of s.items) {
        lines.push(
          `- **${item.title}** — \`${item.componentName}\`${item.description ? ` — ${item.description}` : ""}`,
        );
      }
    }
    lines.push("");
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
      const view = f.context?.viewName ? ` — view: \`${f.context.viewName}\`` : "";
      lines.push(`- **${f.level.toUpperCase()}** \`${f.id}\`${view}`);
    }
    lines.push("");
  }
  lines.push(`**Total:** ${rep.totalErrors} error(s), ${rep.totalWarnings} warning(s)`);
  return lines.join("\n");
}

function fmtModuleInfo(info) {
  const lines = [`# Module: ${info.path ?? "<in-memory>"}`, ""];
  lines.push(
    `- Exports: ${[...info.present].map((k) => `\`${k}\``).join(", ") || "(none)"}`,
  );
  lines.push(`- Components: ${info.counts.components}`);
  lines.push(`- Macros: ${info.counts.macros}`);
  lines.push(`- Request handlers: ${info.counts.requestHandlers}`);
  lines.push(
    `- Examples: ${info.counts.examples} (sections: ${info.counts.sections})`,
  );
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
    if (c.views.length)
      lines.push(`Views: ${c.views.map((v) => `\`${v}\``).join(", ")}`, "");
    if (c.fields.length) {
      lines.push("Fields:", "");
      for (const f of c.fields) lines.push(`- \`${f.name}\` (${f.type})`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export const { supports, format } = makeFormatter("md", {
  ComponentDocs: fmtComponentDocs,
  RenderBatch: fmtRenderBatch,
  ExampleIndex: fmtExampleIndex,
  LintReport: fmtLintReport,
  ModuleInfo: fmtModuleInfo,
  ComponentList: fmtComponentList,
});
