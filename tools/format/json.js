import { makeFormatter } from "./_dispatch.js";

function replacer(_key, v) {
  if (v instanceof Set) return [...v];
  return v;
}

function fmtJson(result, { pretty = false } = {}) {
  return JSON.stringify(result, replacer, pretty ? 2 : 0);
}

export const { supports, format } = makeFormatter("json", {
  ModuleInfo: fmtJson,
  ComponentList: fmtJson,
  ExampleIndex: fmtJson,
  ComponentDocs: fmtJson,
  LintReport: fmtJson,
  RenderBatch: fmtJson,
  DoctorReport: fmtJson,
});
