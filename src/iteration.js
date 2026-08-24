import { isIndexedSeq, isKeyedSeq, isSetSeq, seqEntries, seqGet, seqSize } from "./collection.js";

export const SEQ_INFO = Symbol.for("tutuca.seqInfo");

// Clamp a positional range using Array.prototype.slice semantics.
export const normalizeRange = (start, end, size) => {
  let s = start == null ? 0 : start < 0 ? size + start : start;
  let e = end == null ? size : end < 0 ? size + end : end;
  s = s < 0 ? 0 : s > size ? size : s;
  e = e < 0 ? 0 : e > size ? size : e;
  return [s, e < s ? s : e];
};

const nativeIndexedIter = (seq, visit, start, end) => {
  const [s, e] = normalizeRange(start, end, seqSize(seq));
  for (let i = s; i < e; i++) visit(i, seq[i], "si");
};

const nativeKeyedIter = (seq, visit, start, end) => {
  const [s, e] = normalizeRange(start, end, seqSize(seq));
  let i = 0;
  for (const [key, value] of seqEntries(seq)) {
    if (i >= e) break;
    if (i >= s) visit(key, value, "sk");
    i++;
  }
};

const unknownIter = () => {};

export const getSeqInfo = (seq) =>
  isIndexedSeq(seq)
    ? nativeIndexedIter
    : isKeyedSeq(seq) || isSetSeq(seq)
      ? nativeKeyedIter
      : (seq?.[SEQ_INFO] ?? unknownIter);

export const filterAlwaysTrue = (_key, _value, _iterData) => true;
export const nullLoopWith = (seq) => ({ iterData: { seq } });

export const unpackLoopResult = (result, seq) => {
  const value = result ?? {};
  return {
    iterData: value.iterData ?? { seq },
    start: value.start,
    end: value.end,
    keys: value.keys,
  };
};

export const makeLoopCtx = (stack, filter) => ({
  lookup: (name) => stack.lookupBind(name),
  filter: (key, value, iterData) => filter.call(stack.it, key, value, iterData),
});

// Enrichers may add bindings, but key/value always retain sequence identity.
export const callEnricher = (enricher, it, binds, key, value, iterData) => {
  enricher.call(it, binds, key, value, iterData);
  console.assert(
    binds.key === key && binds.value === value,
    "@enrich-with handlers must not overwrite binds.key or binds.value",
  );
  binds.key = key;
  binds.value = value;
};

const visitKeys = (seq, keys, visit) => {
  const attrName = isIndexedSeq(seq) ? "si" : "sk";
  for (const key of keys) visit(key, seqGet(seq, key), attrName);
};

// The single when -> loop-with -> enrich pipeline shared by rendering and tests.
// A keys result is authoritative and therefore bypasses the when predicate.
export function walkLoopBindings({ seq, it, filter, loopWith, enricher, ctx }, visit) {
  const { iterData, start, end, keys } = unpackLoopResult(loopWith.call(it, seq, ctx), seq);
  const visitOne = (key, value, attrName) => {
    const binds = { key, value };
    if (enricher) callEnricher(enricher, it, binds, key, value, iterData);
    visit(key, value, attrName, binds);
  };

  if (keys) visitKeys(seq, keys, visitOne);
  else
    getSeqInfo(seq)(
      seq,
      (key, value, attrName) => {
        if (filter.call(it, key, value, iterData)) visitOne(key, value, attrName);
      },
      start,
      end,
    );
}
