import { register } from "node:module";

// A module under test does `import { ... } from "tutuca"`, which resolves to the
// CORE build (package exports "."), where dev-only test helpers such as
// `collectIterBindings` are no-op stubs (see index.js). The browser playground
// sidesteps this with an import map that points "tutuca" at the dev build; this
// hook does the equivalent for the commands that import user modules and run
// their getTests() in Node (`tutuca test` and `tutuca storybook`, including
// `--dry-run`), redirecting the bare "tutuca" specifier to the dev build — a
// strict superset of core that carries the real helper implementations. The
// Immer subpath is also pinned to this installation so staged modules outside
// the package tree can import `tutuca/immer`. See DEV_BUILD_COMMANDS in
// tools/tutuca.js.
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
  let immerUrl;
  try {
    devUrl = import.meta.resolve("tutuca/dev");
    immerUrl = import.meta.resolve("tutuca/immer");
  } catch {
    return false;
  }
  const hookSource = `
let devUrl;
let immerUrl;
export async function initialize(data) {
  devUrl = data.devUrl;
  immerUrl = data.immerUrl;
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "tutuca") return { url: devUrl, shortCircuit: true };
  if (specifier === "tutuca/immer") return { url: immerUrl, shortCircuit: true };
  return nextResolve(specifier, context);
}`;
  try {
    register(`data:text/javascript,${encodeURIComponent(hookSource)}`, import.meta.url, {
      data: { devUrl, immerUrl },
    });
    return true;
  } catch {
    return false;
  }
}
