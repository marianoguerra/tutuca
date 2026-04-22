import { resolve } from "node:path";
import { normalizeModule } from "../core/module.js";

export async function loadAndNormalize(modulePath) {
  const abs = resolve(modulePath);
  const mod = await import(abs);
  const { normalized } = normalizeModule(mod, { path: abs });
  return normalized;
}
