// Where tutuca-wasm's pages find what they load: everything is under this directory.
const at = (path) => new URL(path, import.meta.url);

export const RUNTIME = at("../dist/tutuca-wasm.wasm");
export const COMPILER = at("../dist/pure-js/pure-js.wasm");
/** The base of a component module's path: components/counter/counter.tutuca.ts is under it. */
export const SOURCES = at("../");
/** A component module by name, under SOURCES: components/counter/counter.tutuca.ts. */
export const componentPath = (name) => `components/${name}/${name}.tutuca.ts`;
export const MARGAUI = at("../vendor/margaui/");
