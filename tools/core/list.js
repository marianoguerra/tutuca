import { ComponentList, ComponentSummary, ExampleIndex } from "./results.js";

function summarize(comp) {
  const meta = comp.Class.getMetaClass();
  const fields = [];
  for (const fieldName in meta.fields) {
    const f = meta.fields[fieldName];
    fields.push({ name: fieldName, type: f.type });
  }
  return new ComponentSummary({
    name: comp.name,
    views: Object.keys(comp.views ?? {}),
    fields,
  });
}

export function listComponents(normalized, { name = null, limit = 0 } = {}) {
  const comps = normalized.components;
  const picked = name === null ? comps : comps.filter((c) => c.name === name);
  const total = picked.length;
  const capped = limit > 0 ? picked.slice(0, limit) : picked;
  return new ComponentList({
    items: capped.map(summarize),
    total,
    truncated: capped.length < total,
  });
}

export function listExamples(normalized, { limit = 0 } = {}) {
  const sections = normalized.sections;
  const total = sections.reduce((n, s) => n + (s.items?.length ?? 0), 0);
  if (limit <= 0) {
    return new ExampleIndex({ sections, total, truncated: false });
  }
  const capped = [];
  let remaining = limit;
  for (const s of sections) {
    if (remaining <= 0) break;
    const items = s.items.slice(0, remaining);
    capped.push({ ...s, items });
    remaining -= items.length;
  }
  return new ExampleIndex({
    sections: capped,
    total,
    truncated: capped.reduce((n, s) => n + s.items.length, 0) < total,
  });
}
