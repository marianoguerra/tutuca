import { Macro, ParseContext } from "./src/anode.js";
import { App } from "./src/app.js";
import { Components } from "./src/components.js";
import { Renderer } from "./src/renderer.js";

// Re-export immutable's public surface. This is enumerated explicitly on purpose —
// do NOT switch to `export * from "./deps/immutable.js"`. extra.js/dev.js re-export
// this module with `export * from "./index.js"`, and in the .ext builds immutable is
// external, so a star here would have to propagate names the bundler cannot know at
// build time: they are silently dropped from tutuca-extra.ext.js / tutuca-dev.ext.js.
// (Tried and reverted; `scripts/smoke.js`'s export-parity check is what catches it.)
// Explicit named re-exports are statically enumerable and survive every build.
// smoke.js also guards this list against drift from the vendored immutable bundle.
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
