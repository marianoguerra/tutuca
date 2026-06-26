import {
  filterAlwaysTrue,
  getSeqInfo,
  normalizeRange,
  nullLoopWith,
  unpackLoopResult,
} from "../renderer.js";

const plainArrayIter = (seq, visit, start, end) => {
  const [s, e] = normalizeRange(start, end, seq.length);
  for (let i = s; i < e; i++) visit(i, seq[i]);
};
const plainMapIter = (seq, visit, start, end) => {
  const [s, e] = normalizeRange(start, end, seq.size);
  let i = 0;
  for (const [k, v] of seq.entries()) {
    if (i >= e) break;
    if (i >= s) visit(k, v);
    i++;
  }
};

function pickIter(seq) {
  if (Array.isArray(seq)) return plainArrayIter;
  if (seq instanceof Map) return plainMapIter;
  return getSeqInfo(seq);
}

function resolveAlter(Comp, name) {
  if (name == null) return null;
  const fn = Comp.alter?.[name];
  if (typeof fn !== "function") {
    throw new Error(`alter handler '${name}' not found on component '${Comp.name}'`);
  }
  return fn;
}

const seqGet = (seq, key) => (Array.isArray(seq) ? seq[key] : seq.get ? seq.get(key) : seq[key]);

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

  const { iterData, start, end, keys } = unpackLoopResult(loopWithFn.call(it, seq, ctx), seq);
  const out = [];

  if (keys) {
    for (const key of keys) {
      const value = seqGet(seq, key);
      const binds = { key, value };
      if (enrichFn) enrichFn.call(it, binds, key, value, iterData);
      out.push(binds);
    }
    return out;
  }

  const iter = pickIter(seq);
  iter(
    seq,
    (key, value) => {
      if (!whenFn.call(it, key, value, iterData)) return;
      const binds = { key, value };
      if (enrichFn) enrichFn.call(it, binds, key, value, iterData);
      out.push(binds);
    },
    start,
    end,
  );
  return out;
}
