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

export function listComponents(normalized, { name = null } = {}) {
  const comps = normalized.components;
  const picked = name === null ? comps : comps.filter((c) => c.name === name);
  return new ComponentList({ items: picked.map(summarize) });
}

export function listExamples(normalized) {
  return new ExampleIndex({ sections: normalized.sections });
}
