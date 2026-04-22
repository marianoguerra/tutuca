export const supports = new Set([
  "ModuleInfo",
  "ComponentList",
  "ExampleIndex",
  "ComponentDocs",
  "LintReport",
  "RenderBatch",
  "DoctorReport",
  "StresstestResult",
]);

function replacer(_key, v) {
  if (v instanceof Set) return [...v];
  return v;
}

export function format(result, { pretty = false } = {}) {
  return JSON.stringify(result, replacer, pretty ? 2 : 0);
}
