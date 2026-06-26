import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeModule } from "../core/module.js";

export async function loadAndNormalize(modulePath) {
  const abs = resolve(modulePath);
  let mod;
  try {
    mod = await import(abs);
  } catch (e) {
    // Translate Node's raw ESM-resolver failures *for the entry path itself* into
    // a coded tutuca error so the dispatcher renders a `tutuca:` message instead of
    // a raw stack. A missing *dependency* (ERR_MODULE_NOT_FOUND with the entry
    // present) is a genuine module bug — surface it unchanged.
    const entryProblem =
      e?.code === "ERR_UNSUPPORTED_DIR_IMPORT" ||
      (e?.code === "ERR_MODULE_NOT_FOUND" && !existsSync(abs));
    if (entryProblem) {
      const err = new Error(
        e.code === "ERR_UNSUPPORTED_DIR_IMPORT"
          ? `expected a module file, got a directory: ${modulePath}`
          : `module not found: ${modulePath}`,
      );
      err.code = "ERR_MODULE_LOAD_FAILED";
      throw err;
    }
    throw e;
  }
  const { normalized } = normalizeModule(mod, { path: abs });
  return normalized;
}
