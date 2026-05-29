import { Macro, ParseContext } from "./src/anode.js";
import { App } from "./src/app.js";
import { Components } from "./src/components.js";
import { Renderer } from "./src/renderer.js";

// Re-export immutable's public surface. This is enumerated explicitly on
// purpose — do NOT switch to `export * from "./deps/immutable.js"`. When this
// module is bundled as an *inner* module (the .ext extra/dev builds re-export it
// via `export * from "./index.js"`), Bun lowers a star re-export of an external
// to a broken `__reExport(ns, immutable)` call whose `immutable` namespace is
// never bound — the .ext bundle then throws `ReferenceError: immutable is not
// defined` at load and drops the top-level immutable exports. Explicit named
// re-exports bundle correctly in every build. `scripts/smoke.js` guards this
// list against drift from the vendored immutable bundle.
export {
  Collection,
  List,
  Map,
  OrderedMap,
  OrderedSet,
  PairSorting,
  Range,
  Record,
  Repeat,
  Seq,
  Set,
  Stack,
  fromJS,
  get,
  getIn,
  has,
  hasIn,
  hash,
  is,
  isAssociative,
  isCollection,
  isImmutable,
  isIndexed,
  isKeyed,
  isList,
  isMap,
  isOrdered,
  isOrderedMap,
  isOrderedSet,
  isPlainObject,
  isRecord,
  isSeq,
  isSet,
  isStack,
  isValueObject,
  merge,
  mergeDeep,
  mergeDeepWith,
  mergeWith,
  remove,
  removeIn,
  set,
  setIn,
  update,
  updateIn,
  version,
  // tutuca's own aliases for the most-used immutable types
  isMap as isIMap,
  isOrderedMap as isOMap,
  Map as IMap,
  OrderedMap as OMap,
  Set as ISet,
} from "./deps/immutable.js";
export { ParseContext } from "./src/anode.js";
export { injectCss } from "./src/app.js";
export { component, FIELD_CLASS } from "./src/oo.js";
export { SEQ_INFO } from "./src/renderer.js";
export const css = String.raw;
export const html = String.raw;
export const macro = (defaults, rawView) => new Macro(defaults, rawView);
export function check(_app) {
  return { error: 0, warn: 0, hint: 0, dummyCheck: true };
}
export async function test(_opts) {
  return null;
}
export function collectIterBindings() {
  console.warn(
    "collectIterBindings is a no-op in the core tutuca build; use the tutuca-dev build for a functional implementation",
  );
  return [];
}
export function tutuca(nodeOrSelector) {
  const rootNode =
    typeof nodeOrSelector === "string" ? document.querySelector(nodeOrSelector) : nodeOrSelector;
  const comps = new Components();
  const renderer = new Renderer(comps);
  return new App(rootNode, comps, renderer, ParseContext);
}
