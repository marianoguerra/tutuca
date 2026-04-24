import { ModuleInfo } from "./results.js";
import { normalizeModule } from "./module.js";

export function describeModule(mod, { path = null } = {}) {
  const { normalized, present } = normalizeModule(mod, { path });
  const counts = {
    components: normalized.components.length,
    macros: normalized.macros ? Object.keys(normalized.macros).length : 0,
    requestHandlers: normalized.requestHandlers
      ? Object.keys(normalized.requestHandlers).length
      : 0,
    examples: normalized.sections.reduce((n, s) => n + s.items.length, 0),
    sections: normalized.sections.length,
  };

  const warnings = [];
  if (!normalized.components.length) warnings.push("module exports no components");
  if (!present.has("getExamples")) {
    warnings.push("module exports no getExamples()");
  } else if (normalized.sections.length === 0) {
    warnings.push("getExamples() returned no sections");
  }

  return new ModuleInfo({ path, present, counts, warnings });
}
