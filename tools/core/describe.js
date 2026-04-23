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
    examples: normalized.section
      ? normalized.section.items.length +
        normalized.section.groups.reduce((n, g) => n + g.items.length, 0)
      : 0,
    groups: normalized.section ? normalized.section.groups.length : 0,
  };

  const warnings = [];
  if (!normalized.components.length) warnings.push("module exports no components");
  if (!normalized.section) warnings.push("module exports no getExamples()");

  return new ModuleInfo({ path, present, counts, warnings });
}
