import { register } from "node:module";

// A module under test does `import { ... } from "tutuca"`, which resolves to the
// CORE build (package exports "."), where dev-only test helpers such as
// `collectIterBindings` are no-op stubs (see index.js). The browser playground
// sidesteps this with an import map that points "tutuca" at the dev build; this
// hook does the equivalent for `tutuca test`, redirecting the bare "tutuca"
// specifier (and only that) to the dev build — a strict superset of core that
// carries the real helper implementations.
//
// Notes:
//   • Inline `data:` URL hook so it survives bundling into the single-file
//     `dist/tutuca-cli.js` bin (no sidecar hook file to ship).
//   • The dev build is located via `import.meta.resolve("tutuca/dev")`, which
//     maps through the package "./dev" export both in-repo (self reference) and
//     when installed.
//   • Degrades gracefully: if the dev build can't be resolved or the runtime
//     lacks `module.register`, the stubs stay in place and helper-based tests
//     simply no-op as before.
export function installDevBuildResolveHook() {
  let devUrl;
  try {
    devUrl = import.meta.resolve("tutuca/dev");
  } catch {
    return false;
  }
  const hookSource = `
let devUrl;
export async function initialize(data) { devUrl = data.devUrl; }
export async function resolve(specifier, context, nextResolve) {
  return specifier === "tutuca"
    ? { url: devUrl, shortCircuit: true }
    : nextResolve(specifier, context);
}`;
  try {
    register(`data:text/javascript,${encodeURIComponent(hookSource)}`, import.meta.url, {
      data: { devUrl },
    });
    return true;
  } catch {
    return false;
  }
}
