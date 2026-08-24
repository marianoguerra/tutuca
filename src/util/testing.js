import { filterAlwaysTrue, nullLoopWith, walkLoopBindings } from "../iteration.js";

function resolveAlter(Comp, name) {
  if (name == null) return null;
  const fn = Comp.alter?.[name];
  if (typeof fn !== "function") {
    throw new Error(`alter handler '${name}' not found on component '${Comp.name}'`);
  }
  return fn;
}

// Mirror the render loop for tests: resolve `@when` / `@loop-with` / `@enrich-with`
// and return the `{ key, value, ...enriched }` binds the loop would render.
//
// The `@loop-with` handler is called with the same `(seq, ctx)` shape as the
// renderer, where `ctx = { lookup, filter }`:
//   • `lookup(name)` reads a scope binding. Pass `opts.scopeEnrich` (the name of
//     a scope `@enrich-with` handler) and/or `opts.scope` (a plain bindings
//     object) to supply them — this is how a handler that does
//     `lookup("currentPage")` / `lookup("__keys__")` gets its value in a test.
//   • `filter(key, value, iterData)` wraps the `@when` predicate.
//
// A `keys` return is authoritative: those exact keys are visited, in order, and
// `@when` is NOT re-applied (matching the renderer). Otherwise the positional
// `start`/`end` slice is iterated and `@when` filters within it.
export function collectIterBindings(Comp, compInstance, seq, opts = {}) {
  const whenFn = resolveAlter(Comp, opts.when) ?? filterAlwaysTrue;
  const loopWithFn = resolveAlter(Comp, opts.loopWith) ?? nullLoopWith;
  const enrichFn = resolveAlter(Comp, opts.enrichWith);
  const scopeEnrichFn = resolveAlter(Comp, opts.scopeEnrich);

  const it = compInstance;
  const scope = scopeEnrichFn ? (scopeEnrichFn.call(it) ?? {}) : (opts.scope ?? {});
  const ctx = {
    lookup: (name) => scope[name],
    filter: (key, value, iterData) => whenFn.call(it, key, value, iterData),
  };

  const out = [];
  walkLoopBindings(
    { seq, it, filter: whenFn, loopWith: loopWithFn, enricher: enrichFn, ctx },
    (_key, _value, _attrName, binds) => out.push(binds),
  );
  return out;
}
