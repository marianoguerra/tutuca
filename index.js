import { Macro, ParseContext } from "./src/anode.js";
import { App } from "./src/app.js";
import { Components } from "./src/components.js";
import { Renderer } from "./src/renderer.js";

// Re-export immutable's public surface, enumerated explicitly. This started as a
// workaround for a Bun bundler bug (a star re-export of an external lowered to a
// broken `__reExport(ns, immutable)` whose namespace was never bound, silently
// dropping these exports from the .ext bundles). esbuild emits a real
// `export * from "immutable"`, so the list is no longer load-bearing and could
// collapse to a star plus the five aliases below — but the failure mode if that
// goes wrong is silent, so it stays until someone changes it deliberately.
// `scripts/smoke.js` guards this list against drift from the vendored bundle.
export {
  Collection,
  fromJS,
  get,
  getIn,
  has,
  hash,
  hasIn,
  is,
  isAssociative,
  isCollection,
  isImmutable,
  isIndexed,
  isKeyed,
  isList,
  isMap,
  // tutuca's own aliases for the most-used immutable types
  isMap as isIMap,
  isOrdered,
  isOrderedMap,
  isOrderedMap as isOMap,
  isOrderedSet,
  isPlainObject,
  isRecord,
  isSeq,
  isSet,
  isStack,
  isValueObject,
  List,
  Map,
  Map as IMap,
  merge,
  mergeDeep,
  mergeDeepWith,
  mergeWith,
  OrderedMap,
  OrderedMap as OMap,
  OrderedSet,
  PairSorting,
  Range,
  Record,
  Repeat,
  remove,
  removeIn,
  Seq,
  Set,
  Set as ISet,
  Stack,
  set,
  setIn,
  update,
  updateIn,
  version,
} from "./deps/immutable.js";
export { ParseContext } from "./src/anode.js";
export { injectCss } from "./src/app.js";
export { dispatchPhase, phaseHasBubble, phaseOps, resolveArgs } from "./src/on.js";
export { component, FIELD_CLASS } from "./src/oo.js";
export { SEQ_INFO } from "./src/renderer.js";
export { rootDispatcher } from "./src/transactor.js";
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
