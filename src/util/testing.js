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

export function collectIterBindings(Comp, compInstance, seq, opts = {}) {
  const whenFn = resolveAlter(Comp, opts.when) ?? filterAlwaysTrue;
  const loopWithFn = resolveAlter(Comp, opts.loopWith) ?? nullLoopWith;
  const enrichFn = resolveAlter(Comp, opts.enrichWith);

  const it = compInstance;
  const { iterData, start, end } = unpackLoopResult(loopWithFn.call(it, seq), seq);
  const out = [];
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
