import { getSeqInfo } from "../renderer.js";

const filterAlwaysTrue = () => true;
const nullLoopWith = (seq) => ({ seq });

const plainArrayIter = (seq, visit) => {
  for (let i = 0; i < seq.length; i++) visit(i, seq[i]);
};
const plainMapIter = (seq, visit) => {
  for (const [k, v] of seq.entries()) visit(k, v);
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
  const iterData = loopWithFn.call(it, seq);
  const out = [];
  const iter = pickIter(seq);
  iter(seq, (key, value) => {
    if (!whenFn.call(it, key, value, iterData)) return;
    const binds = { key, value };
    if (enrichFn) enrichFn.call(it, binds, key, value, iterData);
    out.push(binds);
  });
  return out;
}
