export const supports = new Set([
  "ModuleInfo",
  "ComponentList",
  "ExampleIndex",
  "ComponentDocs",
  "LintReport",
  "RenderBatch",
  "DoctorReport",
]);

function fmtModuleInfo(info) {
  const lines = [];
  lines.push(`Module: ${info.path ?? "<in-memory>"}`);
  lines.push(`Exports: ${[...info.present].join(", ") || "(none)"}`);
  lines.push(`Components: ${info.counts.components}`);
  lines.push(`Macros: ${info.counts.macros}`);
  lines.push(`Request handlers: ${info.counts.requestHandlers}`);
  lines.push(
    `Examples: ${info.counts.examples} (sections: ${info.counts.sections})`,
  );
  if (info.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of info.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}

function fmtComponentList(list) {
  if (list.items.length === 0) return "(no components)";
  const lines = [];
  for (const c of list.items) {
    const views = c.views.length ? ` [views: ${c.views.join(", ")}]` : "";
    lines.push(`${c.name}${views}`);
    for (const f of c.fields) lines.push(`  - ${f.name}: ${f.type}`);
  }
  return lines.join("\n");
}

function fmtExampleIndex(idx) {
  if (idx.sections.length === 0) return "(no examples)";
  const lines = [];
  for (const s of idx.sections) {
    lines.push(`${s.title}${s.description ? ` — ${s.description}` : ""}`);
    for (const item of s.items) {
      lines.push(
        `  - ${item.title}${item.description ? ` — ${item.description}` : ""} [${item.componentName}${item.view !== "main" ? `/${item.view}` : ""}]`,
      );
    }
  }
  return lines.join("\n");
}

function fmtComponentDocs(docs) {
  if (docs.items.length === 0) return "(no components)";
  const lines = [];
  for (const c of docs.items) {
    lines.push(c.name);
    if (c.methods.length) {
      lines.push("  methods:");
      for (const m of c.methods) lines.push(`    ${m.sig}`);
    }
    if (c.input.length) {
      lines.push("  input:");
      for (const m of c.input) lines.push(`    ${m.sig}`);
    }
    if (c.fields.length) {
      lines.push("  fields:");
      for (const f of c.fields)
        lines.push(`    ${f.name}: ${f.type} = ${JSON.stringify(f.default)}`);
    }
  }
  return lines.join("\n");
}

function fmtFindingInfo(info) {
  const keys = ["name", "modifier", "id"];
  const parts = [];
  for (const k of keys) {
    if (info?.[k] !== undefined) parts.push(`${k}=${info[k]}`);
  }
  return parts.join(" ");
}

function fmtLintReport(rep) {
  if (rep.components.length === 0) return "(no components)";
  const lines = [];
  for (const c of rep.components) {
    if (c.findings.length === 0) {
      lines.push(`${c.componentName}: ok`);
      continue;
    }
    lines.push(`${c.componentName}:`);
    for (const f of c.findings) {
      const tag = f.level.toUpperCase();
      const view = f.context?.viewName ? ` view=${f.context.viewName}` : "";
      const extra = fmtFindingInfo(f.info);
      lines.push(`  [${tag}] ${f.id}${view}${extra ? ` (${extra})` : ""}`);
    }
  }
  lines.push("");
  lines.push(`Total: ${rep.totalErrors} error(s), ${rep.totalWarnings} warning(s)`);
  return lines.join("\n");
}

function fmtRenderBatch(batch) {
  const totalItems = batch.sections.reduce((n, s) => n + s.items.length, 0);
  if (totalItems === 0) return "(no examples rendered)";
  const lines = [];
  for (const section of batch.sections) {
    lines.push(
      `${section.title}${section.description ? ` — ${section.description}` : ""}`,
    );
    for (const item of section.items) {
      const status = item.error
        ? `ERROR: ${item.error.message}`
        : `${item.html.length} bytes`;
      lines.push(`  ${item.title} [${item.componentName}] — ${status}`);
    }
  }
  return lines.join("\n");
}

function fmtDoctor(rep) {
  const lines = [];
  lines.push("== lint ==");
  lines.push(fmtLintReport(rep.lint));
  lines.push("");
  lines.push("== renders ==");
  lines.push(fmtRenderBatch(rep.renders));
  lines.push("");
  lines.push(`Result: ${rep.ok ? "OK" : "FAIL"}`);
  return lines.join("\n");
}

const DISPATCH = {
  ModuleInfo: fmtModuleInfo,
  ComponentList: fmtComponentList,
  ExampleIndex: fmtExampleIndex,
  ComponentDocs: fmtComponentDocs,
  LintReport: fmtLintReport,
  RenderBatch: fmtRenderBatch,
  DoctorReport: fmtDoctor,
};

export function format(result) {
  const fn = DISPATCH[result.constructor.name];
  if (!fn)
    throw new Error(`cli formatter missing dispatch for ${result.constructor.name}`);
  return fn(result);
}
